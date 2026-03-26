/**
 * Unit tests for lib/db.ts
 *
 * Each test suite uses a fresh in-memory (or temp) SQLite database by setting
 * process.env.DB_PATH before the module is first loaded.  Because db.ts uses a
 * module-level singleton (_db) we reset it between tests via the resetDb()
 * helper so every test starts with a clean state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return a fresh in-memory Database with the same schema that db.ts applies.
 * We import the internal initSchema indirectly by re-using getDb() after
 * pointing the singleton at a new in-memory db.  The cleanest way to do this
 * without Jest module mocking is to reach into the module's internals — but
 * since db.ts honours DB_PATH we instead use a temp file per test so each
 * invocation of getDb() produces an independent database.
 */

// We'll import the db module functions lazily after resetting the singleton.
// The pattern: set DB_PATH → call resetDbSingleton() → then call functions.

let tempDbPath: string;

/** Wipe the module-level _db singleton so the next getDb() creates a fresh DB */
async function getDbModule() {
  return await import('@/lib/db');
}

/** Create a new temp file path for this test */
function newTempPath(): string {
  return path.join(os.tmpdir(), `boardroom-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

/** Reset the singleton by directly manipulating it via a small shim. */
async function resetSingleton(filePath: string): Promise<typeof import('@/lib/db')> {
  // We can't truly re-import without clearing the module cache (vitest isolates
  // modules per file but not per test).  Instead we expose a thin backdoor:
  // directly mutate the private _db via the module's getDb() mechanism by
  // closing the current db and then replacing the path.
  //
  // The simplest cross-test isolation strategy that works with vitest's ESM
  // cache is to close the old DB and then write a helper that re-opens with
  // the new path.  We do this by importing the module and calling a
  // resetDbForTesting() shim we'll add — but we don't want to modify lib/db.ts.
  //
  // Alternative: use vi.resetModules() + dynamic re-import each time.
  const { vi } = await import('vitest');
  vi.resetModules();
  process.env.DB_PATH = filePath;
  return import('@/lib/db');
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<{ id: string; name: string; status: string }> = {}) {
  const id = overrides.id ?? `agent-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    name: overrides.name ?? 'Test Agent',
    type: 'claude' as const,
    status: (overrides.status ?? 'running') as import('@/types').AgentStatus,
    task: 'do something',
    repo: null,
    worktree_path: null,
    pid: null,
    port: null,
    created_at: Date.now(),
  };
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('schema initialisation', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  it('creates all core tables', async () => {
    // Trigger schema creation
    db.getDb();
    const raw = new Database(tempDbPath);
    const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map(r => r.name);
    raw.close();

    const expected = [
      'agents', 'logs', 'tasks', 'pty_chunks', 'chat_messages',
      'token_usage', 'bus_messages', 'agent_summaries', 'workflows',
      'notifications', 'orchestrator_memory', 'push_requests',
      'workflow_runs', 'cron_jobs', 'settings', 'schema_version',
    ];
    for (const t of expected) {
      expect(tables).toContain(t);
    }
  });

  it('sets schema_version to at least 4 on fresh db', () => {
    db.getDb();
    const raw = new Database(tempDbPath);
    const row = raw.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number };
    raw.close();
    expect(row.version).toBeGreaterThanOrEqual(4);
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

describe('getSetting / setSetting', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  it('returns null for an unknown key', () => {
    expect(db.getSetting('nonexistent')).toBeNull();
  });

  it('round-trips a value', () => {
    db.setSetting('theme', 'dark');
    expect(db.getSetting('theme')).toBe('dark');
  });

  it('overwrites an existing key (upsert)', () => {
    db.setSetting('theme', 'dark');
    db.setSetting('theme', 'light');
    expect(db.getSetting('theme')).toBe('light');
  });

  it('stores independent keys separately', () => {
    db.setSetting('a', '1');
    db.setSetting('b', '2');
    expect(db.getSetting('a')).toBe('1');
    expect(db.getSetting('b')).toBe('2');
  });
});

// ─── Agent CRUD ───────────────────────────────────────────────────────────────

describe('createAgent / getAgentById / getAllAgents', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  it('inserts and retrieves a single agent', () => {
    const agent = makeAgent({ id: 'a1', name: 'Alpha' });
    db.createAgent(agent);
    const result = db.getAgentById('a1');
    expect(result).toBeDefined();
    expect(result!.name).toBe('Alpha');
    expect(result!.status).toBe('running');
  });

  it('returns undefined for a missing agent', () => {
    expect(db.getAgentById('does-not-exist')).toBeUndefined();
  });

  it('getAllAgents returns all inserted agents ordered by created_at DESC', () => {
    const t = Date.now();
    db.createAgent({ ...makeAgent({ id: 'old' }), created_at: t - 2000 });
    db.createAgent({ ...makeAgent({ id: 'new' }), created_at: t });
    const agents = db.getAllAgents();
    expect(agents.length).toBe(2);
    expect(agents[0].id).toBe('new');
    expect(agents[1].id).toBe('old');
  });

  it('getAllAgents respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) db.createAgent(makeAgent());
    expect(db.getAllAgents(3).length).toBe(3);
  });
});

