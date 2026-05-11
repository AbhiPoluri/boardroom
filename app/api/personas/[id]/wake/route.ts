import { NextRequest, NextResponse } from 'next/server';
import { getPersonaById } from '@/lib/db';
import { wakePersona, sleepPersona } from '@/lib/personas';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const persona = getPersonaById(id);
  if (!persona) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const task = String(body.task ?? '').trim();
  if (!task) return NextResponse.json({ error: 'task is required' }, { status: 400 });
  try {
    const result = await wakePersona({
      persona,
      task,
      repo: body.repo,
      model: body.model,
    });
    return NextResponse.json({ agentId: result.agentId });
  } catch (err) {
    console.error('POST /api/personas/[id]/wake error:', err);
    return NextResponse.json({ error: 'wake failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  sleepPersona(id);
  return NextResponse.json({ ok: true });
}
