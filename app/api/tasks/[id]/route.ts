import { NextRequest, NextResponse } from 'next/server';
import {
  getBoardTaskById, updateBoardTask, deleteBoardTask, getPersonaById,
} from '@/lib/db';
import { assignTaskToPersona } from '@/lib/personas';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = getBoardTaskById(id);
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ task });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = getBoardTaskById(id);
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.json();

  // Special action: assign-and-start. body = { action: 'assign', persona_id: '...' }
  if (body.action === 'assign' && body.persona_id) {
    const persona = getPersonaById(body.persona_id);
    if (!persona) return NextResponse.json({ error: 'persona not found' }, { status: 400 });
    try {
      const refreshed = getBoardTaskById(id);
      if (!refreshed) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const result = await assignTaskToPersona(persona.id, refreshed);
      return NextResponse.json({ ok: true, agentId: result.agentId });
    } catch (err) {
      console.error('PATCH /api/tasks/[id] assign error:', err);
      return NextResponse.json({ error: 'assign failed' }, { status: 500 });
    }
  }

  const updates: Record<string, unknown> = {};
  if ('title' in body) updates.title = String(body.title);
  if ('description' in body) updates.description = String(body.description);
  if ('status' in body) updates.status = String(body.status);
  if ('priority' in body) updates.priority = Number(body.priority);
  if ('persona_id' in body) updates.persona_id = body.persona_id ?? null;
  if ('result' in body) updates.result = body.result ?? null;
  if ('required_skills' in body && Array.isArray(body.required_skills)) {
    updates.required_skills_json = JSON.stringify(body.required_skills.map(String));
  }
  updateBoardTask(id, updates);
  return NextResponse.json({ task: getBoardTaskById(id) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deleteBoardTask(id);
  return NextResponse.json({ ok: true });
}
