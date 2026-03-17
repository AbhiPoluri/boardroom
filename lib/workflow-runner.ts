import { v4 as uuidv4 } from 'uuid';
import { createAgent, updateAgent, insertLog, getAgentById, getLogsForAgent, getAgentSummary, createWorkflowRun, updateWorkflowRun, updateWorkflowRunAgents } from './db';
import { spawnAgent } from './spawner';
import type { AgentType } from '@/types';

export interface WorkflowStep {
  name: string;
  type: AgentType;
  model?: string;
  task: string;
  parallel?: boolean;
  dependsOn?: string[];
  position?: { x: number; y: number };
  /** Step behavior: standard (default), evaluator (loops until pass), router (branches) */
  stepType?: 'standard' | 'evaluator' | 'router';
  /** For evaluator: max retries before giving up (default 3) */
  maxRetries?: number;
  /** For router: possible route targets (step names) */
  routes?: string[];
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
  /** Accumulated outputs from completed steps — keyed by step name */
  stepOutputs: Record<string, string>;
  /** Steps skipped by router decisions */
  skippedSteps: Set<string>;
}>();

export function getWorkflowRun(runId: string) {
  const run = activeRuns.get(runId);
  if (!run) return null;
  return {
    ...run,
    skippedSteps: Array.from(run.skippedSteps),
  };
}

