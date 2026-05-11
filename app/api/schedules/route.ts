import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getCronJobs, createCronJob, getActiveProject, getPersonaById } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const jobs = getCronJobs();
    return NextResponse.json({ schedules: jobs });
  } catch (err) {
    console.error('GET /api/schedules error:', err);
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name: string = String(body.name ?? '').trim();
    const schedule: string = String(body.schedule ?? '').trim();
    const task: string = String(body.task ?? '').trim();
    const personaId: string | null = body.persona_id ?? null;

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!schedule) return NextResponse.json({ error: 'schedule (cron expression) is required' }, { status: 400 });
    if (!task) return NextResponse.json({ error: 'task (prompt) is required' }, { status: 400 });
    if (personaId && !getPersonaById(personaId)) {
      return NextResponse.json({ error: 'persona not found' }, { status: 400 });
    }

    const project = getActiveProject();
    const id = uuidv4();
    createCronJob({
      id,
      name,
      schedule,
      task,
      persona_id: personaId,
      project_id: project?.id ?? 'default',
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('POST /api/schedules error:', err);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}
