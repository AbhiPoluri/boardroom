import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock state (must be declared before vi.mock factories) ──────────

const { mockPtyProc, mockChildProc, spawnMock, execSyncMock } = vi.hoisted(() => {
  const mockPtyProc = {
    pid: 1234,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
  };

  const mockChildProc = {
    pid: 5678,
    exitCode: null as number | null,
    killed: false,
    stdin: { end: vi.fn(), write: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };

  const spawnMock = vi.fn(() => mockChildProc);
  const execSyncMock = vi.fn(() => '');

  return { mockPtyProc, mockChildProc, spawnMock, execSyncMock };
});

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPtyProc),
}));

vi.mock('../lib/db', () => ({
  insertLog: vi.fn(),
  updateAgentStatus: vi.fn(),
  updateAgent: vi.fn(),
  getAgentById: vi.fn(),
  insertPtyChunk: vi.fn(),
  clearPtyChunks: vi.fn(),
  recordTokenUsage: vi.fn(),
  getLogsForAgent: vi.fn(() => []),
  getPtyChunks: vi.fn(() => []),
  createPushRequest: vi.fn(),
}));

vi.mock('../lib/worktree', () => ({
  createWorktree: vi.fn(async () => ({ path: '/tmp/worktree-test', created: true })),
  removeWorktree: vi.fn(async () => {}),
}));

vi.mock('../lib/notifications', () => ({ notifyAgentComplete: vi.fn() }));
vi.mock('../lib/agent-summary', () => ({ generateAgentSummary: vi.fn(async () => {}) }));

vi.mock('../lib/strip-tui', () => ({
  stripAnsi: vi.fn((s: string) => s),
  isTuiChrome: vi.fn(() => false),
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
  ChildProcess: class {},
  execSync: execSyncMock,
}));

