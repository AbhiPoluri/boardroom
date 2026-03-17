import { getCronJobs, getCronJob, recordCronRun, createAgent } from './db';
import { spawnAgent } from './spawner';
import { v4 as uuidv4 } from 'uuid';
import { CronExpressionParser } from 'cron-parser';
import type { AgentType } from '@/types';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let started = false;

function shouldRun(schedule: string, lastRun: number | null): boolean {
  try {
    const expr = CronExpressionParser.parse(schedule);
    const prev = expr.prev().getTime();
    // If the most recent scheduled time is after the last run, it's due
    if (!lastRun) return true;
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
    const jobs = getCronJobs();
    for (const job of jobs) {
      if (!job.enabled) continue;
      if (job.last_status === 'running') continue; // skip if still running
      if (shouldRun(job.schedule, job.last_run)) {
        executeCronJob(job);
      }
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
