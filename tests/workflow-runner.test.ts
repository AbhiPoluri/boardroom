/**
 * Unit tests for lib/workflow-runner.ts
 *
 * Tests orchestration logic: topological sort, parallel execution, safety
 * limits, output passing, evaluator loops, router branching, deadlock
 * detection, status tracking, and cancellation.
 *
 * The activeRuns map is a module-level singleton. Tests that leave workflows
 * in 'running' state cancel them in afterEach to prevent bleed-through.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted before any module imports
// ---------------------------------------------------------------------------

vi.mock('../lib/db', () => ({
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  insertLog: vi.fn(),
  getAgentById: vi.fn(),
  getLogsForAgent: vi.fn(() => []),
  getAgentSummary: vi.fn(() => null),
  createWorkflowRun: vi.fn(),
  updateWorkflowRun: vi.fn(),
  updateWorkflowRunAgents: vi.fn(),
  updateWorkflowRunDetail: vi.fn(),
  getWorkflowRunById: vi.fn(() => null),
  getRecentWorkflowRuns: vi.fn(() => []),
}));

vi.mock('../lib/spawner', () => ({
  spawnAgent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/worktree', () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

vi.mock('@/lib/agent-configs', () => ({
  loadAgentConfigs: vi.fn(() => []),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  runWorkflow,
  cancelWorkflow,
  getWorkflowRun,
  getAllWorkflowRuns,
  type WorkflowStep,
} from '../lib/workflow-runner';

import * as db from '../lib/db';
import * as spawner from '../lib/spawner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make every getAgentById call return a terminal status immediately */
function mockAgentDone(status: 'done' | 'error' | 'killed' = 'done') {
  (db.getAgentById as ReturnType<typeof vi.fn>).mockReturnValue({ status });
}

/** Build a linear dependency chain A→B→C */
function chainSteps(...names: string[]): WorkflowStep[] {
  return names.map((name, i) => ({
    name,
    type: 'codex' as const,
    task: `task for ${name}`,
    dependsOn: i > 0 ? [names[i - 1]] : [],
  }));
}

/** Start a workflow and run all fake timers to let the async executor finish */
async function runAndSettle(
  name: string,
  workflowSteps: WorkflowStep[],
  repo = '/fake/repo',
): Promise<string> {
  const { runId } = await runWorkflow(name, workflowSteps, repo);
  await vi.runAllTimersAsync();
  return runId;
}

/** Cancel all currently running workflows — used in afterEach cleanup */
function cancelAllRunning() {
  for (const run of getAllWorkflowRuns()) {
    if (run.status === 'running') cancelWorkflow(run.runId);
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Default: every agent finishes immediately as 'done'
  mockAgentDone('done');
  (db.getAgentSummary as ReturnType<typeof vi.fn>).mockReturnValue({ summary: 'step output' });
  (db.getRecentWorkflowRuns as ReturnType<typeof vi.fn>).mockReturnValue([]);
});