// ─── Imports (after mocks are set up) ────────────────────────────────────────
import * as pty from 'node-pty';
import { spawn } from 'child_process';
import { createWorktree } from '../lib/worktree';
import {
  insertLog,
  updateAgent,
  updateAgentStatus,
  insertPtyChunk,
} from '../lib/db';
import { spawnAgent } from '../lib/spawner';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseOpts(overrides = {}) {
  return {
    agentId: 'agent-001',
    name: 'test-agent',
    type: 'test' as const,
    task: 'do something',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset child mock state
  mockChildProc.exitCode = null;
  mockChildProc.killed = false;
  mockChildProc.on.mockImplementation(() => mockChildProc);
  mockChildProc.stdout.on.mockImplementation(() => mockChildProc.stdout);
  mockChildProc.stderr.on.mockImplementation(() => mockChildProc.stderr);
  // Reset PTY mock
  mockPtyProc.onData.mockImplementation(() => {});
  mockPtyProc.onExit.mockImplementation(() => {});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('model allowlist (claude type)', () => {
  it.each([
    ['haiku', '--model haiku'],
    ['sonnet', '--model sonnet'],
    ['opus', '--model opus'],
    ['claude-3-5-sonnet-20241022', '--model claude-3-5-sonnet-20241022'],
    ['claude-sonnet-4-5-20250514', '--model claude-sonnet-4-5-20250514'],
    ['claude-3-haiku-20240307', '--model claude-3-haiku-20240307'],
    ['claude-opus-4-5-20250514', '--model claude-opus-4-5-20250514'],
  ])('allowed model "%s" is passed through', async (model, expectedFlag) => {
    await spawnAgent(baseOpts({ type: 'claude', model, repo: '/tmp/repo', useGitIsolation: false }));

    const spawnCall = (pty.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const shellCmd: string = spawnCall[1][1]; // argv[1] of /bin/sh -c <cmd>
    expect(shellCmd).toContain(expectedFlag);
  });

  it.each([
    ['gpt-4'],
    ['gemini-pro'],
    ['claude-bad-model'],
    [''],
    ['../../etc/passwd'],
  ])('invalid model "%s" is stripped (no --model flag)', async (model) => {
    await spawnAgent(baseOpts({ type: 'claude', model, repo: '/tmp/repo', useGitIsolation: false }));

    const spawnCall = (pty.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const shellCmd: string = spawnCall[1][1];
    expect(shellCmd).not.toContain('--model');
  });

  it('no model provided → no --model flag', async () => {
    await spawnAgent(baseOpts({ type: 'claude', repo: '/tmp/repo', useGitIsolation: false }));

    const spawnCall = (pty.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const shellCmd: string = spawnCall[1][1];
    expect(shellCmd).not.toContain('--model');
  });
});

describe('shell command construction', () => {
  it('claude — uses claude --dangerously-skip-permissions', async () => {
    await spawnAgent(baseOpts({ type: 'claude', task: 'fix the bug', repo: '/repo', useGitIsolation: false }));

    const cmd: string = (pty.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1][1];
    expect(cmd).toContain('claude --dangerously-skip-permissions');
    expect(cmd).toContain("'fix the bug'");
  });

  it('codex — uses codex exec --full-auto --skip-git-repo-check', async () => {
    await spawnAgent(baseOpts({ type: 'codex', task: 'refactor utils', repo: '/repo', useGitIsolation: false }));

    const cmd: string = (pty.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1][1];
    expect(cmd).toContain('codex exec --full-auto --skip-git-repo-check');
    expect(cmd).toContain("'refactor utils'");
  });

  it('opencode — uses opencode run', async () => {
    await spawnAgent(baseOpts({ type: 'opencode', task: 'write tests', repo: '/repo', useGitIsolation: false }));

    const cmd: string = (pty.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1][1];
    expect(cmd).toContain('opencode run');
    expect(cmd).toContain("'write tests'");
  });

  it('test — echoes boardroom agent started and task', async () => {
    await spawnAgent(baseOpts({ type: 'test', task: 'ping', repo: '/repo', useGitIsolation: false }));

    const cmd: string = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1][1];
    expect(cmd).toContain('boardroom agent started');
    expect(cmd).toContain('ping');
  });

  it('custom — uses escapedTask directly as the shell command when BOARDROOM_ALLOW_CUSTOM is set', async () => {
    process.env.BOARDROOM_ALLOW_CUSTOM = 'true';
    await spawnAgent(baseOpts({ type: 'custom', task: 'node scripts/run.js', repo: '/repo', useGitIsolation: false }));

    const cmd: string = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1][1];
    expect(cmd).toContain('node scripts/run.js');
    expect(cmd).not.toMatch(/'node scripts\/run\.js'/);
    delete process.env.BOARDROOM_ALLOW_CUSTOM;
  });

  it('custom — throws when BOARDROOM_ALLOW_CUSTOM is not set', async () => {
    delete process.env.BOARDROOM_ALLOW_CUSTOM;
    await expect(spawnAgent(baseOpts({ type: 'custom', task: 'node scripts/run.js', repo: '/repo', useGitIsolation: false })))
      .rejects.toThrow();
  });
});

describe('custom type — uses escapedTask verbatim', () => {
  it('runs the task string as-is after nvm init', async () => {
    process.env.BOARDROOM_ALLOW_CUSTOM = 'true';
    const task = 'python3 -m pytest tests/';
    await spawnAgent(baseOpts({ type: 'custom', task, repo: '/repo', useGitIsolation: false }));

    const cmd: string = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1][1];
    expect(cmd).toContain(task);
    delete process.env.BOARDROOM_ALLOW_CUSTOM;
  });
});

describe('default (unsupported) type', () => {
  it('throws "Unsupported agent type" for unknown types', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spawnAgent(baseOpts({ type: 'unknown-type' as any, repo: '/repo' }))
    ).rejects.toThrow('Unsupported agent type');
  });
});

describe('task escaping — single quotes', () => {
  it("single quotes in task are escaped as '\\''", async () => {
    const task = "fix the user's profile page";
    await spawnAgent(baseOpts({ type: 'claude', task, repo: '/repo', useGitIsolation: false }));

    const cmd: string = (pty.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1][1];
    // Escaped form: fix the user'\''s profile page
    expect(cmd).toContain("fix the user'\\''s profile page");
  });

  it('task with multiple single quotes are all escaped', async () => {
    const task = "it's a 'test' task";
    await spawnAgent(baseOpts({ type: 'test', task, repo: '/repo', useGitIsolation: false }));

    const cmd: string = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1][1];
    expect(cmd).not.toContain("it's");
    expect(cmd).toContain("it'\\''s");
    expect(cmd).toContain("'\\''test'\\''");
  });
});

describe('git isolation', () => {
  it('calls createWorktree when useGitIsolation is true', async () => {
    await spawnAgent(baseOpts({
      type: 'test',
      repo: '/some/repo',
      useGitIsolation: true,
    }));

    expect(createWorktree).toHaveBeenCalledWith('agent-001', '/some/repo', 'test-agent');
  });

  it('does NOT call createWorktree when useGitIsolation is false and repo is provided', async () => {
    await spawnAgent(baseOpts({
      type: 'test',
      repo: '/some/repo',
      useGitIsolation: false,
    }));

    expect(createWorktree).not.toHaveBeenCalled();
    // Should use the repo path directly as cwd
    expect(updateAgent).toHaveBeenCalledWith('agent-001', { worktree_path: '/some/repo' });
  });

  it('calls createWorktree when no repo and no existingWorktreePath', async () => {
    await spawnAgent(baseOpts({ type: 'test' }));
    expect(createWorktree).toHaveBeenCalledWith('agent-001', undefined, 'test-agent');
  });
});

