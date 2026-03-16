import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import type { Agent, Log, Task, AgentStatus, LogStream, TaskStatus } from '@/types';

const DB_PATH = process.env.DB_PATH || path.join(os.homedir(), 'boardroom', '.boardroom.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      status TEXT,
      task TEXT,
      repo TEXT,
      worktree_path TEXT,
      pid INTEGER,
      port INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      timestamp INTEGER,
      stream TEXT,
      content TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      description TEXT,
      status TEXT,
      agent_id TEXT,
      created_at INTEGER,
      result TEXT
    );

    CREATE TABLE IF NOT EXISTS pty_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pty_chunks_agent_id ON pty_chunks(agent_id);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      events_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      source TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      model TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_agent ON token_usage(agent_id);
    CREATE INDEX IF NOT EXISTS idx_logs_agent_id ON logs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `);
}

// Agent queries
export function getAllAgents(): Agent[] {
  const db = getDb();
  return db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all() as Agent[];
}

export function getAgentById(id: string): Agent | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
}

export function createAgent(agent: Omit<Agent, 'updated_at'>): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO agents (id, name, type, status, task, repo, worktree_path, pid, port, created_at, updated_at)
    VALUES (@id, @name, @type, @status, @task, @repo, @worktree_path, @pid, @port, @created_at, @updated_at)
  `).run({ ...agent, updated_at: now });
}

export function updateAgent(id: string, updates: Partial<Agent>): void {
  const db = getDb();
  const now = Date.now();
  const fields = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE agents SET ${fields}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...updates, updated_at: now, id });
}

export function updateAgentStatus(id: string, status: AgentStatus, pid?: number): void {
  const db = getDb();
  const now = Date.now();
  if (pid !== undefined) {
    db.prepare('UPDATE agents SET status = ?, pid = ?, updated_at = ? WHERE id = ?').run(status, pid, now, id);
  } else {
    db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }
}

export function deleteAgent(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM logs WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

// Log queries
export function insertLog(agentId: string, stream: LogStream, content: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO logs (agent_id, timestamp, stream, content)
    VALUES (?, ?, ?, ?)
  `).run(agentId, Date.now(), stream, content);
}

export function getLogsForAgent(agentId: string, limit = 200, offset = 0): Log[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM logs WHERE agent_id = ?
    ORDER BY timestamp ASC
    LIMIT ? OFFSET ?
  `).all(agentId, limit, offset) as Log[];
}

export function getLogsSince(agentId: string, sinceId: number): Log[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM logs WHERE agent_id = ? AND id > ?
    ORDER BY id ASC
  `).all(agentId, sinceId) as Log[];
}

export function getLogCountToday(): number {
  const db = getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const result = db.prepare('SELECT COUNT(*) as count FROM logs WHERE timestamp >= ?').get(startOfDay.getTime()) as { count: number };
  return result.count;
}

// Task queries
export function getAllTasks(): Task[] {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Task[];
}

export function getTaskById(id: string): Task | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
}

export function createTask(task: Task): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO tasks (id, description, status, agent_id, created_at, result)
    VALUES (@id, @description, @status, @agent_id, @created_at, @result)
  `).run(task);
}

export function updateTask(id: string, updates: Partial<Task>): void {
  const db = getDb();
  const now = Date.now();
  const fields = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE tasks SET ${fields} WHERE id = @id`).run({ ...updates, id });
}

// PTY chunk queries
export function insertPtyChunk(agentId: string, data: string): void {
  const db = getDb();
  db.prepare('INSERT INTO pty_chunks (agent_id, data, created_at) VALUES (?, ?, ?)').run(agentId, data, Date.now());
}

export function getPtyChunks(agentId: string, afterId = 0): { id: number; data: string }[] {
  const db = getDb();
  return db.prepare('SELECT id, data FROM pty_chunks WHERE agent_id = ? AND id > ? ORDER BY id ASC').all(agentId, afterId) as { id: number; data: string }[];
}

export function clearPtyChunks(agentId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM pty_chunks WHERE agent_id = ?').run(agentId);
}

// Chat history queries
export interface ChatMessageRow {
  id: number;
  role: string;
  content: string;
  events_json: string | null;
  created_at: number;
}

export function getChatHistory(limit = 100): ChatMessageRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT ?').all(limit) as ChatMessageRow[];
}

export function saveChatMessage(role: string, content: string, events?: unknown[]): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO chat_messages (role, content, events_json, created_at)
    VALUES (?, ?, ?, ?)
  `).run(role, content, events ? JSON.stringify(events) : null, Date.now());
}

export function clearChatHistory(): void {
  const db = getDb();
  db.prepare('DELETE FROM chat_messages').run();
}

export function getPendingTasksCount(): number {
  const db = getDb();
  const result = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'").get() as { count: number };
  return result.count;
}

export function getActiveAgentsCount(): number {
  const db = getDb();
  const result = db.prepare("SELECT COUNT(*) as count FROM agents WHERE status IN ('spawning', 'running')").get() as { count: number };
  return result.count;
}

// Token usage queries
export interface TokenRecord {
  agent_id: string | null;
  source: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  model: string | null;
}

export function recordTokenUsage(record: TokenRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO token_usage (agent_id, source, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, model, created_at)
    VALUES (@agent_id, @source, @input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens, @cost_usd, @model, @created_at)
  `).run({ ...record, created_at: Date.now() });
}

export function getAllTokenUsage(): Record<string, { input_tokens: number; output_tokens: number; cost_usd: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT agent_id,
           COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM token_usage
    WHERE agent_id IS NOT NULL
    GROUP BY agent_id
  `).all() as { agent_id: string; input_tokens: number; output_tokens: number; cost_usd: number }[];
  const result: Record<string, { input_tokens: number; output_tokens: number; cost_usd: number }> = {};
  for (const row of rows) {
    result[row.agent_id] = { input_tokens: row.input_tokens, output_tokens: row.output_tokens, cost_usd: row.cost_usd };
  }
  return result;
}

export function getTokenUsageByAgent(agentId: string): { input_tokens: number; output_tokens: number; cost_usd: number } {
  const db = getDb();
  const result = db.prepare(`
    SELECT COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM token_usage WHERE agent_id = ?
  `).get(agentId) as { input_tokens: number; output_tokens: number; cost_usd: number };
  return result;
}

export function getSessionTokenUsage(): { input_tokens: number; output_tokens: number; cost_usd: number; total_tokens: number } {
  const db = getDb();
  const result = db.prepare(`
    SELECT COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM token_usage
  `).get() as { input_tokens: number; output_tokens: number; cost_usd: number };
  return { ...result, total_tokens: result.input_tokens + result.output_tokens };
}
