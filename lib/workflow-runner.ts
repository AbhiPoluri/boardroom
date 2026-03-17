import { v4 as uuidv4 } from 'uuid';
import { createAgent, updateAgent, insertLog, getAgentById, createWorkflowRun, updateWorkflowRun, updateWorkflowRunAgents } from './db';
import { spawnAgent } from './spawner';
import type { AgentType } from '@/types';

export interface WorkflowStep {
  name: string;
  type: AgentType;
  model?: string;
  task: string;
  parallel?: boolean;
}

export interface WorkflowRunResult {
  runId: string;
  agents: Array<{ stepName: string; agentId: string; status: string }>;
}

// In-memory run tracking
const activeRuns = new Map<string, {
  workflowName: string;
  steps: WorkflowStep[];
  agents: Array<{ stepName: string; agentId: string; status: string }>;
  currentStepIdx: number;
  status: 'running' | 'done' | 'error';
}>();

export function getWorkflowRun(runId: string) {
  return activeRuns.get(runId) || null;
}

export function getAllWorkflowRuns() {
  const runs: Array<{ runId: string; workflowName: string; status: string; agents: any[] }> = [];
  for (const [runId, run] of activeRuns) {
    runs.push({ runId, workflowName: run.workflowName, status: run.status, agents: run.agents });
  }
  return runs;
}

/** Wait for an agent to finish (poll db status) */
function waitForAgent(agentId: string, timeoutMs = 600_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const agent = getAgentById(agentId);
      if (!agent) return reject(new Error(`Agent ${agentId} not found`));
      if (['done', 'error', 'killed'].includes(agent.status)) {
        return resolve(agent.status);
      }
      if (Date.now() - start > timeoutMs) {
        return resolve('timeout');
      }
      setTimeout(check, 2000);
    };
    check();
  });
}

/** Spawn a single step as an agent */
async function spawnStepAgent(
  runId: string,
  step: WorkflowStep,
  stepIdx: number,
  repo?: string
): Promise<string> {
  const agentId = uuidv4();
  const agentName = `wf-${step.name}`;
  const now = Date.now();

  createAgent({
    id: agentId,
    name: agentName,
    type: step.type,
    status: 'spawning',
    task: step.task,
    repo: repo || null,
    worktree_path: null,
    pid: null,
    port: null,
    created_at: now,
  });

  insertLog(agentId, 'system', `Workflow step ${stepIdx + 1}: "${step.name}"`);

  spawnAgent({
    agentId,
    name: agentName,
    type: step.type,
    task: step.task,
    repo,
    model: step.model || 'sonnet',
  }).catch((err) => {
    console.error(`[workflow] Failed to spawn step "${step.name}":`, err);
  });

  return agentId;
}

/**
 * Execute a workflow by spawning agents for each step.
 * Sequential steps wait for the previous step to complete.
 * Parallel steps are spawned concurrently and all awaited together.
 */
export async function runWorkflow(
  workflowName: string,
  steps: WorkflowStep[],
  repo?: string,
): Promise<WorkflowRunResult> {
  const runId = uuidv4().slice(0, 12);

  const run = {
    workflowName,
    steps,
    agents: [] as Array<{ stepName: string; agentId: string; status: string }>,
    currentStepIdx: 0,
    status: 'running' as 'running' | 'done' | 'error',
  };
  activeRuns.set(runId, run);

  // Record in DB
  createWorkflowRun(runId, workflowName, []);

  // Group steps into batches: parallel steps grouped with previous sequential step
  // e.g. [seq, par, par, seq, par] => [[seq, par, par], [seq, par]]
  const batches: WorkflowStep[][] = [];
  for (const step of steps) {
    if (!step.parallel || batches.length === 0) {
      batches.push([step]);
    } else {
      batches[batches.length - 1].push(step);
    }
  }

  // Execute batches sequentially, steps within a batch in parallel
  (async () => {
    let stepOffset = 0;
    try {
      for (const batch of batches) {
        const agentIds: string[] = [];

        // Spawn all steps in this batch
        for (let i = 0; i < batch.length; i++) {
          const step = batch[i];
          const globalIdx = stepOffset + i;
          run.currentStepIdx = globalIdx;

          const agentId = await spawnStepAgent(runId, step, globalIdx, repo);
          agentIds.push(agentId);
          run.agents.push({ stepName: step.name, agentId, status: 'running' });
        }

        // Wait for all agents in this batch to complete
        const results = await Promise.all(
          agentIds.map((id) => waitForAgent(id))
        );

        // Update statuses
        for (let i = 0; i < results.length; i++) {
          const agentEntry = run.agents.find(a => a.agentId === agentIds[i]);
          if (agentEntry) agentEntry.status = results[i];
        }

        // Update agent IDs in DB
        updateWorkflowRunAgents(runId, run.agents.map(a => a.agentId));

        // If any step errored, stop the workflow
        if (results.some(r => r === 'error' || r === 'killed')) {
          run.status = 'error';
          activeRuns.set(runId, { ...run, status: 'error' });
          updateWorkflowRun(runId, 'error', 'One or more steps failed');
          return;
        }

        stepOffset += batch.length;
      }

      run.status = 'done';
      activeRuns.set(runId, { ...run, status: 'done' });
      updateWorkflowRun(runId, 'done');
    } catch (err) {
      console.error(`[workflow] Run ${runId} error:`, err);
      run.status = 'error';
      activeRuns.set(runId, { ...run, status: 'error' });
      updateWorkflowRun(runId, 'error', err instanceof Error ? err.message : 'Unknown error');
    }
  })();

  return { runId, agents: run.agents };
}
