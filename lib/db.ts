import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { Agent, Log, Task, AgentStatus, LogStream, TaskStatus } from '@/types';
import { getConfig } from '@/lib/config';

const DB_PATH = getConfig().dbPath;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure the directory exists before creating the DB file
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  try {
    _db = new Database(DB_PATH);
  } catch (err) {
    throw new Error(`Failed to open database at ${DB_PATH}: ${err instanceof Error ? err.message : String(err)}`);
  }
  _db.pragma('busy_timeout = 5000');
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo TEXT,
      branch TEXT,
      working_dir TEXT,
      goal TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_questions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      project_id TEXT,
      question TEXT NOT NULL,
      options_json TEXT,
      default_choice TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      original_task TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pending_questions_status ON pending_questions(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pending_questions_agent ON pending_questions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_pending_questions_project ON pending_questions(project_id, status);

    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT,
      avatar TEXT,
      color TEXT,
      model TEXT,
      skills_json TEXT,
      system_prompt TEXT,
      autonomy TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'idle',
      current_agent_id TEXT,
      current_task_id TEXT,
      last_active INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_personas_project ON personas(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_personas_slug ON personas(project_id, slug);

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      execution_mode TEXT NOT NULL DEFAULT 'parallel',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_plans_project_status ON plans(project_id, status);
  `);

  // Schema versioning. Older installs created schema_version with just a
  // `version` column; rebuild it in place so INSERT-by-id below stays sound.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY,
      version INTEGER NOT NULL
    );
  `);

  const cols = (db.prepare('PRAGMA table_info(schema_version)').all() as Array<{ name: string }>)
    .map(c => c.name);
  if (!cols.includes('id')) {
    const legacy = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
    const legacyVersion = legacy?.version ?? 0;
    db.exec(`
      DROP TABLE schema_version;
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO schema_version (id, version) VALUES (1, ?)').run(legacyVersion);
  }

  const versionRow = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  const currentVersion = versionRow?.version ?? 0;

  const setVersion = (v: number) => {
    db.prepare('INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, ?)').run(v);
  };

  if (currentVersion < 1) {
    try { db.exec(`ALTER TABLE agents ADD COLUMN depends_on TEXT`); } catch {}
    setVersion(1);
  }

  if (currentVersion < 2) {
    try { db.exec(`ALTER TABLE workflows ADD COLUMN schedule TEXT`); } catch {}
    try { db.exec(`ALTER TABLE workflows ADD COLUMN cron_enabled INTEGER DEFAULT 0`); } catch {}
    try { db.exec(`ALTER TABLE workflows ADD COLUMN layout_json TEXT`); } catch {}
    setVersion(2);
  }

  if (currentVersion < 3) {
    try { db.exec(`ALTER TABLE workflow_runs ADD COLUMN step_outputs_json TEXT`); } catch {}
    try { db.exec(`ALTER TABLE workflow_runs ADD COLUMN agents_detail_json TEXT`); } catch {}
    setVersion(3);
  }

  if (currentVersion < 4) {
    // settings table was added in CREATE TABLE IF NOT EXISTS above — no ALTER needed
    setVersion(4);
  }

  if (currentVersion < 5) {
    // projects table added in CREATE TABLE IF NOT EXISTS above. Seed a default
    // project so existing installs have something to scope new work against.
    const existing = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
    if (existing.count === 0) {
      const now = Date.now();
      db.prepare(
        `INSERT INTO projects (id, name, repo, branch, working_dir, goal, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('default', 'workspace', null, null, null, null, now, now);
      db.prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`
      ).run('active_project_id', 'default', now);
    }
    setVersion(5);
  }

  if (currentVersion < 6) {
    // Agents now belong to a project. Backfill existing agents to the default
    // project so the fleet view doesn't go empty when scoped.
    try { db.exec(`ALTER TABLE agents ADD COLUMN project_id TEXT`); } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id)`); } catch {}
    try {
      db.prepare(`UPDATE agents SET project_id = 'default' WHERE project_id IS NULL`).run();
    } catch {}
    setVersion(6);
  }

  if (currentVersion < 7) {
    // pending_questions table added in CREATE TABLE IF NOT EXISTS above.
    setVersion(7);
  }

  if (currentVersion < 8) {
    // personas table added in CREATE TABLE IF NOT EXISTS above.
    setVersion(8);
  }

  if (currentVersion < 9) {
    // Enhance tasks table for the agentic-OS task board.
    try { db.exec(`ALTER TABLE tasks ADD COLUMN title TEXT`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN project_id TEXT`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN persona_id TEXT`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN required_skills_json TEXT`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN deadline INTEGER`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN updated_at INTEGER`); } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status)`); } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_persona ON tasks(persona_id, status)`); } catch {}
    // Backfill: existing tasks have description but no title; copy first 80 chars.
    try {
      db.prepare(`UPDATE tasks SET title = SUBSTR(description, 1, 80) WHERE title IS NULL AND description IS NOT NULL`).run();
    } catch {}
    try {
      db.prepare(`UPDATE tasks SET project_id = 'default' WHERE project_id IS NULL`).run();
    } catch {}
    setVersion(9);
  }

  if (currentVersion < 10) {
    // Cancel any open pending_questions whose owning agent isn't actually a
    // persona session — those are phantoms from the legacy fleet agents whose
    // output happened to contain the [ASK_USER] string.
    try {
      db.prepare(
        `UPDATE pending_questions
         SET status = 'cancelled', resolved_at = ?
         WHERE status = 'open'
           AND agent_id NOT IN (SELECT current_agent_id FROM personas WHERE current_agent_id IS NOT NULL)`,
      ).run(Date.now());
    } catch {}
    setVersion(10);
  }

  if (currentVersion < 11) {
    // plans table added in CREATE TABLE IF NOT EXISTS above.
    try { db.exec(`ALTER TABLE tasks ADD COLUMN plan_id TEXT`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN step_order INTEGER`); } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id, step_order)`); } catch {}
    setVersion(11);
  }

  if (currentVersion < 12) {
    // Bind cron jobs to personas (replaces the old generic agent_type/repo flow).
    try { db.exec(`ALTER TABLE cron_jobs ADD COLUMN persona_id TEXT`); } catch {}
    try { db.exec(`ALTER TABLE cron_jobs ADD COLUMN project_id TEXT`); } catch {}
    try { db.exec(`UPDATE cron_jobs SET project_id = 'default' WHERE project_id IS NULL`); } catch {}

    // task_lists: reusable named bundles of task definitions.
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_lists (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        items_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_lists_project ON task_lists(project_id);
    `);
    setVersion(12);
  }

  if (currentVersion < 13) {
    // Plan canvas: dependencies + persisted node positions per subtask.
    try { db.exec(`ALTER TABLE tasks ADD COLUMN depends_on_json TEXT`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN canvas_x REAL`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN canvas_y REAL`); } catch {}
    setVersion(13);
  }

  if (currentVersion < 14) {
    // Track the last agent a persona ran so the detail page can show recent
    // output even after the persona goes idle.
    try { db.exec(`ALTER TABLE personas ADD COLUMN last_agent_id TEXT`); } catch {}
    setVersion(14);
  }

  if (currentVersion < 15) {
    // Handoffs: one persona spawning work for another via [HANDOFF] markers.
    try { db.exec(`ALTER TABLE tasks ADD COLUMN from_persona_id TEXT`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN from_task_id TEXT`); } catch {}
    try { db.exec(`ALTER TABLE tasks ADD COLUMN handoff_reason TEXT`); } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_from ON tasks(from_persona_id, from_task_id)`); } catch {}
    setVersion(15);
  }

  if (currentVersion < 16) {
    // Completion signal: 'confirmed' (agent emitted [DONE]), 'auto' (clean
    // process exit, end_turn stop_reason), 'truncated' (max_tokens), null
    // (ambiguous/unknown). Agents have the option to confirm explicitly.
    try { db.exec(`ALTER TABLE tasks ADD COLUMN completion TEXT`); } catch {}
    setVersion(16);
  }

  if (currentVersion < 17) {
    // Track the merge-resolver agent spawned for a conflicted PR so /review
    // can surface its progress (running / done / failed) instead of silently
    // returning the conflict and leaving the PR in a half-merged limbo.
    try { db.exec(`ALTER TABLE push_requests ADD COLUMN resolver_agent_id TEXT`); } catch {}
    setVersion(17);
  }

  if (currentVersion < 18) {
    // Persistent claude session per persona. Each persona's first claude
    // task generates a session UUID; subsequent tasks pass --resume <id> so
    // claude itself remembers what tools were called, what files were
    // touched, and what was discussed — beyond what we manually inject in
    // the team-activity / persona-history blocks.
    try { db.exec(`ALTER TABLE personas ADD COLUMN claude_session_id TEXT`); } catch {}
    setVersion(18);
  }

  if (currentVersion < 19) {
    // Plan-level auto-merge. When true, sequential plans approve+merge each
    // subtask's push request before advancing to the next subtask. Without
    // it, every persona's branch starts from main with no prior section
    // applied, so chained file-edit plans (e.g. accumulating into a single
    // doc) lose work when only one branch can be merged at the end.
    try { db.exec(`ALTER TABLE plans ADD COLUMN auto_merge INTEGER DEFAULT 0`); } catch {}
    setVersion(19);
  }

  if (currentVersion < 20) {
    // Per-persona runtime selector. Lets a persona run on hermes (or codex /
    // opencode) instead of always defaulting to claude — useful for routing
    // research/writing personas to cheaper or non-Claude models when the
    // Claude quota gets tight.
    try { db.exec(`ALTER TABLE personas ADD COLUMN agent_type TEXT DEFAULT 'claude'`); } catch {}
    setVersion(20);
  }

  if (currentVersion < 21) {
    // Indexes for the orchestrator's hot paths. The dispatcher ticks every 4s
    // and the plan engine fans out across personas — without these,
    // gatherPersonaHistory + auto-merge + claude session resume all do
    // unindexed scans on tables that grow indefinitely.
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_persona_status_date ON tasks(persona_id, status, updated_at DESC)`); } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_push_requests_agent ON push_requests(agent_id)`); } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_personas_claude_session ON personas(claude_session_id)`); } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id)`); } catch {}
    setVersion(21);
  }

  // Unconditional safety: ensure a default project always exists. Rebinds any
  // orphaned personas/agents/tasks to it. Previously this was gated on schema
  // version, which left users with an empty projects table stranded.
  try {
    const projectCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number }).c;
    if (projectCount === 0) {
      const now = Date.now();
      db.prepare(
        `INSERT INTO projects (id, name, repo, branch, working_dir, goal, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('default', 'workspace', null, null, null, null, now, now);
    }
    const activeId = (db.prepare(`SELECT value FROM settings WHERE key = 'active_project_id'`).get() as { value?: string } | undefined)?.value;
    if (!activeId) {
      const first = (db.prepare(`SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1`).get() as { id?: string } | undefined)?.id;
      if (first) {
        db.prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES ('active_project_id', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).run(first, Date.now());
      }
    }
  } catch {}
}

// ── Projects ────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  repo: string | null;
  branch: string | null;
  working_dir: string | null;
  goal: string | null;
  created_at: number;
  updated_at: number;
}

export function getAllProjects(): Project[] {
  const db = getDb();
  return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Project[];
}

export function getProjectById(id: string): Project | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
}

export function createProject(p: {
  id: string;
  name: string;
  repo?: string | null;
  branch?: string | null;
  working_dir?: string | null;
  goal?: string | null;
}): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (id, name, repo, branch, working_dir, goal, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.id,
    p.name,
    p.repo ?? null,
    p.branch ?? null,
    p.working_dir ?? null,
    p.goal ?? null,
    now,
    now,
  );
}

const ALLOWED_PROJECT_COLUMNS = new Set(['name', 'repo', 'branch', 'working_dir', 'goal']);

export function updateProject(id: string, updates: Partial<Omit<Project, 'id' | 'created_at' | 'updated_at'>>): void {
  const db = getDb();
  const safeKeys = Object.keys(updates).filter(k => ALLOWED_PROJECT_COLUMNS.has(k));
  if (safeKeys.length === 0) return;
  const fields = safeKeys.map(k => `${k} = @${k}`).join(', ');
  const safeUpdates = Object.fromEntries(
    safeKeys.map(k => [k, (updates as Record<string, unknown>)[k] ?? null])
  );
  db.prepare(`UPDATE projects SET ${fields}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...safeUpdates, updated_at: Date.now(), id });
}

