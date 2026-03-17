import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getAllWorkflows, saveWorkflow, getWorkflow, deleteWorkflow } from '@/lib/db';
import { runWorkflow, getWorkflowRun, getAllWorkflowRuns } from '@/lib/workflow-runner';

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
  return NextResponse.json({ workflows: workflows.map((w: any) => ({ ...w, steps: JSON.parse(w.steps_json) })) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // POST with action=run — execute a workflow
  if (body.action === 'run') {
    const { name, steps, repo } = body;
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'steps[] required to run' }, { status: 400 });
    }
    const result = await runWorkflow(name || 'unnamed', steps, repo);
    return NextResponse.json({ ok: true, ...result });
  }

  // Default: create workflow
  const { name, description, steps } = body;
  if (!name || !steps || !Array.isArray(steps)) {
    return NextResponse.json({ error: 'name and steps[] required' }, { status: 400 });
  }
  const id = uuidv4();
  saveWorkflow(id, name, description || '', steps);
  return NextResponse.json({ workflow: { id, name, description, steps } }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { id, name, description, steps } = await req.json();
  if (!id || !name || !steps) {
    return NextResponse.json({ error: 'id, name, and steps required' }, { status: 400 });
  }
  saveWorkflow(id, name, description || '', steps);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  deleteWorkflow(id);
  return NextResponse.json({ ok: true });
}
