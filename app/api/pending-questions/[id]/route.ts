import { NextRequest, NextResponse } from 'next/server';
import { getPendingQuestionById, cancelPendingQuestion } from '@/lib/db';
import { resolveQuestion } from '@/lib/pending-questions';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const q = getPendingQuestionById(id);
  if (!q) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ question: q });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action ?? 'resolve';
  if (action === 'cancel') {
    cancelPendingQuestion(id);
    return NextResponse.json({ ok: true });
  }
  const resolution = String(body.choice ?? body.resolution ?? '').trim();
  if (!resolution) {
    return NextResponse.json({ error: 'choice is required' }, { status: 400 });
  }
  try {
    const result = await resolveQuestion(id, resolution);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/pending-questions/[id] error:', err);
    const message = err instanceof Error ? err.message : 'resolve failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