export function deleteProject(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  // If this was the active project, clear that pointer; UI will pick another.
  const active = getSetting('active_project_id');
  if (active === id) {
    db.prepare('DELETE FROM settings WHERE key = ?').run('active_project_id');
  }
}

export function getActiveProject(): Project | undefined {
  const id = getSetting('active_project_id');
  if (id) {
    const found = getProjectById(id);
    if (found) return found;
  }
  // Fall back to most-recently-updated project so the UI never breaks.
  const all = getAllProjects();
  return all[0];
}

export function setActiveProject(id: string): void {
  const found = getProjectById(id);
  if (!found) throw new Error(`project ${id} not found`);
  setSetting('active_project_id', id);
}

// Settings helpers
export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, Date.now());
}

/**
 * Default persona-pack slugs to auto-install whenever a new project is
 * created. Stored as a JSON array on the `default_pack_slugs` setting.
 * The first time a user installs a pack, it's added here automatically so
 * the next project they spin up gets the same starter team without thinking
 * about it.
 */
export function getDefaultPackSlugs(): string[] {
  try {
    const raw = getSetting('default_pack_slugs');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

export function addDefaultPackSlug(slug: string): void {
  const current = getDefaultPackSlugs();
  if (current.includes(slug)) return;
  setSetting('default_pack_slugs', JSON.stringify([...current, slug]));
}

export function removeDefaultPackSlug(slug: string): void {
  const current = getDefaultPackSlugs();
  if (!current.includes(slug)) return;
  setSetting('default_pack_slugs', JSON.stringify(current.filter(s => s !== slug)));
}

// Agent queries
export function getAllAgents(limit = 200, projectId?: string): Agent[] {
  const db = getDb();
  const whereClause = projectId ? 'WHERE a.project_id = ?' : '';
  const params: unknown[] = projectId ? [projectId, limit] : [limit];
  return db.prepare(`
    SELECT a.*, l.content AS last_log
    FROM agents a
    LEFT JOIN (
      SELECT agent_id, content
      FROM logs l2
      WHERE l2.stream = 'stdout'
        AND length(l2.content) > 10
        AND l2.content NOT LIKE '%thinking%'
        AND l2.content NOT LIKE '%Osmosing%'
        AND l2.content NOT LIKE '%Manifesting%'
        AND l2.content NOT LIKE '%Crafting%'
        AND l2.content NOT LIKE '%Transfiguring%'
        AND (l2.agent_id, l2.id) IN (
          SELECT agent_id, MAX(id)
          FROM logs
          WHERE stream = 'stdout'
            AND length(content) > 10
            AND content NOT LIKE '%thinking%'
            AND content NOT LIKE '%Osmosing%'
            AND content NOT LIKE '%Manifesting%'
            AND content NOT LIKE '%Crafting%'
            AND content NOT LIKE '%Transfiguring%'
          GROUP BY agent_id
        )
    ) l ON l.agent_id = a.id
    ${whereClause}
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(...params) as Agent[];
}

export function getAgentById(id: string): Agent | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
}

export function createAgent(agent: Omit<Agent, 'updated_at'>): void {
  const db = getDb();
  const now = Date.now();
  // Default project: whichever is active when the agent is born.
  const projectId = agent.project_id ?? getSetting('active_project_id') ?? 'default';
  db.prepare(`
    INSERT INTO agents (id, name, type, status, task, repo, worktree_path, pid, port, project_id, created_at, updated_at)
    VALUES (@id, @name, @type, @status, @task, @repo, @worktree_path, @pid, @port, @project_id, @created_at, @updated_at)
  `).run({ ...agent, project_id: projectId, updated_at: now });
}

const ALLOWED_AGENT_COLUMNS = new Set([
  'name', 'type', 'status', 'task', 'repo', 'worktree_path',
  'pid', 'port', 'created_at', 'depends_on', 'project_id',
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

// Delete agents (and their related data) older than 30 days if they are done/error/killed
export function cleanupOldAgents(): void {
  const db = getDb();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  db.prepare(`
    DELETE FROM logs WHERE agent_id IN (
      SELECT id FROM agents WHERE status IN ('done', 'error', 'killed') AND created_at < ?
    )
  `).run(cutoff);
  db.prepare(`
    DELETE FROM pty_chunks WHERE agent_id IN (
      SELECT id FROM agents WHERE status IN ('done', 'error', 'killed') AND created_at < ?
    )
  `).run(cutoff);
  db.prepare(`
    DELETE FROM token_usage WHERE agent_id IN (
      SELECT id FROM agents WHERE status IN ('done', 'error', 'killed') AND created_at < ?
    )
  `).run(cutoff);
  db.prepare(`
    DELETE FROM agents WHERE status IN ('done', 'error', 'killed') AND created_at < ?
  `).run(cutoff);
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
  const escapedQuery = safeQuery.replace(/%/g, '\\%').replace(/_/g, '\\_');
  return db.prepare(`SELECT l.*, a.name as agent_name FROM logs l JOIN agents a ON l.agent_id = a.id WHERE l.content LIKE ? ESCAPE '\\' ORDER BY l.timestamp DESC LIMIT ?`).all(`%${escapedQuery}%`, safeLimit);
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

export function createCronJob(job: {
  id: string;
  name: string;
  schedule: string;
  task: string;
  agent_type?: string;
  model?: string;
  repo?: string;
  persona_id?: string | null;
  project_id?: string | null;
}): void {
  const now = Date.now();
  getDb().prepare(
    `INSERT INTO cron_jobs
       (id, name, schedule, task, agent_type, model, repo, persona_id, project_id, enabled, run_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  ).run(
    job.id,
    job.name,
    job.schedule,
    job.task,
    job.agent_type || 'claude',
    job.model || 'sonnet',
    job.repo || null,
    job.persona_id ?? null,
    job.project_id ?? getSetting('active_project_id') ?? 'default',
    now,
    now,
  );
}

const ALLOWED_CRON_COLUMNS = new Set(['name', 'schedule', 'task', 'agent_type', 'model', 'repo', 'enabled', 'persona_id']);

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

export function getPushRequests(status?: string, limit = 50, projectId?: string): any[] {
  const db = getDb();
  // Push requests don't carry project_id directly — they inherit from the
  // owning agent. We always LEFT JOIN to expose project metadata so the UI
  // can label cross-project rows; INNER JOIN when scoping (orphaned PRs whose
  // agent rows are gone are intentionally hidden in scoped views).
  const baseSelect = `pr.*, a.project_id AS project_id, p.name AS project_name`;
  if (projectId) {
    if (status) {
      return db.prepare(
        `SELECT ${baseSelect}
         FROM push_requests pr
         JOIN agents a ON a.id = pr.agent_id
         LEFT JOIN projects p ON p.id = a.project_id
         WHERE pr.status = ? AND a.project_id = ?
         ORDER BY pr.created_at DESC LIMIT ?`
      ).all(status, projectId, limit);
    }
    return db.prepare(
      `SELECT ${baseSelect}
       FROM push_requests pr
       JOIN agents a ON a.id = pr.agent_id
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.project_id = ?
       ORDER BY pr.created_at DESC LIMIT ?`
    ).all(projectId, limit);
  }
  if (status) {
    return db.prepare(
      `SELECT ${baseSelect}
       FROM push_requests pr
       LEFT JOIN agents a ON a.id = pr.agent_id
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE pr.status = ?
       ORDER BY pr.created_at DESC LIMIT ?`
    ).all(status, limit);
  }
  return db.prepare(
    `SELECT ${baseSelect}
     FROM push_requests pr
     LEFT JOIN agents a ON a.id = pr.agent_id
     LEFT JOIN projects p ON p.id = a.project_id
     ORDER BY pr.created_at DESC LIMIT ?`
  ).all(limit);
}

export function getPushRequest(id: string): any {
  const db = getDb();
  const pr = db.prepare('SELECT * FROM push_requests WHERE id = ?').get(id);
  if (pr) return pr;
  // Try prefix match
  return db.prepare('SELECT * FROM push_requests WHERE id LIKE ? ORDER BY created_at DESC LIMIT 1').get(id + '%');
}

export function getPendingPushRequestsCount(projectId?: string): number {
  const db = getDb();
  if (projectId) {
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM push_requests pr JOIN agents a ON a.id = pr.agent_id
       WHERE pr.status = 'pending' AND a.project_id = ?`
    ).get(projectId) as { count: number };
    return row.count;
  }
  const row = db.prepare("SELECT COUNT(*) as count FROM push_requests WHERE status = 'pending'").get() as { count: number };
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

// ── Pending questions ──────────────────────────────────────────────────────

export type PendingQuestionStatus = 'open' | 'resolved' | 'cancelled';

export interface PendingQuestion {
  id: string;
  agent_id: string;
  project_id: string | null;
  question: string;
  options_json: string | null;
  default_choice: string | null;
  status: PendingQuestionStatus;
  resolution: string | null;
  original_task: string | null;
  created_at: number;
  resolved_at: number | null;
}

export interface PendingQuestionWithAgent extends PendingQuestion {
  agent_name: string | null;
  agent_status: string | null;
}

export function createPendingQuestion(q: {
  id: string;
  agent_id: string;
  project_id?: string | null;
  question: string;
  options?: string[] | null;
  default_choice?: string | null;
  original_task?: string | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO pending_questions (id, agent_id, project_id, question, options_json, default_choice, status, original_task, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  ).run(
    q.id,
    q.agent_id,
    q.project_id ?? null,
    q.question,
    q.options ? JSON.stringify(q.options) : null,
    q.default_choice ?? null,
    q.original_task ?? null,
    Date.now(),
  );
}

export function getPendingQuestionById(id: string): PendingQuestion | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM pending_questions WHERE id = ?').get(id) as PendingQuestion | undefined;
}

export function getOpenPendingQuestions(projectId?: string, limit = 100): PendingQuestionWithAgent[] {
  const db = getDb();
  const where = projectId
    ? `WHERE q.status = 'open' AND q.project_id = ?`
    : `WHERE q.status = 'open'`;
  const params: unknown[] = projectId ? [projectId, limit] : [limit];
  return db.prepare(`
    SELECT q.*, a.name AS agent_name, a.status AS agent_status
    FROM pending_questions q
    LEFT JOIN agents a ON a.id = q.agent_id
    ${where}
    ORDER BY q.created_at DESC
    LIMIT ?
  `).all(...params) as PendingQuestionWithAgent[];
}

export function getOpenPendingQuestionsForAgent(agentId: string): PendingQuestion[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM pending_questions WHERE agent_id = ? AND status = 'open' ORDER BY created_at ASC`
  ).all(agentId) as PendingQuestion[];
}

export function getOpenPendingQuestionsCount(projectId?: string): number {
  const db = getDb();
  if (projectId) {
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM pending_questions WHERE status = 'open' AND project_id = ?`
    ).get(projectId) as { count: number };
    return row.count;
  }
  const row = db.prepare(
    `SELECT COUNT(*) as count FROM pending_questions WHERE status = 'open'`
  ).get() as { count: number };
  return row.count;
}

export function resolvePendingQuestion(id: string, resolution: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE pending_questions SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ? AND status = 'open'`
  ).run(resolution, Date.now(), id);
}

export function cancelPendingQuestion(id: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE pending_questions SET status = 'cancelled', resolved_at = ? WHERE id = ? AND status = 'open'`
  ).run(Date.now(), id);
}

export function cancelPendingQuestionsForAgent(agentId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE pending_questions SET status = 'cancelled', resolved_at = ? WHERE agent_id = ? AND status = 'open'`
  ).run(Date.now(), agentId);
}

// ── Personas ───────────────────────────────────────────────────────────────

export type PersonaStatus = 'idle' | 'working' | 'needs_input' | 'offline' | 'error';
export type PersonaAutonomy = 'manual' | 'auto';

export interface Persona {
  id: string;
  project_id: string | null;
  slug: string;
  name: string;
  role: string | null;
  avatar: string | null;
  color: string | null;
  model: string | null;
  agent_type: string | null; // 'claude' | 'hermes' | 'codex' | 'opencode'; default claude when null
  skills_json: string | null;
  system_prompt: string | null;
  autonomy: PersonaAutonomy;
  status: PersonaStatus;
  current_agent_id: string | null;
  current_task_id: string | null;
  last_agent_id: string | null;
  last_active: number | null;
  claude_session_id: string | null;
  created_at: number;
  updated_at: number;
}

export function getPersonas(projectId?: string): Persona[] {
  const db = getDb();
  if (projectId) {
    return db.prepare(`SELECT * FROM personas WHERE project_id = ? ORDER BY name ASC`).all(projectId) as Persona[];
  }
  return db.prepare(`SELECT * FROM personas ORDER BY name ASC`).all() as Persona[];
}

export function getPersonaById(id: string): Persona | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM personas WHERE id = ?`).get(id) as Persona | undefined;
}

export function getPersonaBySlug(slug: string, projectId: string): Persona | undefined {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM personas WHERE slug = ? AND project_id = ?`
  ).get(slug, projectId) as Persona | undefined;
}