// ─── updateAgentStatus ────────────────────────────────────────────────────────

describe('updateAgentStatus', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  it('transitions status without changing pid when pid omitted', () => {
    const agent = makeAgent({ id: 'x1' });
    db.createAgent({ ...agent, pid: 42 });
    db.updateAgentStatus('x1', 'done');
    const updated = db.getAgentById('x1')!;
    expect(updated.status).toBe('done');
    expect(updated.pid).toBe(42); // pid unchanged
  });

  it('updates both status and pid when pid provided', () => {
    db.createAgent(makeAgent({ id: 'x2' }));
    db.updateAgentStatus('x2', 'running', 9999);
    const updated = db.getAgentById('x2')!;
    expect(updated.status).toBe('running');
    expect(updated.pid).toBe(9999);
  });

  it('transitions through all valid statuses', () => {
    db.createAgent(makeAgent({ id: 'x3', status: 'spawning' }));
    const statuses: import('@/types').AgentStatus[] = ['running', 'idle', 'done', 'error', 'killed'];
    for (const s of statuses) {
      db.updateAgentStatus('x3', s);
      expect(db.getAgentById('x3')!.status).toBe(s);
    }
  });
});

// ─── Log operations ───────────────────────────────────────────────────────────

describe('insertLog / getLogsForAgent', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  it('inserts a log and retrieves it', () => {
    db.createAgent(makeAgent({ id: 'ag1' }));
    db.insertLog('ag1', 'stdout', 'hello world');
    const logs = db.getLogsForAgent('ag1');
    expect(logs.length).toBe(1);
    expect(logs[0].content).toBe('hello world');
    expect(logs[0].stream).toBe('stdout');
  });

  it('returns empty array for agent with no logs', () => {
    db.createAgent(makeAgent({ id: 'ag2' }));
    expect(db.getLogsForAgent('ag2')).toHaveLength(0);
  });

  it('respects limit and offset', () => {
    db.createAgent(makeAgent({ id: 'ag3' }));
    for (let i = 0; i < 5; i++) db.insertLog('ag3', 'stdout', `line ${i}`);
    expect(db.getLogsForAgent('ag3', 2, 0)).toHaveLength(2);
    expect(db.getLogsForAgent('ag3', 100, 3)).toHaveLength(2);
  });
});

// ─── searchLogs — wildcard escaping ──────────────────────────────────────────

