import { NextRequest, NextResponse } from 'next/server';
import { getAgentById, getLogsForAgent, updateAgentStatus, deleteAgent, getPtyChunks, getTokenUsageByAgent } from '@/lib/db';
import { killAgent, resumeAgent } from '@/lib/spawner';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = getAgentById(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    const logs = getLogsForAgent(id, 500);
    const hasPty = getPtyChunks(id, 0).length > 0;
    const tokens = getTokenUsageByAgent(id);
    return NextResponse.json({ agent, logs, hasPty, tokens });
  } catch (err) {
    console.error('GET /api/agents/[id] error:', err);
    return NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = getAgentById(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const { task } = await req.json() as { task?: string };
    if (!task?.trim()) {
      return NextResponse.json({ error: 'task is required' }, { status: 400 });
    }

    const { pid } = await resumeAgent(id, task.trim());
    return NextResponse.json({ success: true, pid });
  } catch (err) {
    console.error('PATCH /api/agents/[id] error:', err);
    return NextResponse.json({ error: 'Failed to resume agent' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = getAgentById(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const purge = req.nextUrl.searchParams.get('purge') === '1';

    if (purge) {
      // Kill if running, then delete from DB entirely
      killAgent(id);
      deleteAgent(id);
      return NextResponse.json({ success: true, message: `Agent ${id} deleted` });
    }

    const killed = killAgent(id);
    if (!killed) {
      updateAgentStatus(id, 'killed');
    }
    return NextResponse.json({ success: true, message: `Agent ${id} killed` });
  } catch (err) {
    console.error('DELETE /api/agents/[id] error:', err);
    return NextResponse.json({ error: 'Failed to kill agent' }, { status: 500 });
  }
}