export function createPersona(p: {
  id: string;
  project_id?: string | null;
  slug: string;
  name: string;
  role?: string | null;
  avatar?: string | null;
  color?: string | null;
  model?: string | null;
  skills?: string[] | null;
  system_prompt?: string | null;
  autonomy?: PersonaAutonomy;
}): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO personas
      (id, project_id, slug, name, role, avatar, color, model, skills_json, system_prompt, autonomy, status, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)
  `).run(
    p.id,
    p.project_id ?? getSetting('active_project_id') ?? 'default',
    p.slug,
    p.name,
    p.role ?? null,
    p.avatar ?? null,
    p.color ?? null,
    p.model ?? null,
    p.skills ? JSON.stringify(p.skills) : null,
    p.system_prompt ?? null,
    p.autonomy ?? 'manual',
    now,
    now,
  );
}

const ALLOWED_PERSONA_COLUMNS = new Set([
  'name', 'role', 'avatar', 'color', 'model', 'skills_json', 'system_prompt',
  'autonomy', 'status', 'current_agent_id', 'current_task_id', 'last_agent_id', 'last_active',
  'claude_session_id', 'agent_type',
]);

export function updatePersona(id: string, updates: Partial<Persona>): void {
  const db = getDb();
  const safeKeys = Object.keys(updates).filter(k => ALLOWED_PERSONA_COLUMNS.has(k));
  if (safeKeys.length === 0) return;
  const fields = safeKeys.map(k => `${k} = @${k}`).join(', ');
  const safeUpdates = Object.fromEntries(safeKeys.map(k => [k, (updates as Record<string, unknown>)[k] ?? null]));
  db.prepare(`UPDATE personas SET ${fields}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...safeUpdates, updated_at: Date.now(), id });
}