describe('searchLogs', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  it('returns matching log entries', () => {
    db.createAgent(makeAgent({ id: 'sl1', name: 'SearchAgent' }));
    db.insertLog('sl1', 'stdout', 'error: file not found');
    db.insertLog('sl1', 'stdout', 'process started');
    const results = db.searchLogs('error');
    expect(results.length).toBe(1);
    expect((results[0] as { content: string }).content).toContain('error');
  });

  it('treats % in query as a literal percent (not wildcard)', () => {
    db.createAgent(makeAgent({ id: 'sl2', name: 'PctAgent' }));
    db.insertLog('sl2', 'stdout', 'progress: 50% done');
    db.insertLog('sl2', 'stdout', 'other line');
    // If % were treated as wildcard, both lines would match "50%"
    const exact = db.searchLogs('50%');
    expect(exact.length).toBe(1);
    expect((exact[0] as { content: string }).content).toContain('50%');
  });

  it('treats _ in query as a literal underscore (not wildcard)', () => {
    db.createAgent(makeAgent({ id: 'sl3', name: 'UnderAgent' }));
    db.insertLog('sl3', 'stdout', 'key_name found');
    db.insertLog('sl3', 'stdout', 'keyword found');
    // "key_name" with literal _ should only match the first line
    const results = db.searchLogs('key_name');
    expect(results.length).toBe(1);
  });

  it('respects the limit parameter', () => {
    db.createAgent(makeAgent({ id: 'sl4', name: 'LimitAgent' }));
    for (let i = 0; i < 10; i++) db.insertLog('sl4', 'stdout', `match line ${i}`);
    expect(db.searchLogs('match', 3).length).toBe(3);
  });

  it('caps limit at 500 internally', () => {
    db.createAgent(makeAgent({ id: 'sl5', name: 'CapAgent' }));
    for (let i = 0; i < 5; i++) db.insertLog('sl5', 'stdout', `line ${i}`);
    // Passing a huge limit — should not throw and returns at most 5 rows
    const results = db.searchLogs('line', 99999);
    expect(results.length).toBeLessThanOrEqual(500);
    expect(results.length).toBe(5);
  });
});

// ─── Push request lifecycle ───────────────────────────────────────────────────

describe('createPushRequest / getPushRequests / getPushRequest / updatePushRequest', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  function makePR(id: string) {
    return {
      id,
      agent_id: 'ag-x',
      agent_name: 'TestAgent',
      branch: `feature/${id}`,
      base_branch: 'main',
      summary: `Summary for ${id}`,
      changed_files_json: '["file.ts"]',
    };
  }

  it('creates a PR with pending status', () => {
    db.createPushRequest(makePR('pr1'));
    const pr = db.getPushRequest('pr1') as { status: string };
    expect(pr).toBeDefined();
    expect(pr.status).toBe('pending');
  });

  it('getPushRequests returns all when no filter', () => {
    db.createPushRequest(makePR('pr2'));
    db.createPushRequest(makePR('pr3'));
    expect(db.getPushRequests().length).toBe(2);
  });

  it('getPushRequests filters by status', () => {
    db.createPushRequest(makePR('pr4'));
    db.createPushRequest(makePR('pr5'));
    db.updatePushRequest('pr5', 'approved');
    expect(db.getPushRequests('pending').length).toBe(1);
    expect(db.getPushRequests('approved').length).toBe(1);
  });

  it('updatePushRequest sets approved status and comment', () => {
    db.createPushRequest(makePR('pr6'));
    db.updatePushRequest('pr6', 'approved', 'LGTM');
    const pr = db.getPushRequest('pr6') as { status: string; reviewer_comment: string };
    expect(pr.status).toBe('approved');
    expect(pr.reviewer_comment).toBe('LGTM');
  });

  it('updatePushRequest sets rejected status', () => {
    db.createPushRequest(makePR('pr7'));
    db.updatePushRequest('pr7', 'rejected', 'needs work');
    const pr = db.getPushRequest('pr7') as { status: string };
    expect(pr.status).toBe('rejected');
  });

  it('getPushRequest supports prefix matching', () => {
    db.createPushRequest(makePR('abcdef-123'));
    const pr = db.getPushRequest('abcdef');
    expect(pr).toBeDefined();
  });

  it('getPendingPushRequestsCount counts only pending', () => {
    db.createPushRequest(makePR('pr8'));
    db.createPushRequest(makePR('pr9'));
    db.updatePushRequest('pr9', 'approved');
    expect(db.getPendingPushRequestsCount()).toBe(1);
  });
});

// ─── Workflow CRUD ────────────────────────────────────────────────────────────

