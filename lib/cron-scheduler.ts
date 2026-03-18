import { getCronJobs, getCronJob, recordCronRun, createAgent, getScheduledWorkflows, getWorkflowRuns } from './db';
import { spawnAgent } from './spawner';
import { runWorkflow } from './workflow-runner';
import { v4 as uuidv4 } from 'uuid';
import { CronExpressionParser } from 'cron-parser';
import type { AgentType } from '@/types';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let started = false;

function shouldRun(schedule: string, lastRun: number | null): boolean {
  try {
    const expr = CronExpressionParser.parse(schedule);
    const prev = expr.prev().getTime();
    // On first run, only fire if the job is actually due based on its schedule
    // (not unconditionally — prevents immediate execution on creation)
    if (!lastRun) {
      // Only run if the previous scheduled time is within the last 2 minutes
      // (i.e., a cron tick just passed)
      return Date.now() - prev < 2 * 60 * 1000;
    }
    return prev > lastRun;
  } catch {
    return false;
  }
}

async function executeCronJob(job: {
  id: string;
  name: string;
  task: string;
  agent_type: string;
  model: string;
  repo: string | null;
}) {
  const agentId = uuidv4();
  const agentName = `cron-${job.name}`;
  const now = Date.now();

  try {
    createAgent({
      id: agentId,
      name: agentName,
      type: (job.agent_type || 'claude') as AgentType,
      status: 'spawning',
      task: job.task,
      repo: job.repo || null,
      worktree_path: null,
      pid: null,
      port: null,
      created_at: now,
    });

    recordCronRun(job.id, agentId, 'running');

    await spawnAgent({
      agentId,
      name: agentName,
      type: (job.agent_type || 'claude') as AgentType,
      task: job.task,
      repo: job.repo || undefined,
      model: job.model || 'sonnet',
    });

    console.log(`[cron] Started job "${job.name}" → agent ${agentId.slice(0, 8)}`);
  } catch (err) {
    console.error(`[cron] Failed to run job "${job.name}":`, err);
    recordCronRun(job.id, agentId, 'error');
  }
}

function tick() {
  try {
    // Process cron jobs
    const jobs = getCronJobs();
    for (const job of jobs) {
      if (!job.enabled) continue;
      if (job.last_status === 'running') continue; // skip if still running
      if (shouldRun(job.schedule, job.last_run)) {
        executeCronJob(job);
      }
    }

    // Process scheduled workflows
    try {
      const scheduledWorkflows = getScheduledWorkflows();
      for (const wf of scheduledWorkflows) {
        if (!wf.schedule) continue;

        // Check if due — find most recent run for this workflow
        const runs = getWorkflowRuns(wf.id);
        const latestRun = runs[0]; // already sorted by started_at DESC

        // Skip if latest run is still running
        if (latestRun && latestRun.status === 'running') continue;

        const lastRunTime = latestRun ? latestRun.started_at : null;
        if (shouldRun(wf.schedule, lastRunTime)) {
          let steps: any[] = [];
          try { steps = JSON.parse(wf.steps_json); } catch { continue; }
          if (steps.length === 0) continue;

          console.log(`[cron] Triggering scheduled workflow "${wf.name}"`);
          runWorkflow(wf.name, steps).catch((err) => {
            console.error(`[cron] Failed to run scheduled workflow "${wf.name}":`, err);
          });
        }
      }
    } catch (err) {
      console.error('[cron] Scheduled workflow tick error:', err);
    }
  } catch (err) {
    console.error('[cron] Scheduler tick error:', err);
  }
}

export function startCronScheduler() {
  if (started) return;
  started = true;

  console.log('[cron] Scheduler started — checking every 30s');

  // Check immediately on start
  tick();

  // Then check every 30 seconds
  schedulerInterval = setInterval(tick, 30_000);
}

export function stopCronScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  started = false;
}