export function setPersonaStatus(
  id: string,
  status: PersonaStatus,
  opts?: { agentId?: string | null; taskId?: string | null }
): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    UPDATE personas
    SET status = ?, current_agent_id = ?, current_task_id = ?, last_active = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status,
    opts?.agentId !== undefined ? opts.agentId : null,
    opts?.taskId !== undefined ? opts.taskId : null,
    now,
    now,
    id,
  );
}

export function deletePersona(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM personas WHERE id = ?`).run(id);
}

export function getPersonaForAgent(agentId: string): Persona | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM personas WHERE current_agent_id = ?`).get(agentId) as Persona | undefined;
}

// ── Enhanced tasks (task board) ────────────────────────────────────────────

export type BoardTaskStatus = 'open' | 'assigned' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export interface BoardTask {
  id: string;
  title: string | null;
  description: string;
  status: string;
  agent_id: string | null;
  persona_id: string | null;
  project_id: string | null;
  required_skills_json: string | null;
  priority: number;
  deadline: number | null;
  created_at: number;
  updated_at: number | null;
  result: string | null;
  plan_id: string | null;
  step_order: number | null;
  depends_on_json: string | null;
  canvas_x: number | null;
  canvas_y: number | null;
  from_persona_id: string | null;
  from_task_id: string | null;
  handoff_reason: string | null;
  completion: 'confirmed' | 'auto' | 'truncated' | 'refused' | null;
}