describe('saveWorkflow / getWorkflow / getAllWorkflows / deleteWorkflow', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  it('saves and retrieves a workflow', () => {
    db.saveWorkflow('wf1', 'My Flow', 'desc', [{ step: 1 }]);
    const wf = db.getWorkflow('wf1') as { name: string; steps_json: string };
    expect(wf).toBeDefined();
    expect(wf.name).toBe('My Flow');
    expect(JSON.parse(wf.steps_json)).toEqual([{ step: 1 }]);
  });

  it('getAllWorkflows returns all saved workflows', () => {
    db.saveWorkflow('wf2', 'Flow A', '', []);
    db.saveWorkflow('wf3', 'Flow B', '', []);
    expect(db.getAllWorkflows().length).toBe(2);
  });

  it('deleteWorkflow removes the record', () => {
    db.saveWorkflow('wf4', 'Temp', '', []);
    db.deleteWorkflow('wf4');
    expect(db.getWorkflow('wf4')).toBeUndefined();
  });

  it('upsert (saveWorkflow with same id) preserves created_at', () => {
    db.saveWorkflow('wf5', 'Original', '', []);
    const first = db.getWorkflow('wf5') as { created_at: number };
    // Short pause to ensure updated_at would differ
    db.saveWorkflow('wf5', 'Updated', '', [{ extra: true }]);
    const second = db.getWorkflow('wf5') as { name: string; created_at: number; updated_at: number };
    expect(second.name).toBe('Updated');
    expect(second.created_at).toBe(first.created_at);
  });

  it('saves optional schedule and cronEnabled', () => {
    db.saveWorkflow('wf6', 'Scheduled', '', [], { schedule: '0 * * * *', cronEnabled: 1 });
    const wf = db.getWorkflow('wf6') as { schedule: string; cron_enabled: number };
    expect(wf.schedule).toBe('0 * * * *');
    expect(wf.cron_enabled).toBe(1);
  });
});

// ─── cleanupOldAgents ─────────────────────────────────────────────────────────

describe('cleanupOldAgents', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  it('removes done/error/killed agents older than 30 days', () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    db.createAgent({ ...makeAgent({ id: 'old-done', status: 'done' }), created_at: old });
    db.createAgent({ ...makeAgent({ id: 'old-error', status: 'error' }), created_at: old });
    db.createAgent({ ...makeAgent({ id: 'old-killed', status: 'killed' }), created_at: old });
    db.cleanupOldAgents();
    expect(db.getAgentById('old-done')).toBeUndefined();
    expect(db.getAgentById('old-error')).toBeUndefined();
    expect(db.getAgentById('old-killed')).toBeUndefined();
  });

  it('keeps running agents regardless of age', () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    db.createAgent({ ...makeAgent({ id: 'old-running', status: 'running' }), created_at: old });
    db.cleanupOldAgents();
    expect(db.getAgentById('old-running')).toBeDefined();
  });

  it('keeps recent done agents (less than 30 days old)', () => {
    db.createAgent({ ...makeAgent({ id: 'recent-done', status: 'done' }), created_at: Date.now() - 1000 });
    db.cleanupOldAgents();
    expect(db.getAgentById('recent-done')).toBeDefined();
  });

  it('also removes associated logs for old done agents', () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    db.createAgent({ ...makeAgent({ id: 'ag-cleanup', status: 'done' }), created_at: old });
    db.insertLog('ag-cleanup', 'stdout', 'log line');
    db.cleanupOldAgents();
    expect(db.getLogsForAgent('ag-cleanup')).toHaveLength(0);
  });
});

// ─── Schema migration versioning ──────────────────────────────────────────────

