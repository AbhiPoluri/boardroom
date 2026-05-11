import { NextRequest, NextResponse } from 'next/server';
import { getCronJob, updateCronJob, deleteCronJob } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getCronJob(id);
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ schedule: job });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getCronJob(id);
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if ('name' in body) updates.name = String(body.name);
  if ('schedule' in body) updates.schedule = String(body.schedule);
  if ('task' in body) updates.task = String(body.task);
  if ('persona_id' in body) updates.persona_id = body.persona_id ?? null;
  if ('enabled' in body) updates.enabled = body.enabled ? 1 : 0;
  updateCronJob(id, updates);
  return NextResponse.json({ schedule: getCronJob(id) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deleteCronJob(id);
  return NextResponse.json({ ok: true });
}