export interface BoardTaskWithPersona extends BoardTask {
  persona_name: string | null;
  persona_color: string | null;
  from_persona_name?: string | null;
  from_persona_color?: string | null;
  push_request_id?: string | null;
  push_request_status?: string | null;
  push_request_files?: number | null;
}

export function getBoardTasks(projectId?: string, status?: string): BoardTaskWithPersona[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (projectId) { conditions.push('t.project_id = ?'); params.push(projectId); }
  if (status) { conditions.push('t.status = ?'); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // Use a correlated subquery to pick only the *most recent* push_request per
  // task's agent. Without this, an agent that produced multiple PRs (e.g.
  // initial PR + a retried PR) fans the join out and the same task id appears
  // twice in the result — causing duplicate-React-key warnings on the board.
  const rows = db.prepare(`
    SELECT t.*,
           p.name AS persona_name, p.color AS persona_color,
           fp.name AS from_persona_name, fp.color AS from_persona_color,
           pr.id AS push_request_id, pr.status AS push_request_status,
           pr.changed_files_json AS push_request_files_json
    FROM tasks t
    LEFT JOIN personas p ON p.id = t.persona_id
    LEFT JOIN personas fp ON fp.id = t.from_persona_id
    LEFT JOIN push_requests pr ON pr.id = (
      SELECT id FROM push_requests
      WHERE agent_id = t.agent_id
      ORDER BY created_at DESC
      LIMIT 1
    )
    ${where}
    ORDER BY
      CASE t.status
        WHEN 'in_progress' THEN 0
        WHEN 'blocked' THEN 1
        WHEN 'assigned' THEN 2
        WHEN 'open' THEN 3
        WHEN 'done' THEN 4
        WHEN 'cancelled' THEN 5
        ELSE 6
      END,
      t.priority DESC,
      t.created_at DESC
  `).all(...params) as Array<BoardTaskWithPersona & { push_request_files_json?: string | null }>;
  for (const r of rows) {
    if (r.push_request_files_json) {
      try {
        const arr = JSON.parse(r.push_request_files_json);
        r.push_request_files = Array.isArray(arr) ? arr.length : 0;
      } catch { r.push_request_files = 0; }
    } else {
      r.push_request_files = null;
    }
    delete (r as unknown as Record<string, unknown>).push_request_files_json;
  }
  return rows;
}

export function getBoardTaskById(id: string): BoardTask | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as BoardTask | undefined;
}

