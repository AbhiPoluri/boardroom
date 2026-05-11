import { NextRequest, NextResponse } from 'next/server';
import { getPersonaById, updatePersona } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Clear a persona's persistent claude conversation. The next task they pick
 * up will start a fresh session — useful when memory has gone stale (e.g.
 * cross-project context bleeding in, or the persona has anchored on an
 * outdated assumption from many tasks ago).
 *
 * Also unsticks a persona whose status is 'error' — typical after a failed
 * --resume against a missing session file. With a fresh session id, the next
 * task will simply mint a new conversation and proceed.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const persona = getPersonaById(id);
  if (!persona) return NextResponse.json({ error: 'persona not found' }, { status: 404 });
  const previousId = persona.claude_session_id;
  const wasErrored = persona.status === 'error';
  const updates: Record<string, unknown> = { claude_session_id: null };
  if (wasErrored) {
    updates.status = 'idle';
    updates.current_agent_id = null;
    updates.current_task_id = null;
  }
  updatePersona(id, updates);
  return NextResponse.json({
    ok: true,
    previous_session_id: previousId,
    cleared_error: wasErrored,
  });
}
