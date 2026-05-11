import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  getBoardTasks, createBoardTask, getActiveProject, getPersonaById,
} from '@/lib/db';
import { runDispatchPass } from '@/lib/dispatcher';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectIdParam = url.searchParams.get('projectId');
    const status = url.searchParams.get('status') ?? undefined;
    const project = projectIdParam ? { id: projectIdParam } : getActiveProject();
    const tasks = getBoardTasks(project?.id, status);
    return NextResponse.json({ tasks });
  } catch (err) {
    console.error('GET /api/tasks error:', err);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title: string = String(body.title ?? '').trim();
    const description: string = String(body.description ?? title).trim();
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

    const project = getActiveProject();
    const projectId: string = body.project_id ?? project?.id ?? 'default';

    let personaId: string | null = body.persona_id ?? null;
    if (personaId) {
      const persona = getPersonaById(personaId);
      if (!persona) return NextResponse.json({ error: 'persona not found' }, { status: 400 });
    }

    const id = uuidv4();
    createBoardTask({
      id,
      title,
      description,
      project_id: projectId,
      persona_id: personaId,
      required_skills: Array.isArray(body.required_skills) ? body.required_skills.map(String) : null,
      priority: typeof body.priority === 'number' ? body.priority : 0,
      deadline: typeof body.deadline === 'number' ? body.deadline : null,
    });
    // Trigger dispatch immediately so an idle auto-persona picks this up
    // without waiting for the next periodic tick.
    runDispatchPass().catch(err => console.error('[tasks POST] dispatch:', err));
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('POST /api/tasks error:', err);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
