import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getTaskLists, createTaskList, getActiveProject } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectIdParam = url.searchParams.get('projectId');
    const project = projectIdParam ? { id: projectIdParam } : getActiveProject();
    const taskLists = getTaskLists(project?.id);
    return NextResponse.json({ taskLists });
  } catch (err) {
    console.error('GET /api/task-lists error:', err);
    return NextResponse.json({ error: 'Failed to fetch task lists' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title: string = String(body.title ?? '').trim();
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

    const project = getActiveProject();
    const id = uuidv4();
    createTaskList({
      id,
      title,
      description: body.description ?? null,
      project_id: project?.id ?? 'default',
      items: Array.isArray(body.items) ? body.items : [],
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('POST /api/task-lists error:', err);
    return NextResponse.json({ error: 'Failed to create task list' }, { status: 500 });
  }
}