export function createBoardTask(t: {
  id: string;
  title: string;
  description?: string;
  project_id?: string | null;
  persona_id?: string | null;
  required_skills?: string[] | null;
  priority?: number;
  deadline?: number | null;
  plan_id?: string | null;
  step_order?: number | null;
  status?: string;
  from_persona_id?: string | null;
  from_task_id?: string | null;
  handoff_reason?: string | null;
}): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO tasks
      (id, title, description, status, agent_id, persona_id, project_id, required_skills_json, priority, deadline, created_at, updated_at, result, plan_id, step_order, from_persona_id, from_task_id, handoff_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
  `).run(
    t.id,
    t.title,
    t.description ?? t.title,
    t.status ?? (t.persona_id ? 'assigned' : 'open'),
    null,
    t.persona_id ?? null,
    t.project_id ?? getSetting('active_project_id') ?? 'default',
    t.required_skills ? JSON.stringify(t.required_skills) : null,
    t.priority ?? 0,
    t.deadline ?? null,
    now,
    now,
    t.plan_id ?? null,
    t.step_order ?? null,
    t.from_persona_id ?? null,
    t.from_task_id ?? null,
    t.handoff_reason ?? null,
  );
}

const ALLOWED_BOARD_TASK_COLUMNS = new Set([
  'title', 'description', 'status', 'agent_id', 'persona_id',
  'required_skills_json', 'priority', 'deadline', 'result',
  'depends_on_json', 'canvas_x', 'canvas_y', 'step_order',
  'completion',
]);

export function updateBoardTask(id: string, updates: Partial<BoardTask>): void {
  const db = getDb();
  const safeKeys = Object.keys(updates).filter(k => ALLOWED_BOARD_TASK_COLUMNS.has(k));
  if (safeKeys.length === 0) return;
  const fields = safeKeys.map(k => `${k} = @${k}`).join(', ');
  const safeUpdates = Object.fromEntries(safeKeys.map(k => [k, (updates as Record<string, unknown>)[k] ?? null]));
  db.prepare(`UPDATE tasks SET ${fields}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...safeUpdates, updated_at: Date.now(), id });
}

export function deleteBoardTask(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
}

