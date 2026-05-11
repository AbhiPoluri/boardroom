import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  getPlansWithSubtasks, getActiveProject, createPlan, createBoardTask,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectIdParam = url.searchParams.get('projectId');
    const project = projectIdParam ? { id: projectIdParam } : getActiveProject();
    const plans = getPlansWithSubtasks(project?.id);
    return NextResponse.json({ plans });
  } catch (err) {
    console.error('GET /api/plans error:', err);
    return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 });
  }
}

interface SubtaskInput {
  id?: string;
  title: string;
  description?: string;
  required_skills?: string[];
  persona_id?: string | null;
  depends_on?: string[];
  canvas_x?: number | null;
  canvas_y?: number | null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title: string = String(body.title ?? '').trim();
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

    const project = getActiveProject();
    const projectId: string = body.project_id ?? project?.id ?? 'default';
    const id = uuidv4();
    const executionMode = body.execution_mode === 'sequential' ? 'sequential' : 'parallel';

    createPlan({
      id,
      title,
      description: body.description ?? null,
      project_id: projectId,
      execution_mode: executionMode,
      auto_merge: !!body.auto_merge,
    });

    // Validate every referenced persona_id exists. Without this, an upstream
    // typo or shell-modifier-eaten id (zsh `:t`/`:r`/`:e` mangle persona slugs
    // like `:theo` → `:t` + `heo`) silently stages an unrunnable subtask that
    // strands the plan mid-flight. We'd rather 400 at creation time.
    const subtasks: SubtaskInput[] = Array.isArray(body.subtasks) ? body.subtasks : [];
    const { getPersonaById } = await import('@/lib/db');
    const missingIds: string[] = [];
    for (const s of subtasks) {
      if (s.persona_id && !getPersonaById(s.persona_id)) missingIds.push(s.persona_id);
    }
    if (missingIds.length > 0) {
      return NextResponse.json({
        error: `unknown persona_id(s): ${missingIds.join(', ')} — did a shell modifier mangle them? expected format <project_id>:<slug>`,
      }, { status: 400 });
    }

    // Create subtasks in 'staged' state so they don't appear on the board until plan starts.
    // Two-pass: assign new ids first, then resolve depends_on by index OR by id from client.
    const idMap = new Map<string, string>(); // client-id (or index) → server-id
    const created: Array<{ s: SubtaskInput; serverId: string; order: number }> = [];
    let stepOrder = 0;
    for (const s of subtasks) {
      const sTitle = String(s.title ?? '').trim();
      if (!sTitle) continue;
      const serverId = uuidv4();
      if (s.id) idMap.set(s.id, serverId);
      idMap.set(String(stepOrder), serverId);
      created.push({ s, serverId, order: stepOrder });
      stepOrder += 1;
    }
    for (const { s, serverId, order } of created) {
      const deps = Array.isArray(s.depends_on)
        ? s.depends_on.map(d => idMap.get(d)).filter((d): d is string => Boolean(d))
        : [];
      const t = {
        id: serverId,
        title: String(s.title ?? '').trim(),
        description: s.description ?? String(s.title ?? '').trim(),
        project_id: projectId,
        persona_id: s.persona_id ?? null,
        required_skills: Array.isArray(s.required_skills) ? s.required_skills : null,
        priority: 0,
        plan_id: id,
        step_order: order,
        status: 'staged',
      };
      createBoardTask(t);
      // Persist canvas + deps via update (createBoardTask doesn't take them).
      const { updateBoardTask } = await import('@/lib/db');
      const patch: Record<string, unknown> = {};
      if (deps.length) patch.depends_on_json = JSON.stringify(deps);
      if (typeof s.canvas_x === 'number') patch.canvas_x = s.canvas_x;
      if (typeof s.canvas_y === 'number') patch.canvas_y = s.canvas_y;
      if (Object.keys(patch).length) updateBoardTask(serverId, patch);
    }

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('POST /api/plans error:', err);
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 });
  }
}