afterEach(() => {
  // Cancel any hanging runs so they don't count against MAX_CONCURRENT_RUNS
  cancelAllRunning();
  vi.useRealTimers();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('workflow-runner', () => {

  // -------------------------------------------------------------------------
  // 1. Topological sort
  // -------------------------------------------------------------------------
  describe('topological sort', () => {
    it('spawns step B only after step A has completed', async () => {
      const spawnOrder: string[] = [];
      (spawner.spawnAgent as ReturnType<typeof vi.fn>).mockImplementation(
        ({ name }: { name: string }) => { spawnOrder.push(name); return Promise.resolve(); },
      );

      await runAndSettle('topo-ab', [
        { name: 'A', type: 'codex', task: 'do A' },
        { name: 'B', type: 'codex', task: 'do B', dependsOn: ['A'] },
      ]);

      expect(spawnOrder.indexOf('wf-A')).toBeLessThan(spawnOrder.indexOf('wf-B'));
    });

    it('respects a three-level chain A→B→C', async () => {
      const spawnOrder: string[] = [];
      (spawner.spawnAgent as ReturnType<typeof vi.fn>).mockImplementation(
        ({ name }: { name: string }) => { spawnOrder.push(name); return Promise.resolve(); },
      );

      await runAndSettle('topo-chain', chainSteps('A', 'B', 'C'));

      expect(spawnOrder.indexOf('wf-A')).toBeLessThan(spawnOrder.indexOf('wf-B'));
      expect(spawnOrder.indexOf('wf-B')).toBeLessThan(spawnOrder.indexOf('wf-C'));
    });
  });

  // -------------------------------------------------------------------------
  // 2. Parallel execution
  // -------------------------------------------------------------------------
  describe('parallel execution', () => {
    it('spawns all independent steps in the same batch before awaiting any', async () => {
      const batches: string[][] = [];
      let currentBatch: string[] = [];

      (spawner.spawnAgent as ReturnType<typeof vi.fn>).mockImplementation(
        ({ name }: { name: string }) => { currentBatch.push(name); return Promise.resolve(); },
      );
      (db.updateWorkflowRunAgents as ReturnType<typeof vi.fn>).mockImplementation(() => {
        if (currentBatch.length > 0) { batches.push([...currentBatch]); currentBatch = []; }
      });

      await runAndSettle('parallel-test', [
        { name: 'P1', type: 'codex', task: 'parallel 1' },
        { name: 'P2', type: 'codex', task: 'parallel 2' },
        { name: 'P3', type: 'codex', task: 'parallel 3' },
      ]);

      // All three should appear in the first (and only) batch
      const first = batches[0] ?? [];
      expect(first).toContain('wf-P1');
      expect(first).toContain('wf-P2');
      expect(first).toContain('wf-P3');
      expect(first).toHaveLength(3);
    });

    it('runs independent siblings before the join step', async () => {
      const spawnOrder: string[] = [];
      (spawner.spawnAgent as ReturnType<typeof vi.fn>).mockImplementation(
        ({ name }: { name: string }) => { spawnOrder.push(name); return Promise.resolve(); },
      );

      await runAndSettle('fan-in', [
        { name: 'sib-1', type: 'codex', task: 'sibling 1' },
        { name: 'sib-2', type: 'codex', task: 'sibling 2' },
        { name: 'join', type: 'codex', task: 'join', dependsOn: ['sib-1', 'sib-2'] },
      ]);

      const idxJoin = spawnOrder.indexOf('wf-join');
      expect(spawnOrder.indexOf('wf-sib-1')).toBeGreaterThanOrEqual(0);
      expect(spawnOrder.indexOf('wf-sib-2')).toBeGreaterThanOrEqual(0);
      expect(idxJoin).toBeGreaterThan(spawnOrder.indexOf('wf-sib-1'));
      expect(idxJoin).toBeGreaterThan(spawnOrder.indexOf('wf-sib-2'));
    });
  });

  // -------------------------------------------------------------------------
  // 3. Max agents per run
  // -------------------------------------------------------------------------
  describe('max agents per run', () => {
    it('errors the run before spawning the 16th agent', async () => {
      const tooMany: WorkflowStep[] = Array.from({ length: 16 }, (_, i) => ({
        name: `step-${i}`,
        type: 'codex' as const,
        task: `task ${i}`,
      }));

      const runId = await runAndSettle('overflow-test', tooMany);
      const run = getWorkflowRun(runId);

      expect(run?.status).toBe('error');
      // updateWorkflowRun is called with the 'error' status
      const errorCalls = (db.updateWorkflowRun as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: any[]) => c[0] === runId && c[1] === 'error');
      expect(errorCalls.length).toBeGreaterThan(0);
      expect(errorCalls[0][2]).toMatch(/Agent limit/);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Max concurrent runs
  // -------------------------------------------------------------------------
  describe('max concurrent runs', () => {
    it('throws when 3 runs are already active', async () => {
      // Agents stay 'running' so workflows never complete
      (db.getAgentById as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'running' });

      const hang: WorkflowStep[] = [{ name: 'hang', type: 'codex', task: 'hang' }];

      await runWorkflow('concurrent-1', hang, '/fake/repo');
      await runWorkflow('concurrent-2', hang, '/fake/repo');
      await runWorkflow('concurrent-3', hang, '/fake/repo');

      await expect(
        runWorkflow('concurrent-4', hang, '/fake/repo'),
      ).rejects.toThrow(/Too many concurrent workflow runs/);
      // afterEach will cancel the 3 hanging runs
    });
  });

  // -------------------------------------------------------------------------
  // 5. Output passing
  // -------------------------------------------------------------------------
  describe('output passing', () => {
    it('injects upstream step output into the downstream agent task', async () => {
      const capturedTasks: string[] = [];
      (db.createAgent as ReturnType<typeof vi.fn>).mockImplementation(
        (agent: { task: string }) => { capturedTasks.push(agent.task); },
      );
      (db.getAgentSummary as ReturnType<typeof vi.fn>).mockReturnValue({
        summary: 'OUTPUT_FROM_UPSTREAM',
      });

      await runAndSettle('output-passing', [
        { name: 'upstream', type: 'codex', task: 'produce output' },
        { name: 'downstream', type: 'codex', task: 'consume output', dependsOn: ['upstream'] },
      ]);

      const downstreamTask = capturedTasks.find(t => t.includes('consume output')) ?? '';
      expect(downstreamTask).toContain('OUTPUT_FROM_UPSTREAM');
      expect(downstreamTask).toContain('upstream');
    });

    it('does not inject context into a root step with no dependencies', async () => {
      const capturedTasks: string[] = [];
      (db.createAgent as ReturnType<typeof vi.fn>).mockImplementation(
        (agent: { task: string }) => { capturedTasks.push(agent.task); },
      );

      await runAndSettle('no-context', [
        { name: 'solo', type: 'codex', task: 'standalone task' },
      ]);

      const soloTask = capturedTasks[0] ?? '';
      expect(soloTask).not.toContain('Context from previous steps');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Evaluator step
  // -------------------------------------------------------------------------
  describe('evaluator step', () => {
    it('completes without retrying when evaluator outputs "approved"', async () => {
      (db.getAgentSummary as ReturnType<typeof vi.fn>).mockReturnValue({
        summary: 'approved — looks good',
      });

      const runId = await runAndSettle('eval-pass', [
        { name: 'writer', type: 'codex', task: 'write something' },
        {
          name: 'reviewer', type: 'codex', task: 'review',
          stepType: 'evaluator', dependsOn: ['writer'], maxRetries: 2,
        },
      ]);

      expect(getWorkflowRun(runId)?.status).toBe('done');
      // Exactly 2 agents: writer + reviewer, no retries
      expect(spawner.spawnAgent).toHaveBeenCalledTimes(2);
    });

    it('retries the target step on "fail" and resolves when re-eval returns "approved"', async () => {
      (db.getAgentSummary as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ summary: 'draft output' })           // writer
        .mockReturnValueOnce({ summary: 'fail — needs changes' })   // evaluator → fail
        .mockReturnValueOnce({ summary: 'improved output' })        // retry writer
        .mockReturnValueOnce({ summary: 'approved' });               // re-eval → pass

      const runId = await runAndSettle('eval-retry', [
        { name: 'writer', type: 'codex', task: 'write something' },
        {
          name: 'reviewer', type: 'codex', task: 'evaluate',
          stepType: 'evaluator', dependsOn: ['writer'], maxRetries: 3,
        },
      ]);

      expect(getWorkflowRun(runId)?.status).toBe('done');
      // writer + reviewer + retry-writer + re-eval = 4 spawns
      expect(spawner.spawnAgent).toHaveBeenCalledTimes(4);
    });

    it('errors the run when evaluator exhausts maxRetries', async () => {
      // Perpetually fail
      (db.getAgentSummary as ReturnType<typeof vi.fn>).mockReturnValue({
        summary: 'fail — rejected',
      });

      const runId = await runAndSettle('eval-exhaust', [
        { name: 'writer', type: 'codex', task: 'write something' },
        {
          name: 'reviewer', type: 'codex', task: 'evaluate',
          stepType: 'evaluator', dependsOn: ['writer'], maxRetries: 2,
        },
      ]);

      expect(getWorkflowRun(runId)?.status).toBe('error');
      const errCalls = (db.updateWorkflowRun as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: any[]) => c[0] === runId && c[1] === 'error');
      expect(errCalls[0][2]).toMatch(/reviewer/);
    });

    it('respects maxRetries = 1 (fails after a single retry)', async () => {
      (db.getAgentSummary as ReturnType<typeof vi.fn>).mockReturnValue({
        summary: 'fail — still wrong',
      });

      const runId = await runAndSettle('eval-max1', [
        { name: 'codex', type: 'codex', task: 'code it' },
        {
          name: 'eval', type: 'codex', task: 'check it',
          stepType: 'evaluator', dependsOn: ['codex'], maxRetries: 1,
        },
      ]);

      expect(getWorkflowRun(runId)?.status).toBe('error');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Router step
  // -------------------------------------------------------------------------
  describe('router step', () => {
    it('skips non-chosen routes and only spawns the matched branch', async () => {
      (db.getAgentSummary as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ summary: 'this is a feature-branch request' }) // router
        .mockReturnValue({ summary: 'done' });

      const runId = await runAndSettle('router-match', [
        {
          name: 'router', type: 'codex', task: 'decide',
          stepType: 'router', routes: ['feature-branch', 'bug-fix'],
        },
        { name: 'feature-branch', type: 'codex', task: 'feature work', dependsOn: ['router'] },
        { name: 'bug-fix', type: 'codex', task: 'bug work', dependsOn: ['router'] },
      ]);

      const run = getWorkflowRun(runId);
      expect(run?.status).toBe('done');
      expect(run?.skippedSteps).toContain('bug-fix');

      const spawnedNames = (spawner.spawnAgent as ReturnType<typeof vi.fn>).mock.calls
        .map((c: any[]) => c[0].name);
      expect(spawnedNames).toContain('wf-feature-branch');
      expect(spawnedNames).not.toContain('wf-bug-fix');
    });

    it('runs all routes when output does not match any route name', async () => {
      (db.getAgentSummary as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ summary: 'completely unrelated xyz output' }) // router
        .mockReturnValue({ summary: 'done' });

      const runId = await runAndSettle('router-no-match', [
        {
          name: 'router', type: 'codex', task: 'decide',
          stepType: 'router', routes: ['alpha-path', 'beta-path'],
        },
        { name: 'alpha-path', type: 'codex', task: 'alpha work', dependsOn: ['router'] },
        { name: 'beta-path', type: 'codex', task: 'beta work', dependsOn: ['router'] },
      ]);

      const run = getWorkflowRun(runId);
      expect(run?.status).toBe('done');
      expect(run?.skippedSteps).toHaveLength(0);

      const spawnedNames = (spawner.spawnAgent as ReturnType<typeof vi.fn>).mock.calls
        .map((c: any[]) => c[0].name);
      expect(spawnedNames).toContain('wf-alpha-path');
      expect(spawnedNames).toContain('wf-beta-path');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Deadlock detection
  // -------------------------------------------------------------------------
  describe('deadlock detection', () => {
    it('errors when steps have a circular dependency (A→B, B→A)', async () => {
      const runId = await runAndSettle('deadlock-circular', [
        { name: 'A', type: 'codex', task: 'A', dependsOn: ['B'] },
        { name: 'B', type: 'codex', task: 'B', dependsOn: ['A'] },
      ]);

      const run = getWorkflowRun(runId);
      expect(run?.status).toBe('error');
      expect(db.updateWorkflowRun).toHaveBeenCalledWith(
        runId, 'error', expect.stringContaining('Deadlock'),
      );
    });

    it('errors when a step depends on a name that does not exist in the workflow', async () => {
      const runId = await runAndSettle('deadlock-ghost', [
        { name: 'orphan', type: 'codex', task: 'orphan', dependsOn: ['nonexistent'] },
      ]);

      expect(getWorkflowRun(runId)?.status).toBe('error');
    });
  });

  // -------------------------------------------------------------------------
  // 9. Run status tracking
  // -------------------------------------------------------------------------
  describe('run status tracking', () => {
    it('transitions to done when all steps succeed', async () => {
      const runId = await runAndSettle('status-done', chainSteps('A', 'B'));

      expect(getWorkflowRun(runId)?.status).toBe('done');
      expect(db.updateWorkflowRun).toHaveBeenCalledWith(runId, 'done');
    });

    it('transitions to error when a standard step fails', async () => {
      (db.getAgentById as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ status: 'done' })   // step A succeeds
        .mockReturnValueOnce({ status: 'error' }); // step B fails

      const runId = await runAndSettle('status-error', [
        { name: 'A', type: 'codex', task: 'A' },
        { name: 'B', type: 'codex', task: 'B', dependsOn: ['A'] },
      ]);

      expect(getWorkflowRun(runId)?.status).toBe('error');
      expect(db.updateWorkflowRun).toHaveBeenCalledWith(
        runId, 'error', expect.stringContaining('B'),
      );
    });

    it('records every spawned agent in run.agents with their step names', async () => {
      const runId = await runAndSettle('agent-tracking', chainSteps('X', 'Y', 'Z'));
      const run = getWorkflowRun(runId);

      const stepNames = run?.agents.map(a => a.stepName) ?? [];
      expect(stepNames).toContain('X');
      expect(stepNames).toContain('Y');
      expect(stepNames).toContain('Z');
    });

    it('updates agent entries to a terminal status after completion', async () => {
      const runId = await runAndSettle('agent-status', chainSteps('solo'));
      const entry = getWorkflowRun(runId)?.agents[0];

      expect(['done', 'error', 'killed']).toContain(entry?.status);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Cancel workflow
  // -------------------------------------------------------------------------
  describe('cancel workflow', () => {
    it('returns true and marks the run as error', async () => {
      (db.getAgentById as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'running' });

      const { runId } = await runWorkflow(
        'cancel-active',
        [{ name: 'long-step', type: 'codex', task: 'long task' }],
        '/fake/repo',
      );

      expect(cancelWorkflow(runId)).toBe(true);
      expect(getWorkflowRun(runId)?.status).toBe('error');
      expect(db.updateWorkflowRun).toHaveBeenCalledWith(runId, 'error', 'Cancelled by user');
    });

    it('returns false for an unknown run id', () => {
      expect(cancelWorkflow('no-such-run')).toBe(false);
    });

    it('returns false when the run has already completed', async () => {
      const runId = await runAndSettle('already-done-cancel', chainSteps('A'));
      expect(cancelWorkflow(runId)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 11. getAllWorkflowRuns
  // -------------------------------------------------------------------------
  describe('getAllWorkflowRuns', () => {
    it('lists an in-progress workflow by runId and name', async () => {
      (db.getAgentById as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'running' });

      const { runId } = await runWorkflow(
        'listed-run',
        [{ name: 'step', type: 'codex', task: 'task' }],
        '/fake/repo',
      );

      const found = getAllWorkflowRuns().find(r => r.runId === runId);
      expect(found).toBeDefined();
      expect(found?.workflowName).toBe('listed-run');
      expect(found?.status).toBe('running');
    });
  });

  // -------------------------------------------------------------------------
  // 12. getWorkflowRun — DB fallback
  // -------------------------------------------------------------------------
  describe('getWorkflowRun', () => {
    it('returns null for a completely unknown run id', () => {
      expect(getWorkflowRun('totally-unknown')).toBeNull();
    });

    it('reads status and agents from DB when not in memory', () => {
      (db.getWorkflowRunById as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        id: 'db-run-id',
        workflow_id: 'my-workflow',
        status: 'done',
        agents_detail_json: JSON.stringify([{ stepName: 'X', agentId: 'abc', status: 'done' }]),
        step_outputs_json: JSON.stringify({ X: 'output text' }),
        agent_ids_json: null,
      });

      const result = getWorkflowRun('db-run-id');
      expect(result?.status).toBe('done');
      expect(result?.agents[0].stepName).toBe('X');
      expect(result?.stepOutputs['X']).toBe('output text');
    });
  });

  // -------------------------------------------------------------------------
  // 13. Duplicate workflow guard
  // -------------------------------------------------------------------------
  describe('duplicate workflow guard', () => {
    it('throws when trying to start the same workflow name while it is running', async () => {
      (db.getAgentById as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'running' });

      await runWorkflow(
        'unique-wf',
        [{ name: 'step', type: 'codex', task: 'task' }],
        '/fake/repo',
      );

      await expect(
        runWorkflow('unique-wf', [{ name: 'step', type: 'codex', task: 'task' }], '/fake/repo'),
      ).rejects.toThrow(/already running/);
    });
  });
});
