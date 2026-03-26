import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getAllWorkflows, saveWorkflow, getWorkflow, deleteWorkflow } from '@/lib/db';
import { runWorkflow, getWorkflowRun, getAllWorkflowRuns, cancelWorkflow } from '@/lib/workflow-runner';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // GET /api/workflows?runId=xxx — get run status
  const runId = searchParams.get('runId');
  if (runId) {
    const run = getWorkflowRun(runId);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    return NextResponse.json({ run });
  }

  // GET /api/workflows?runs=1 — list all runs
  if (searchParams.get('runs')) {
    return NextResponse.json({ runs: getAllWorkflowRuns() });
  }

  const workflows = getAllWorkflows();
  return NextResponse.json({ workflows: workflows.map((w: any) => {
    let steps: unknown[] = [];
    try { steps = JSON.parse(w.steps_json); } catch { steps = []; }
    let layout = null;
    try { if (w.layout_json) layout = JSON.parse(w.layout_json); } catch { layout = null; }
    return { ...w, steps, layout, schedule: w.schedule || null, cron_enabled: w.cron_enabled || 0 };
  }) });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // POST with action=run — execute a workflow
  if (body.action === 'run') {
    const { name, steps, repo } = body;
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'steps[] required to run' }, { status: 400 });
    }
    try {
      const result = await runWorkflow(String(name || 'unnamed'), steps, repo as string | undefined);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to run';
      const status = msg.includes('concurrent') || msg.includes('already running') ? 429 : 500;
      return NextResponse.json({ error: msg }, { status });
    }
  }

  // POST with action=cancel — stop a running workflow
  if (body.action === 'cancel') {
    const { runId } = body;
    if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });
    const ok = cancelWorkflow(String(runId));
    return NextResponse.json({ ok, cancelled: ok });
  }

  // Default: create workflow
  const { name, description, steps, schedule, cron_enabled, layout } = body;
  if (!name || !steps || !Array.isArray(steps)) {
    return NextResponse.json({ error: 'name and steps[] required' }, { status: 400 });
  }
  const id = uuidv4();
  saveWorkflow(id, String(name), String(description || ''), steps as unknown[], {
    schedule: (schedule as string) || null,
    cronEnabled: cron_enabled ? 1 : 0,
    layout: layout || null,
  });
  return NextResponse.json({ workflow: { id, name, description, steps, schedule, cron_enabled } }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  let parsed: Record<string, unknown>;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { id, name, description, steps, schedule, cron_enabled, layout } = parsed as {
    id?: string; name?: string; description?: string; steps?: unknown[];
    schedule?: string; cron_enabled?: number; layout?: unknown;
  };
  if (!id || !name || !steps) {
    return NextResponse.json({ error: 'id, name, and steps required' }, { status: 400 });
  }
  saveWorkflow(id, name, description || '', steps as unknown[], {
    schedule: schedule || null,
    cronEnabled: cron_enabled ? 1 : 0,
    layout: layout || null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    deleteWorkflow(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'id required in request body' }, { status: 400 });
  }
}