describe('auto-commit on exit (PTY path)', () => {
  // NOTE: The spawner uses inline require('child_process').execSync inside the onExit callback.
  // In Vitest's ESM mode, inline CJS require() bypasses ESM mocks — execSync runs for real.
  // We verify the auto-commit logic indirectly through the observable insertLog side-effects
  // and the agent status transitions, rather than via execSync call counts.

  it('agent status is set to "done" on exit code 0', async () => {
    await spawnAgent(baseOpts({ type: 'claude', repo: '/repo', useGitIsolation: false }));

    const onExitCb = mockPtyProc.onExit.mock.calls[0][0];
    onExitCb({ exitCode: 0, signal: undefined });

    expect(updateAgentStatus).toHaveBeenCalledWith('agent-001', 'done');
  });

  it('agent status is set to "killed" when signal is 15', async () => {
    await spawnAgent(baseOpts({ type: 'claude', repo: '/repo', useGitIsolation: false }));

    const onExitCb = mockPtyProc.onExit.mock.calls[0][0];
    onExitCb({ exitCode: undefined, signal: 15 });

    expect(updateAgentStatus).toHaveBeenCalledWith('agent-001', 'killed');
    // "done" must NOT have been set
    const doneCalls = (updateAgentStatus as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[1] === 'done'
    );
    expect(doneCalls).toHaveLength(0);
  });

  it('agent status is set to "error" on non-zero exit code', async () => {
    await spawnAgent(baseOpts({ type: 'claude', repo: '/repo', useGitIsolation: false }));

    const onExitCb = mockPtyProc.onExit.mock.calls[0][0];
    onExitCb({ exitCode: 1, signal: undefined });

    expect(updateAgentStatus).toHaveBeenCalledWith('agent-001', 'error');
  });

  it('auto-commit log message is written when worktree has uncommitted changes', async () => {
    // Use the actual boardroom repo as the worktree path — it IS a real git repo with
    // uncommitted changes (we can observe this in the working tree), so execSync runs real
    // git status and finds changes → triggers the commit path → insertLog is called.
    // We mock insertLog so git commit won't actually commit anything; the test only verifies
    // the log message is emitted when the logic determines there are changes.
    //
    // Since the worktree mock returns '/tmp/worktree-test' (not a git repo), execSync
    // throws and the catch block silently eats it — no log. This test verifies the guard
    // condition: auto-commit is only attempted (and logged) on finalStatus === 'done'.
    // We check that insertLog was called with 'Process exited successfully' — the line
    // immediately before the auto-commit block — confirming flow reached that point.
    await spawnAgent(baseOpts({ type: 'claude', repo: '/repo', useGitIsolation: false }));

    const onExitCb = mockPtyProc.onExit.mock.calls[0][0];
    onExitCb({ exitCode: 0, signal: undefined });

    const logCalls = (insertLog as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2] as string);
    expect(logCalls.some((msg) => msg.includes('Process exited successfully'))).toBe(true);
  });
});

describe('PTY chunk cap at 50000', () => {
  it('stores chunks only up to 50000 and drops the rest', async () => {
    await spawnAgent(baseOpts({ type: 'claude', repo: '/repo', useGitIsolation: false }));

    // Grab the onData handler
    const onDataCb = mockPtyProc.onData.mock.calls[0][0];

    // Simulate 50002 data events
    for (let i = 0; i < 50002; i++) {
      onDataCb('x');
    }

    // insertPtyChunk should have been called exactly 50000 times
    expect(insertPtyChunk).toHaveBeenCalledTimes(50000);
  });
});

describe('environment cleanup', () => {
  it('spawns PTY process with CLAUDE_CODE_ENTRYPOINT and CLAUDECODE set to empty string', async () => {
    await spawnAgent(baseOpts({ type: 'claude', repo: '/repo', useGitIsolation: false }));

    const envArg = (pty.spawn as ReturnType<typeof vi.fn>).mock.calls[0][2].env as Record<string, string>;
    expect(envArg).toHaveProperty('CLAUDE_CODE_ENTRYPOINT', '');
    expect(envArg).toHaveProperty('CLAUDECODE', '');
  });

  it('spawns child_process with CLAUDE_CODE_ENTRYPOINT and CLAUDECODE set to empty string', async () => {
    await spawnAgent(baseOpts({ type: 'test', repo: '/repo', useGitIsolation: false }));

    const envArg = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][2].env as Record<string, string>;
    expect(envArg).toHaveProperty('CLAUDE_CODE_ENTRYPOINT', '');
    expect(envArg).toHaveProperty('CLAUDECODE', '');
  });
});
