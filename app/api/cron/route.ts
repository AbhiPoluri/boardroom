import { NextRequest, NextResponse } from 'next/server';
import { getCronJobs, getCronJob, createCronJob, updateCronJob, deleteCronJob, recordCronRun, createAgent } from '@/lib/db';
import { spawnAgent } from '@/lib/spawner';
import { v4 as uuidv4 } from 'uuid';
import type { AgentType } from '@/types';
import { CronExpressionParser } from 'cron-parser';

export const dynamic = 'force-dynamic';

export async function GET() {
  const jobs = getCronJobs();
  const jobsWithNextRun = jobs.map((job) => {
    if (!job.enabled) return job;
    try {
      const interval = CronExpressionParser.parse(job.schedule);
      const next_run = interval.next().toDate().getTime();
      return { ...job, next_run };
    } catch {
      return job;
    }
  });
  return NextResponse.json({ jobs: jobsWithNextRun });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === 'toggle') {
    const job = getCronJob(body.id);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    updateCronJob(body.id, { enabled: job.enabled ? 0 : 1 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'run') {
    const job = getCronJob(body.id);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    // Actually spawn an agent to run this cron job
    const agentId = uuidv4();
    const agentName = `cron-${job.name}`;
    const now = Date.now();

    createAgent({
      id: agentId,
      name: agentName,
      type: job.agent_type || 'claude',
      status: 'spawning',
      task: job.task,
      repo: job.repo || null,
      worktree_path: null,
      pid: null,
      port: null,
      created_at: now,
    });

    // Update cron job status
    recordCronRun(job.id, agentId, 'running');

    // Spawn the agent async
    spawnAgent({
      agentId,
      name: agentName,
      type: (['claude', 'codex', 'opencode', 'custom', 'test'].includes(job.agent_type) ? job.agent_type : 'claude') as AgentType,
      task: job.task,
      repo: job.repo || undefined,
      model: job.model || 'sonnet',
    }).catch((err) => {
      console.error(`Failed to run cron job ${job.id}:`, err);
      recordCronRun(job.id, agentId, 'error');
    });

    return NextResponse.json({ ok: true, agentId });
  }

  if (body.action === 'delete') {
    deleteCronJob(body.id);
    return NextResponse.json({ ok: true });
  }

  // Create new cron job
  const { name, schedule, task, agent_type, model, repo } = body;
  if (!name || !schedule || !task) {
    return NextResponse.json({ error: 'name, schedule, and task required' }, { status: 400 });
  }

  try {
    CronExpressionParser.parse(schedule);
  } catch {
    return NextResponse.json({ error: `Invalid cron schedule: "${schedule}"` }, { status: 400 });
  }

  const id = uuidv4().slice(0, 8);
  createCronJob({ id, name, schedule, task, agent_type, model, repo });
  const job = getCronJob(id);
  return NextResponse.json({ job }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  let body: { id?: string; [key: string]: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Validate schedule if it's being updated
  if (updates.schedule !== undefined) {
    try {
      CronExpressionParser.parse(updates.schedule as string);
    } catch {
      return NextResponse.json({ error: `Invalid cron schedule: "${updates.schedule}"` }, { status: 400 });
    }
  }

  updateCronJob(id, updates);
  const job = getCronJob(id);
  return NextResponse.json({ job });
}

export async function DELETE(req: NextRequest) {
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  deleteCronJob(body.id);
  return NextResponse.json({ ok: true });
}