/**
 * Bulk-delete cancelled tasks. Used by the auto-prune on startup and by the
 * "clear cancelled" affordance in the UI. Optionally scoped to a project.
 *
 * `olderThanMs`: only remove tasks whose `updated_at` (or `created_at` if
 * missing) is older than this. Default 0 = delete all cancelled. Pass a
 * positive number from the caller to keep a recent grace window.
 */
export function deleteCancelledTasks(opts: {
  projectId?: string;
  olderThanMs?: number;
} = {}): { removed: number } {
  const db = getDb();
  const cutoff = opts.olderThanMs ? Date.now() - opts.olderThanMs : Date.now();
  const params: unknown[] = ['cancelled', cutoff];
  let where = `status = ? AND COALESCE(updated_at, created_at, 0) <= ?`;
  if (opts.projectId) {
    where += ` AND project_id = ?`;
    params.push(opts.projectId);
  }
  const result = db.prepare(`DELETE FROM tasks WHERE ${where}`).run(...params);
  return { removed: result.changes };
}

/**
 * Find an open task with required skills that one of the given personas can pick up.
 * Returns the highest-priority oldest open task whose required_skills are a subset
 * of the persona's skills, or any open task if it has no required_skills.
 */
export function findPickupTaskFor(personaSkills: string[], projectId: string): BoardTask | undefined {
  const db = getDb();
  const candidates = db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'open' AND project_id = ?
    ORDER BY priority DESC, created_at ASC
  `).all(projectId) as BoardTask[];
  for (const t of candidates) {
    if (!t.required_skills_json) return t;
    try {
      const required: string[] = JSON.parse(t.required_skills_json);
      if (required.every(s => personaSkills.includes(s))) return t;
    } catch {
      return t;
    }
  }
  return undefined;
}

// ── Plans ──────────────────────────────────────────────────────────────────

export type PlanStatus = 'draft' | 'active' | 'done' | 'cancelled';
export type PlanExecutionMode = 'parallel' | 'sequential';

export interface Plan {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: PlanStatus;
  execution_mode: PlanExecutionMode;
  auto_merge: number; // sqlite stores booleans as 0/1
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface PlanWithSubtasks extends Plan {
  subtasks: BoardTaskWithPersona[];
  total: number;
  done: number;
}

export function getPlans(projectId?: string): Plan[] {
  const db = getDb();
  if (projectId) {
    return db.prepare(`SELECT * FROM plans WHERE project_id = ? ORDER BY updated_at DESC`).all(projectId) as Plan[];
  }
  return db.prepare(`SELECT * FROM plans ORDER BY updated_at DESC`).all() as Plan[];
}

export function getPlanById(id: string): Plan | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM plans WHERE id = ?`).get(id) as Plan | undefined;
}

export function getPlanWithSubtasks(id: string): PlanWithSubtasks | undefined {
  const plan = getPlanById(id);
  if (!plan) return undefined;
  const db = getDb();
  const subtasks = db.prepare(`
    SELECT t.*, p.name AS persona_name, p.color AS persona_color
    FROM tasks t
    LEFT JOIN personas p ON p.id = t.persona_id
    WHERE t.plan_id = ?
    ORDER BY COALESCE(t.step_order, 0) ASC, t.created_at ASC
  `).all(id) as BoardTaskWithPersona[];
  return {
    ...plan,
    subtasks,
    total: subtasks.length,
    done: subtasks.filter(t => t.status === 'done').length,
  };
}

export function getPlansWithSubtasks(projectId?: string): PlanWithSubtasks[] {
  const plans = getPlans(projectId);
  return plans
    .map(p => getPlanWithSubtasks(p.id))
    .filter((p): p is PlanWithSubtasks => Boolean(p));
}

export function createPlan(p: {
  id: string;
  title: string;
  description?: string | null;
  project_id?: string | null;
  execution_mode?: PlanExecutionMode;
  auto_merge?: boolean;
}): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO plans (id, project_id, title, description, status, execution_mode, auto_merge, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)
  `).run(
    p.id,
    p.project_id ?? getSetting('active_project_id') ?? 'default',
    p.title,
    p.description ?? null,
    p.execution_mode ?? 'parallel',
    p.auto_merge ? 1 : 0,
    now,
    now,
  );
}

const ALLOWED_PLAN_COLUMNS = new Set([
  'title', 'description', 'status', 'execution_mode', 'started_at', 'finished_at',
]);

export function updatePlan(id: string, updates: Partial<Plan>): void {
  const db = getDb();
  const safeKeys = Object.keys(updates).filter(k => ALLOWED_PLAN_COLUMNS.has(k));
  if (safeKeys.length === 0) return;
  const fields = safeKeys.map(k => `${k} = @${k}`).join(', ');
  const safeUpdates = Object.fromEntries(safeKeys.map(k => [k, (updates as Record<string, unknown>)[k] ?? null]));
  db.prepare(`UPDATE plans SET ${fields}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...safeUpdates, updated_at: Date.now(), id });
}

export function deletePlan(id: string): void {
  const db = getDb();
  // Tasks referencing this plan are detached, not deleted — they become orphan
  // board tasks the user can keep, reassign, or delete individually.
  db.prepare(`UPDATE tasks SET plan_id = NULL, step_order = NULL WHERE plan_id = ?`).run(id);
  db.prepare(`DELETE FROM plans WHERE id = ?`).run(id);
}

/**
 * Look up the most recent push request created by this task's agent (if any).
 * Lets the OS task board surface a "view diff" affordance per task.
 */
export interface TaskPushRef {
  id: string;
  branch: string;
  base_branch: string;
  status: string;
  changed_count: number;
}