describe('schema migration versioning', () => {
  it('fresh database reaches version 4', async () => {
    tempDbPath = newTempPath();
    const db = await resetSingleton(tempDbPath);
    db.getDb();
    const raw = new Database(tempDbPath);
    const row = raw.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number };
    raw.close();
    fs.unlinkSync(tempDbPath);
    expect(row.version).toBe(4);
  });

  it('does not reset version when getDb() is called twice', async () => {
    tempDbPath = newTempPath();
    const db = await resetSingleton(tempDbPath);
    db.getDb();
    db.getDb(); // second call — should be a no-op (singleton)
    const raw = new Database(tempDbPath);
    const row = raw.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number };
    raw.close();
    fs.unlinkSync(tempDbPath);
    expect(row.version).toBe(4);
  });

  it('adds depends_on column to agents table (migration v1)', async () => {
    tempDbPath = newTempPath();
    const db = await resetSingleton(tempDbPath);
    db.getDb();
    const raw = new Database(tempDbPath);
    const cols = (raw.pragma('table_info(agents)') as { name: string }[]).map(c => c.name);
    raw.close();
    fs.unlinkSync(tempDbPath);
    expect(cols).toContain('depends_on');
  });

  it('adds schedule / cron_enabled / layout_json to workflows (migration v2)', async () => {
    tempDbPath = newTempPath();
    const db = await resetSingleton(tempDbPath);
    db.getDb();
    const raw = new Database(tempDbPath);
    const cols = (raw.pragma('table_info(workflows)') as { name: string }[]).map(c => c.name);
    raw.close();
    fs.unlinkSync(tempDbPath);
    expect(cols).toContain('schedule');
    expect(cols).toContain('cron_enabled');
    expect(cols).toContain('layout_json');
  });
});

// ─── updateTask column allowlist ──────────────────────────────────────────────

describe('updateTask — column allowlist', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  function makeTask(id: string): import('@/types').Task {
    return {
      id,
      description: 'original description',
      status: 'pending',
      agent_id: null,
      created_at: Date.now(),
      result: null,
    };
  }

  it('updates allowed columns (status, result)', () => {
    db.createTask(makeTask('t1'));
    db.updateTask('t1', { status: 'done', result: 'success' });
    const task = db.getTaskById('t1')!;
    expect(task.status).toBe('done');
    expect(task.result).toBe('success');
  });

  it('ignores disallowed columns silently', () => {
    db.createTask(makeTask('t2'));
    // 'created_at' is not in the allowlist
    db.updateTask('t2', { created_at: 0 } as Partial<import('@/types').Task>);
    const task = db.getTaskById('t2')!;
    expect(task.created_at).not.toBe(0);
  });

  it('is a no-op when all supplied columns are disallowed', () => {
    db.createTask(makeTask('t3'));
    const before = db.getTaskById('t3')!;
    // Pass only disallowed keys — nothing should change
    db.updateTask('t3', { id: 'hacked' } as Partial<import('@/types').Task>);
    const after = db.getTaskById('t3')!;
    expect(after.description).toBe(before.description);
  });
});

// ─── updateCronJob column allowlist ───────────────────────────────────────────

describe('updateCronJob — column allowlist', () => {
  let db: typeof import('@/lib/db');

  beforeEach(async () => {
    tempDbPath = newTempPath();
    db = await resetSingleton(tempDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  function makeCronJob(id: string) {
    return { id, name: 'My Job', schedule: '*/5 * * * *', task: 'do the thing' };
  }

  it('updates allowed columns (name, schedule, enabled)', () => {
    db.createCronJob(makeCronJob('cj1'));
    db.updateCronJob('cj1', { name: 'Updated Job', enabled: 0 });
    const job = db.getCronJob('cj1') as { name: string; enabled: number };
    expect(job.name).toBe('Updated Job');
    expect(job.enabled).toBe(0);
  });

  it('ignores disallowed columns silently', () => {
    db.createCronJob(makeCronJob('cj2'));
    // 'run_count' is not in ALLOWED_CRON_COLUMNS
    db.updateCronJob('cj2', { run_count: 999 });
    const job = db.getCronJob('cj2') as { run_count: number };
    expect(job.run_count).toBe(0); // default from INSERT
  });

  it('is a no-op when all supplied columns are disallowed', () => {
    db.createCronJob(makeCronJob('cj3'));
    const before = db.getCronJob('cj3') as { name: string };
    db.updateCronJob('cj3', { id: 'hacked', run_count: 999 });
    const after = db.getCronJob('cj3') as { name: string };
    expect(after.name).toBe(before.name);
  });
});