export function getAllWorkflowRuns() {
  const runs: Array<{ runId: string; workflowName: string; status: string; agents: any[] }> = [];
  for (const [runId, run] of activeRuns) {
    runs.push({ runId, workflowName: run.workflowName, status: run.status, agents: run.agents });
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Extract the output of a completed agent (summary or last N log lines) */
function extractAgentOutput(agentId: string): string {
  // Prefer summary if available
  const summary = getAgentSummary(agentId) as { summary?: string } | undefined;
  if (summary?.summary) return summary.summary;

  // Fall back to last stdout logs
  const logs = getLogsForAgent(agentId, 500);
  const stdoutLines = logs
    .filter((l: any) => l.stream === 'stdout')
    .map((l: any) => l.content)
    .slice(-50); // Last 50 lines
  return stdoutLines.join('\n').slice(-4000); // Cap at 4k chars
}

/** Build context string from upstream step outputs for injection into a step's task */
function buildUpstreamContext(
  step: WorkflowStep,
  allSteps: WorkflowStep[],
  stepOutputs: Record<string, string>,
): string {
  // Find which steps this step depends on
  const deps = step.dependsOn || [];

  // If no explicit deps, use all steps that completed before this one
  // (determined by their position in the steps array)
  const upstreamNames = deps.length > 0
    ? deps
    : allSteps
        .slice(0, allSteps.indexOf(step))
        .map(s => s.name)
        .filter(name => name in stepOutputs);

  if (upstreamNames.length === 0) return '';

  const sections = upstreamNames
    .filter(name => stepOutputs[name])
    .map(name => `## Output from "${name}":\n${stepOutputs[name]}`);

  if (sections.length === 0) return '';

  return `\n\n---\nContext from previous steps:\n${sections.join('\n\n')}\n---\n`;
}

/** Parse router output to determine which route to take */
function parseRouterOutput(output: string, routes: string[]): string | null {
  const lower = output.toLowerCase();
  // Check if any route name appears in the output
  for (const route of routes) {
    if (lower.includes(route.toLowerCase())) return route;
  }
  // Check for "route: xxx" pattern
  const match = output.match(/route:\s*(\S+)/i);
  if (match) {
    const found = routes.find(r => r.toLowerCase() === match[1].toLowerCase());
    if (found) return found;
  }
  return null;
}

/** Parse evaluator output to determine pass/fail */
function parseEvaluatorResult(output: string): 'pass' | 'fail' {
  const lower = output.toLowerCase();
  // Explicit pass signals
  if (lower.includes('approved') || lower.includes('pass') || lower.includes('lgtm') || lower.includes('✅')) return 'pass';
  // Explicit fail signals
  if (lower.includes('blocked') || lower.includes('fail') || lower.includes('rejected') || lower.includes('needs changes') || lower.includes('❌')) return 'fail';
  // Default to pass if no clear signal
  return 'pass';
}

// ---------------------------------------------------------------------------
// Step spawning
// ---------------------------------------------------------------------------

/** Spawn a single step as an agent, with upstream context injected */
async function spawnStepAgent(
  runId: string,
  step: WorkflowStep,
  stepIdx: number,
  allSteps: WorkflowStep[],
  stepOutputs: Record<string, string>,
  repo?: string,
  taskOverride?: string,
): Promise<string> {
  const agentId = uuidv4();
  const agentName = `wf-${step.name}`;
  const now = Date.now();

  // Build the full task with upstream context
  const context = buildUpstreamContext(step, allSteps, stepOutputs);
  const baseTask = taskOverride || step.task;
  const fullTask = context ? `${baseTask}${context}` : baseTask;

  createAgent({
    id: agentId,
    name: agentName,
    type: step.type,
    status: 'spawning',
    task: fullTask,
    repo: repo || null,
    worktree_path: null,
    pid: null,
    port: null,
    created_at: now,
  });

  const typeLabel = step.stepType === 'evaluator' ? ' [evaluator]'
    : step.stepType === 'router' ? ' [router]'
    : '';
  insertLog(agentId, 'system', `Workflow step ${stepIdx + 1}: "${step.name}"${typeLabel}`);
  if (context) {
    insertLog(agentId, 'system', `Injected context from: ${(step.dependsOn || []).join(', ') || 'previous steps'}`);
  }

  spawnAgent({
    agentId,
    name: agentName,
    type: step.type,
    task: fullTask,
    repo,
    model: step.model || 'sonnet',
  }).catch((err) => {
    console.error(`[workflow] Failed to spawn step "${step.name}":`, err);
  });

  return agentId;
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Execute a workflow with support for:
 * - Output passing between steps (context injection)
 * - Evaluator-optimizer loops (retry on fail)
 * - Router nodes (conditional branching)
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
    stepOutputs: {} as Record<string, string>,
    skippedSteps: new Set<string>(),
  };
  activeRuns.set(runId, run);
  createWorkflowRun(runId, workflowName, []);

  // Build a dependency graph for DAG execution
  // Steps with no dependsOn run first; steps with dependsOn wait for those to finish
  const stepMap = new Map<string, WorkflowStep>();
  for (const s of steps) stepMap.set(s.name, s);

  // Execute using topological order respecting dependsOn
  (async () => {
    try {
      const completed = new Set<string>();
      const pending = new Set(steps.map(s => s.name));

      while (pending.size > 0) {
        // Find steps whose dependencies are all satisfied
        const ready: WorkflowStep[] = [];
        for (const name of pending) {
          const step = stepMap.get(name)!;
          // Skip steps that a router decided to skip
          if (run.skippedSteps.has(name)) {
            pending.delete(name);
            completed.add(name);
            continue;
          }
          const deps = step.dependsOn || [];
          if (deps.length === 0 || deps.every(d => completed.has(d) || run.skippedSteps.has(d))) {
            ready.push(step);
          }
        }

        if (ready.length === 0 && pending.size > 0) {
          // Deadlock — remaining steps have unresolvable deps
          run.status = 'error';
          updateWorkflowRun(runId, 'error', `Deadlock: steps [${[...pending].join(', ')}] have unresolved dependencies`);
          return;
        }

        // Remove ready steps from pending
        for (const s of ready) pending.delete(s.name);

        // Spawn all ready steps in parallel
        const batch: Array<{ step: WorkflowStep; agentId: string }> = [];
        for (const step of ready) {
          const idx = steps.indexOf(step);
          run.currentStepIdx = idx;

          const agentId = await spawnStepAgent(runId, step, idx, steps, run.stepOutputs, repo);
          batch.push({ step, agentId });
          run.agents.push({ stepName: step.name, agentId, status: 'running' });
        }

        // Wait for all agents in this batch
        const results = await Promise.all(
          batch.map(async ({ step, agentId }) => {
            const status = await waitForAgent(agentId);

            // Update agent entry
            const entry = run.agents.find(a => a.agentId === agentId);
            if (entry) entry.status = status;

            // Extract output for downstream steps
            if (status === 'done') {
              run.stepOutputs[step.name] = extractAgentOutput(agentId);
            }

            return { step, agentId, status };
          })
        );

        updateWorkflowRunAgents(runId, run.agents.map(a => a.agentId));

        // Process results — handle evaluators and routers
        for (const { step, agentId, status } of results) {
          if (status === 'error' || status === 'killed') {
            // Standard step failure stops the workflow
            if (step.stepType !== 'evaluator') {
              run.status = 'error';
              updateWorkflowRun(runId, 'error', `Step "${step.name}" failed`);
              return;
            }
          }

          // --- Evaluator-Optimizer Loop ---
          if (step.stepType === 'evaluator' && status === 'done') {
            const evalOutput = run.stepOutputs[step.name] || '';
            const evalResult = parseEvaluatorResult(evalOutput);

            if (evalResult === 'fail') {
              const maxRetries = step.maxRetries ?? 3;
              const deps = step.dependsOn || [];

              // Find the target step to retry (first dependency)
              const targetName = deps[0];
              const targetStep = targetName ? stepMap.get(targetName) : null;

              if (targetStep) {
                let retries = 0;
                let passed = false;

                while (retries < maxRetries && !passed) {
                  retries++;
                  insertLog(agentId, 'system', `Evaluator: FAIL — retrying "${targetName}" (attempt ${retries}/${maxRetries})`);

                  // Re-spawn the target step with evaluator feedback
                  const retryTask = `${targetStep.task}\n\n---\nPrevious attempt was evaluated and needs changes. Evaluator feedback:\n${evalOutput}\n\nPlease address the feedback and try again.\n---`;
                  const retryId = await spawnStepAgent(runId, targetStep, steps.indexOf(targetStep), steps, run.stepOutputs, repo, retryTask);
                  run.agents.push({ stepName: `${targetName} (retry ${retries})`, agentId: retryId, status: 'running' });

                  const retryStatus = await waitForAgent(retryId);
                  const retryEntry = run.agents.find(a => a.agentId === retryId);
                  if (retryEntry) retryEntry.status = retryStatus;

                  if (retryStatus === 'done') {
                    run.stepOutputs[targetName] = extractAgentOutput(retryId);

                    // Re-run the evaluator
                    const reEvalId = await spawnStepAgent(runId, step, steps.indexOf(step), steps, run.stepOutputs, repo);
                    run.agents.push({ stepName: `${step.name} (re-eval ${retries})`, agentId: reEvalId, status: 'running' });

                    const reEvalStatus = await waitForAgent(reEvalId);
                    const reEvalEntry = run.agents.find(a => a.agentId === reEvalId);
                    if (reEvalEntry) reEvalEntry.status = reEvalStatus;

                    if (reEvalStatus === 'done') {
                      const reEvalOutput = extractAgentOutput(reEvalId);
                      run.stepOutputs[step.name] = reEvalOutput;
                      if (parseEvaluatorResult(reEvalOutput) === 'pass') {
                        passed = true;
                        insertLog(reEvalId, 'system', `Evaluator: PASS after ${retries} retry(s)`);
                      }
                    }
                  } else {
                    // Retry failed to spawn/complete
                    break;
                  }
                }

                if (!passed) {
                  insertLog(agentId, 'system', `Evaluator: FAIL after ${maxRetries} retries — stopping workflow`);
                  run.status = 'error';
                  updateWorkflowRun(runId, 'error', `Evaluator "${step.name}" failed after ${maxRetries} retries`);
                  return;
                }
              }
            } else {
              insertLog(agentId, 'system', 'Evaluator: PASS');
            }
          }

          // --- Router ---
          if (step.stepType === 'router' && status === 'done') {
            const routerOutput = run.stepOutputs[step.name] || '';
            const routes = step.routes || [];
            const chosenRoute = parseRouterOutput(routerOutput, routes);

            insertLog(agentId, 'system', `Router chose: ${chosenRoute || 'none (running all downstream)'}`);

            if (chosenRoute && routes.length > 0) {
              // Skip all route targets except the chosen one
              for (const route of routes) {
                if (route !== chosenRoute) {
                  run.skippedSteps.add(route);
                  insertLog(agentId, 'system', `Router skipping: "${route}"`);
                }
              }
            }
          }
        }

        // Mark completed
        for (const { step } of results) {
          completed.add(step.name);
        }
      }

      run.status = 'done';
      activeRuns.set(runId, run);
      updateWorkflowRun(runId, 'done');
    } catch (err) {
      console.error(`[workflow] Run ${runId} error:`, err);
      run.status = 'error';
      activeRuns.set(runId, run);
      updateWorkflowRun(runId, 'error', err instanceof Error ? err.message : 'Unknown error');
    }
  })();

  return { runId, agents: run.agents };
}