export function getPushRefForTask(taskId: string): TaskPushRef | undefined {
  const db = getDb();
  const row = db.prepare(`
    SELECT pr.id, pr.branch, pr.base_branch, pr.status, pr.changed_files_json
    FROM push_requests pr
    JOIN tasks t ON t.agent_id = pr.agent_id
    WHERE t.id = ?
    ORDER BY pr.created_at DESC
    LIMIT 1
  `).get(taskId) as { id: string; branch: string; base_branch: string; status: string; changed_files_json: string | null } | undefined;
  if (!row) return undefined;
  let count = 0;
  try {
    const arr = row.changed_files_json ? JSON.parse(row.changed_files_json) : [];
    if (Array.isArray(arr)) count = arr.length;
  } catch {}
  return { id: row.id, branch: row.branch, base_branch: row.base_branch, status: row.status, changed_count: count };
}

/** Returns subtasks for a plan ordered by step. */
export function getSubtasksForPlan(planId: string): BoardTaskWithPersona[] {
  const db = getDb();
  return db.prepare(`
    SELECT t.*, p.name AS persona_name, p.color AS persona_color
    FROM tasks t
    LEFT JOIN personas p ON p.id = t.persona_id
    WHERE t.plan_id = ?
    ORDER BY COALESCE(t.step_order, 0) ASC, t.created_at ASC
  `).all(planId) as BoardTaskWithPersona[];
}

/**
 * Recent done tasks the persona completed on this project. Used to feed
 * project-level memory context when waking the persona on a new task.
 * Excludes the task currently being worked on (excludeTaskId).
 */
export function getRecentTasksForPersona(
  personaId: string,
  projectId: string | null,
  limit: number,
  excludeTaskId?: string,
): BoardTask[] {
  const db = getDb();
  const params: unknown[] = [personaId];
  let where = `persona_id = ? AND status = 'done' AND result IS NOT NULL AND result != ''`;
  if (projectId) {
    where += ` AND project_id = ?`;
    params.push(projectId);
  }
  if (excludeTaskId) {
    where += ` AND id != ?`;
    params.push(excludeTaskId);
  }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM tasks WHERE ${where} ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ?`,
  ).all(...params) as BoardTask[];
}

/**
 * Recent done tasks across the project, regardless of which persona did them.
 * Used to give every persona a glimpse of what their teammates have just
 * shipped — the cross-persona memory layer beyond plan-level dep context.
 *
 * Excludes a persona (typically the persona currently being prompted, so the
 * block doesn't duplicate their own history) and an optional current task.
 */
export function getRecentTeamActivity(
  projectId: string,
  limit: number,
  excludePersonaId?: string,
  excludeTaskId?: string,
): Array<BoardTask & { persona_name: string | null; persona_slug: string | null }> {
  const db = getDb();
  const params: unknown[] = [projectId];
  let where = `t.project_id = ? AND t.status = 'done' AND t.result IS NOT NULL AND t.result != ''`;
  if (excludePersonaId) {
    where += ` AND (t.persona_id IS NULL OR t.persona_id != ?)`;
    params.push(excludePersonaId);
  }
  if (excludeTaskId) {
    where += ` AND t.id != ?`;
    params.push(excludeTaskId);
  }
  params.push(limit);
  return db.prepare(
    `SELECT t.*, p.name AS persona_name, p.slug AS persona_slug
     FROM tasks t LEFT JOIN personas p ON p.id = t.persona_id
     WHERE ${where}
     ORDER BY COALESCE(t.updated_at, t.created_at) DESC
     LIMIT ?`,
  ).all(...params) as Array<BoardTask & { persona_name: string | null; persona_slug: string | null }>;
}

// ── Task lists (reusable task templates) ───────────────────────────────────

export interface TaskListItem {
  title: string;
  description?: string;
  required_skills?: string[];
  persona_id?: string | null;
}

export interface TaskList {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  items_json: string;
  created_at: number;
  updated_at: number;
}

export function getTaskLists(projectId?: string): TaskList[] {
  const db = getDb();
  if (projectId) {
    return db.prepare(`SELECT * FROM task_lists WHERE project_id = ? ORDER BY updated_at DESC`).all(projectId) as TaskList[];
  }
  return db.prepare(`SELECT * FROM task_lists ORDER BY updated_at DESC`).all() as TaskList[];
}

export function getTaskListById(id: string): TaskList | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM task_lists WHERE id = ?`).get(id) as TaskList | undefined;
}

export function createTaskList(t: {
  id: string;
  title: string;
  description?: string | null;
  project_id?: string | null;
  items?: TaskListItem[];
}): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO task_lists (id, project_id, title, description, items_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.id,
    t.project_id ?? getSetting('active_project_id') ?? 'default',
    t.title,
    t.description ?? null,
    JSON.stringify(t.items ?? []),
    now,
    now,
  );
}

const ALLOWED_TASK_LIST_COLUMNS = new Set(['title', 'description', 'items_json']);

export function updateTaskList(id: string, updates: Partial<TaskList>): void {
  const db = getDb();
  const safeKeys = Object.keys(updates).filter(k => ALLOWED_TASK_LIST_COLUMNS.has(k));
  if (safeKeys.length === 0) return;
  const fields = safeKeys.map(k => `${k} = @${k}`).join(', ');
  const safeUpdates = Object.fromEntries(safeKeys.map(k => [k, (updates as Record<string, unknown>)[k] ?? null]));
  db.prepare(`UPDATE task_lists SET ${fields}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...safeUpdates, updated_at: Date.now(), id });
}

export function deleteTaskList(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM task_lists WHERE id = ?`).run(id);
}
