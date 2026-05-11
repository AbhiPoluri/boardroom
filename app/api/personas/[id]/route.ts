import { NextRequest, NextResponse } from 'next/server';
import { getPersonaById, updatePersona, deletePersona } from '@/lib/db';
import { sleepPersona } from '@/lib/personas';
import { runDispatchPass } from '@/lib/dispatcher';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const persona = getPersonaById(id);
  if (!persona) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ persona });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const persona = getPersonaById(id);
  if (!persona) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if ('name' in body) updates.name = String(body.name);
  if ('role' in body) updates.role = body.role ?? null;
  if ('avatar' in body) updates.avatar = body.avatar ?? null;
  if ('color' in body) updates.color = body.color ?? null;
  if ('model' in body) updates.model = body.model ?? null;
  if ('agent_type' in body) {
    const VALID_TYPES = new Set(['claude', 'hermes', 'codex', 'opencode']);
    const t = String(body.agent_type ?? 'claude');
    updates.agent_type = VALID_TYPES.has(t) ? t : 'claude';
  }
  if ('system_prompt' in body) updates.system_prompt = body.system_prompt ?? null;
  if ('autonomy' in body) updates.autonomy = body.autonomy === 'auto' ? 'auto' : 'manual';
  if ('skills' in body && Array.isArray(body.skills)) {
    updates.skills_json = JSON.stringify(body.skills.map(String));
  }
  updatePersona(id, updates);
  // If autonomy was just flipped to auto, kick a dispatch pass so any open
  // skill-matching task picks up immediately.
  if (updates.autonomy === 'auto') {
    runDispatchPass().catch(err => console.error('[personas PATCH] dispatch:', err));
  }
  return NextResponse.json({ persona: getPersonaById(id) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const persona = getPersonaById(id);
  if (!persona) return NextResponse.json({ error: 'not found' }, { status: 404 });
  sleepPersona(id);
  deletePersona(id);
  return NextResponse.json({ ok: true });
}
