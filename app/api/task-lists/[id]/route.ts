import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  getTaskListById, updateTaskList, deleteTaskList, createBoardTask, getActiveProject,
} from '@/lib/db';
import { runDispatchPass } from '@/lib/dispatcher';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const list = getTaskListById(id);
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ taskList: list });
}

interface ListItem {
  title: string;
  description?: string;
  required_skills?: string[];
  persona_id?: string | null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const list = getTaskListById(id);
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.json();

  // Action: bulk-create tasks on the board from this list.
  if (body.action === 'run') {
    const items: ListItem[] = JSON.parse(list.items_json || '[]');
    const project = getActiveProject();
    let created = 0;
    for (const it of items) {
      const t = String(it.title ?? '').trim();
      if (!t) continue;
      createBoardTask({
        id: uuidv4(),
        title: t,
        description: it.description ?? t,
        project_id: project?.id ?? 'default',
        persona_id: it.persona_id ?? null,
        required_skills: Array.isArray(it.required_skills) ? it.required_skills : null,
      });
      created += 1;
    }
    runDispatchPass().catch(err => console.error('[task-lists run] dispatch:', err));
    return NextResponse.json({ ok: true, created });
  }

  const updates: Record<string, unknown> = {};
  if ('title' in body) updates.title = String(body.title);
  if ('description' in body) updates.description = body.description ?? null;
  if (Array.isArray(body.items)) updates.items_json = JSON.stringify(body.items);
  updateTaskList(id, updates);
  return NextResponse.json({ taskList: getTaskListById(id) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deleteTaskList(id);
  return NextResponse.json({ ok: true });
}
