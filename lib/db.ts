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
  _db.pragma('cache_size = -2000'); // 2MB cache instead of default ~2MB per page
  _db.pragma('mmap_size = 0'); // disable mmap to reduce virtual memory usage

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

    CREATE TABLE IF NOT EXISTS bus_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent TEXT NOT NULL,
      to_agent TEXT,
      channel TEXT NOT NULL DEFAULT 'general',
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bus_channel ON bus_messages(channel, created_at);

    CREATE TABLE IF NOT EXISTS agent_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      files_changed TEXT,
      commits TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      steps_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, created_at DESC);

    CREATE TABLE IF NOT EXISTS orchestrator_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_requests (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      base_branch TEXT NOT NULL DEFAULT 'main',
      summary TEXT NOT NULL,
      changed_files_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewer_comment TEXT,
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_push_requests_status ON push_requests(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      agent_ids_json TEXT,
      error TEXT,
      step_outputs_json TEXT,
      agents_detail_json TEXT
    );

    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      task TEXT NOT NULL,
      agent_type TEXT DEFAULT 'claude',
      model TEXT DEFAULT 'sonnet',
      repo TEXT,
      enabled INTEGER DEFAULT 1,
      last_run INTEGER,
      next_run INTEGER,
      last_status TEXT,
      last_agent_id TEXT,
      run_count INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  // Migration: add depends_on column to agents if it doesn't exist
  try {
    db.exec(`ALTER TABLE agents ADD COLUMN depends_on TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add schedule/cron columns to workflows
  try {
    db.exec(`ALTER TABLE workflows ADD COLUMN schedule TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE workflows ADD COLUMN cron_enabled INTEGER DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE workflows ADD COLUMN layout_json TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add step_outputs and agents_detail to workflow_runs
  try {
    db.exec(`ALTER TABLE workflow_runs ADD COLUMN step_outputs_json TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE workflow_runs ADD COLUMN agents_detail_json TEXT`);
  } catch {}
}

// Agent queries
export function getAllAgents(): Agent[] {
  const db = getDb();
  return db.prepare(`
    SELECT a.*, l.content AS last_log
    FROM agents a
    LEFT JOIN (
      SELECT agent_id, content
      FROM logs
      WHERE (agent_id, id) IN (
        SELECT agent_id, MAX(id) FROM logs GROUP BY agent_id
      )
    ) l ON l.agent_id = a.id
    ORDER BY a.created_at DESC
  `).all() as Agent[];
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

const ALLOWED_AGENT_COLUMNS = new Set([
  'name', 'type', 'status', 'task', 'repo', 'worktree_path',
  'pid', 'port', 'created_at', 'depends_on',
]);

export function updateAgent(id: string, updates: Partial<Agent>): void {
  const db = getDb();
  const now = Date.now();
  const safeKeys = Object.keys(updates).filter(k => ALLOWED_AGENT_COLUMNS.has(k));
  if (safeKeys.length === 0) return;
  const fields = safeKeys.map(k => `${k} = @${k}`).join(', ');
  const safeUpdates = Object.fromEntries(safeKeys.map(k => [k, (updates as Record<string, unknown>)[k]]));
  db.prepare(`UPDATE agents SET ${fields}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...safeUpdates, updated_at: now, id });
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

const ALLOWED_TASK_COLUMNS = new Set(['description', 'status', 'agent_id', 'result', 'depends_on', 'blocking']);

export function updateTask(id: string, updates: Partial<Task>): void {
  const db = getDb();
  const safe = Object.fromEntries(Object.entries(updates).filter(([k]) => ALLOWED_TASK_COLUMNS.has(k)));
  if (Object.keys(safe).length === 0) return;
  const fields = Object.keys(safe).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE tasks SET ${fields} WHERE id = @id`).run({ ...safe, id });
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

export function hasPtyChunks(agentId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM pty_chunks WHERE agent_id = ? LIMIT 1').get(agentId);
  return !!row;
}

export function clearPtyChunks(agentId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM pty_chunks WHERE agent_id = ?').run(agentId);
}

// Clean up PTY chunks for agents that finished more than 10 minutes ago
export function cleanupOldPtyChunks(): void {
  const db = getDb();
  const cutoff = Date.now() - 10 * 60 * 1000;
  db.prepare(`
    DELETE FROM pty_chunks WHERE agent_id IN (
      SELECT id FROM agents WHERE status IN ('done', 'error', 'killed') AND created_at < ?
    )
  `).run(cutoff);
  // Trim logs older than 24 hours for finished agents only (preserve running agent logs)
  db.prepare(`
    DELETE FROM logs WHERE timestamp < ? AND agent_id IN (
      SELECT id FROM agents WHERE status IN ('done', 'error', 'killed')
    )
  `).run(Date.now() - 24 * 60 * 60 * 1000);
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
  const cost_usd = record.cost_usd || calculateCost(record.input_tokens, record.output_tokens, record.model || undefined);
  db.prepare(`
    INSERT INTO token_usage (agent_id, source, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, model, created_at)
    VALUES (@agent_id, @source, @input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens, @cost_usd, @model, @created_at)
  `).run({ ...record, cost_usd, created_at: Date.now() });
}

export function getAllTokenUsage(since?: number): Record<string, { input_tokens: number; output_tokens: number; cost_usd: number }> {
  const db = getDb();
  const whereClause = since
    ? 'WHERE agent_id IS NOT NULL AND created_at >= ?'
    : 'WHERE agent_id IS NOT NULL';
  const params = since ? [since] : [];
  const rows = db.prepare(`
    SELECT agent_id,
           COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM token_usage
    ${whereClause}
    GROUP BY agent_id
  `).all(...params) as { agent_id: string; input_tokens: number; output_tokens: number; cost_usd: number }[];
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

// Bus messages
export function postBusMessage(from: string, channel: string, content: string, to?: string) {
  const db = getDb();
  db.prepare('INSERT INTO bus_messages (from_agent, to_agent, channel, content, created_at) VALUES (?, ?, ?, ?, ?)').run(from, to || null, channel, content, Date.now());
}

export function getBusMessages(channel: string, since?: number, limit = 50) {
  const db = getDb();
  if (since) {
    return db.prepare('SELECT * FROM bus_messages WHERE channel = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?').all(channel, since, limit);
  }
  return db.prepare('SELECT * FROM bus_messages WHERE channel = ? ORDER BY created_at DESC LIMIT ?').all(channel, limit);
}

export function getBusChannels() {
  const db = getDb();
  return db.prepare('SELECT DISTINCT channel, COUNT(*) as count FROM bus_messages GROUP BY channel ORDER BY MAX(created_at) DESC').all();
}

// Agent summaries
export function saveAgentSummary(agentId: string, summary: string, filesChanged: string[], commits: string[], status: string) {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO agent_summaries (agent_id, summary, files_changed, commits, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(agentId, summary, JSON.stringify(filesChanged), JSON.stringify(commits), status, Date.now());
}

export function getAgentSummary(agentId: string) {
  const db = getDb();
  return db.prepare('SELECT * FROM agent_summaries WHERE agent_id = ?').get(agentId);
}

export function getAllSummaries() {
  const db = getDb();
  return db.prepare('SELECT * FROM agent_summaries ORDER BY created_at DESC').all();
}

// Workflows
export function saveWorkflow(
  id: string,
  name: string,
  description: string,
  steps: unknown[],
  options?: { schedule?: string | null; cronEnabled?: number; layout?: unknown }
) {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT OR REPLACE INTO workflows (id, name, description, steps_json, schedule, cron_enabled, layout_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM workflows WHERE id = ?), ?), ?)`
  ).run(
    id, name, description, JSON.stringify(steps),
    options?.schedule ?? null,
    options?.cronEnabled ?? 0,
    options?.layout ? JSON.stringify(options.layout) : null,
    id, now, now
  );
}

export function getWorkflow(id: string) {
  const db = getDb();
  return db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
}

export function getAllWorkflows() {
  const db = getDb();
  return db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all();
}

export function deleteWorkflow(id: string) {
  const db = getDb();
  db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
}

export function getScheduledWorkflows(): any[] {
  const db = getDb();
  return db.prepare('SELECT * FROM workflows WHERE cron_enabled = 1 AND schedule IS NOT NULL').all();
}

// Notifications
export function createNotification(type: string, title: string, body?: string, agentId?: string) {
  const db = getDb();
  db.prepare('INSERT INTO notifications (agent_id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?)').run(agentId || null, type, title, body || null, Date.now());
}

export function getNotifications(unreadOnly = false, limit = 50) {
  const db = getDb();
  if (unreadOnly) {
    return db.prepare('SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?').all(limit);
  }
  return db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function markNotificationRead(id: number) {
  const db = getDb();
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
}

export function markAllNotificationsRead() {
  const db = getDb();
  db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
}

export function getUnreadCount() {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get() as { count: number };
  return row.count;
}

// Orchestrator memory
export function setMemory(key: string, value: string, category = 'general') {
  const db = getDb();
  const now = Date.now();
  db.prepare(`INSERT OR REPLACE INTO orchestrator_memory (key, value, category, created_at, updated_at) VALUES (?, ?, ?, COALESCE((SELECT created_at FROM orchestrator_memory WHERE key = ?), ?), ?)`).run(key, value, category, key, now, now);
}

export function getMemory(key: string) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM orchestrator_memory WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || null;
}

export function getMemoryByCategory(category: string) {
  const db = getDb();
  return db.prepare('SELECT * FROM orchestrator_memory WHERE category = ? ORDER BY updated_at DESC').all(category);
}

export function deleteMemory(key: string) {
  const db = getDb();
  db.prepare('DELETE FROM orchestrator_memory WHERE key = ?').run(key);
}

// Search logs across all agents
export function searchLogs(query: string, limit = 100) {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(500, limit || 100));
  const safeQuery = query.slice(0, 200);
  return db.prepare(`SELECT l.*, a.name as agent_name FROM logs l JOIN agents a ON l.agent_id = a.id WHERE l.content LIKE ? ORDER BY l.timestamp DESC LIMIT ?`).all(`%${safeQuery}%`, safeLimit);
}

// Token usage by model
export function getTokenUsageByModel(since?: number): Array<{ model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd: number }> {
  const db = getDb();
  const whereClause = since ? 'WHERE created_at >= ?' : '';
  const params = since ? [since] : [];
  // Normalize model names: "claude-haiku-4-5-20251001" -> "haiku", etc.
  return db.prepare(`
    SELECT CASE
             WHEN LOWER(COALESCE(model, 'sonnet')) LIKE '%opus%' THEN 'opus'
             WHEN LOWER(COALESCE(model, 'sonnet')) LIKE '%haiku%' THEN 'haiku'
             WHEN LOWER(COALESCE(model, 'sonnet')) LIKE '%sonnet%' THEN 'sonnet'
             ELSE COALESCE(model, 'sonnet')
           END as model,
           COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
           COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM token_usage
    ${whereClause}
    GROUP BY CASE
             WHEN LOWER(COALESCE(model, 'sonnet')) LIKE '%opus%' THEN 'opus'
             WHEN LOWER(COALESCE(model, 'sonnet')) LIKE '%haiku%' THEN 'haiku'
             WHEN LOWER(COALESCE(model, 'sonnet')) LIKE '%sonnet%' THEN 'sonnet'
             ELSE COALESCE(model, 'sonnet')
           END
    ORDER BY cost_usd DESC
  `).all(...params) as Array<{ model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd: number }>;
}

// Cache stats
export function getCacheStats(since?: number): { cache_read_tokens: number; cache_write_tokens: number; total_input_tokens: number } {
  const db = getDb();
  const whereClause = since ? 'WHERE created_at >= ?' : '';
  const params = since ? [since] : [];
  const result = db.prepare(`
    SELECT COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
           COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
           COALESCE(SUM(input_tokens), 0) as total_input_tokens
    FROM token_usage
    ${whereClause}
  `).get(...params) as { cache_read_tokens: number; cache_write_tokens: number; total_input_tokens: number };
  return result;
}

// Session token usage with optional time filter
export function getSessionTokenUsageFiltered(since?: number): { input_tokens: number; output_tokens: number; cost_usd: number; total_tokens: number } {
  const db = getDb();
  const whereClause = since ? 'WHERE created_at >= ?' : '';
  const params = since ? [since] : [];
  const result = db.prepare(`
    SELECT COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM token_usage
    ${whereClause}
  `).get(...params) as { input_tokens: number; output_tokens: number; cost_usd: number };
  return { ...result, total_tokens: result.input_tokens + result.output_tokens };
}

// Token velocity — tokens per minute over the last 30 minutes
export function getTokenVelocity(): Array<{ minute: number; tokens: number }> {
  const db = getDb();
  const since = Date.now() - 30 * 60 * 1000;
  const rows = db.prepare(`
    SELECT (created_at / 60000) as minute,
           COALESCE(SUM(input_tokens + output_tokens), 0) as tokens
    FROM token_usage
    WHERE created_at >= ?
    GROUP BY (created_at / 60000)
    ORDER BY minute ASC
  `).all(since) as Array<{ minute: number; tokens: number }>;

  // Fill in missing minutes with 0
  const now = Math.floor(Date.now() / 60000);
  const result: Array<{ minute: number; tokens: number }> = [];
  const rowMap = new Map(rows.map(r => [r.minute, r.tokens]));
  for (let m = now - 29; m <= now; m++) {
    result.push({ minute: m, tokens: rowMap.get(m) || 0 });
  }
  return result;
}

// Cost calculation helper
export function calculateCost(inputTokens: number, outputTokens: number, model?: string): number {
  // Claude Sonnet 4 pricing
  const rates: Record<string, { input: number; output: number }> = {
    'sonnet': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
    'opus': { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
    'haiku': { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  };
  const rate = rates[model || 'sonnet'] || rates['sonnet'];
  return inputTokens * rate.input + outputTokens * rate.output;
}

// Workflow runs
export function createWorkflowRun(id: string, workflowId: string, agentIds: string[]): void {
  const db = getDb();
  db.prepare(`INSERT INTO workflow_runs (id, workflow_id, status, started_at, agent_ids_json) VALUES (?, ?, 'running', ?, ?)`)
    .run(id, workflowId, Date.now(), JSON.stringify(agentIds));
}

export function updateWorkflowRun(id: string, status: string, error?: string): void {
  const db = getDb();
  db.prepare(`UPDATE workflow_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?`)
    .run(status, Date.now(), error || null, id);
}

export function updateWorkflowRunAgents(id: string, agentIds: string[]): void {
  const db = getDb();
  db.prepare(`UPDATE workflow_runs SET agent_ids_json = ? WHERE id = ?`)
    .run(JSON.stringify(agentIds), id);
}

export function updateWorkflowRunDetail(
  id: string,
  agents: Array<{ stepName: string; agentId: string; status: string }>,
  stepOutputs: Record<string, string>,
): void {
  const db = getDb();
  db.prepare(`UPDATE workflow_runs SET agents_detail_json = ?, step_outputs_json = ? WHERE id = ?`)
    .run(JSON.stringify(agents), JSON.stringify(stepOutputs), id);
}

export function getWorkflowRunById(id: string): any {
  const db = getDb();
  return db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id);
}

export function getWorkflowRuns(workflowId: string): any[] {
  const db = getDb();
  return db.prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC').all(workflowId);
}

export function getRecentWorkflowRuns(limit = 20): any[] {
  const db = getDb();
  return db.prepare('SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT ?').all(limit);
}

// Cron jobs
export function getCronJobs(): any[] {
  return getDb().prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all();
}

export function getCronJob(id: string): any {
  return getDb().prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id);
}

export function createCronJob(job: { id: string; name: string; schedule: string; task: string; agent_type?: string; model?: string; repo?: string }): void {
  const now = Date.now();
  getDb().prepare(
    'INSERT INTO cron_jobs (id, name, schedule, task, agent_type, model, repo, enabled, run_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)'
  ).run(job.id, job.name, job.schedule, job.task, job.agent_type || 'claude', job.model || 'sonnet', job.repo || null, now, now);
}

const ALLOWED_CRON_COLUMNS = new Set(['name', 'schedule', 'task', 'agent_type', 'model', 'repo', 'enabled']);

export function updateCronJob(id: string, updates: Record<string, any>): void {
  const safe = Object.fromEntries(Object.entries(updates).filter(([k]) => ALLOWED_CRON_COLUMNS.has(k)));
  if (Object.keys(safe).length === 0) return;
  const fields = Object.keys(safe).map(k => `${k} = ?`).join(', ');
  const values = Object.values(safe);
  getDb().prepare(`UPDATE cron_jobs SET ${fields}, updated_at = ? WHERE id = ?`).run(...values, Date.now(), id);
}

export function deleteCronJob(id: string): void {
  getDb().prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
}

export function recordCronRun(id: string, agentId: string, status: string): void {
  getDb().prepare(
    'UPDATE cron_jobs SET last_run = ?, last_status = ?, last_agent_id = ?, run_count = run_count + 1, updated_at = ? WHERE id = ?'
  ).run(Date.now(), status, agentId, Date.now(), id);
}

// Orchestrator log queries
export function getOrchestratorLogs(limit = 200, since?: number): any[] {
  const db = getDb();
  if (since) {
    return db.prepare(
      'SELECT l.*, a.name as agent_name FROM logs l LEFT JOIN agents a ON l.agent_id = a.id WHERE l.timestamp > ? ORDER BY l.timestamp DESC LIMIT ?'
    ).all(since, limit);
  }
  return db.prepare(
    'SELECT l.*, a.name as agent_name FROM logs l LEFT JOIN agents a ON l.agent_id = a.id ORDER BY l.timestamp DESC LIMIT ?'
  ).all(limit);
}

// Push requests
export function createPushRequest(pr: {
  id: string; agent_id: string; agent_name: string; branch: string;
  base_branch: string; summary: string; changed_files_json?: string;
}): void {
  const db = getDb();
  db.prepare(`INSERT INTO push_requests (id, agent_id, agent_name, branch, base_branch, summary, changed_files_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
    pr.id, pr.agent_id, pr.agent_name, pr.branch, pr.base_branch,
    pr.summary, pr.changed_files_json || '[]', Date.now()
  );
}

export function getPushRequests(status?: string, limit = 50): any[] {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM push_requests WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit);
  }
  return db.prepare('SELECT * FROM push_requests ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function getPushRequest(id: string): any {
  const db = getDb();
  const pr = db.prepare('SELECT * FROM push_requests WHERE id = ?').get(id);
  if (pr) return pr;
  // Try prefix match
  return db.prepare('SELECT * FROM push_requests WHERE id LIKE ? ORDER BY created_at DESC LIMIT 1').get(id + '%');
}

export function getPendingPushRequestsCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM push_requests WHERE status = 'pending'").get() as { count: number };
  return row.count;
}

export function updatePushRequest(id: string, status: 'approved' | 'rejected', comment?: string): void {
  getDb().prepare('UPDATE push_requests SET status = ?, reviewer_comment = ?, reviewed_at = ? WHERE id = ?')
    .run(status, comment || null, Date.now(), id);
}

export function getOrchestratorLogStats(): any {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as count FROM logs').get() as any).count;
  const byStream = db.prepare('SELECT stream, COUNT(*) as count FROM logs GROUP BY stream').all();
  const byAgent = db.prepare(
    'SELECT a.name, COUNT(*) as count FROM logs l JOIN agents a ON l.agent_id = a.id GROUP BY l.agent_id ORDER BY count DESC LIMIT 10'
  ).all();
  return { total, byStream, byAgent };
}
