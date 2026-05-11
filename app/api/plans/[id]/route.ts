import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  getPlanById, getPlanWithSubtasks, updatePlan, deletePlan, deleteBoardTask,
  getSubtasksForPlan, createBoardTask, updateBoardTask,
} from '@/lib/db';
import { startPlan, cancelPlan } from '@/lib/plans';
import { runDispatchPass } from '@/lib/dispatcher';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const plan = getPlanWithSubtasks(id);
  if (!plan) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ plan });
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const plan = getPlanById(id);
  if (!plan) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.json();

  if (body.action === 'start') {
    try {
      const result = startPlan(id);
      // Sweep auto-personas onto the freshly-opened subtasks.
      runDispatchPass().catch(err => console.error('[plans start] dispatch:', err));
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'start failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (body.action === 'cancel') {
    cancelPlan(id);
    return NextResponse.json({ ok: true });
  }

  const updates: Record<string, unknown> = {};
  if ('title' in body) updates.title = String(body.title);
  if ('description' in body) updates.description = body.description ?? null;
  if ('execution_mode' in body) updates.execution_mode = body.execution_mode === 'sequential' ? 'sequential' : 'parallel';
  if (Object.keys(updates).length) updatePlan(id, updates);

  // Subtask sync: if `subtasks` is provided, replace the plan's subtask list.
  // Drafts can rebuild freely; active plans can only reposition + relink deps.
  if (Array.isArray(body.subtasks)) {
    const incoming: SubtaskInput[] = body.subtasks;
    const existing = getSubtasksForPlan(id);
    const incomingIds = new Set(incoming.map(s => s.id).filter(Boolean) as string[]);

    // Two-pass id resolution so the canvas can reference siblings by id.
    const idMap = new Map<string, string>();
    const upsertPlan: Array<{ s: SubtaskInput; serverId: string; isNew: boolean; order: number }> = [];
    let order = 0;
    for (const s of incoming) {
      const sTitle = String(s.title ?? '').trim();
      if (!sTitle) continue;
      const isExisting = s.id && existing.find(t => t.id === s.id);
      const serverId = isExisting ? (s.id as string) : uuidv4();
      if (s.id) idMap.set(s.id, serverId);
      idMap.set(String(order), serverId);
      upsertPlan.push({ s, serverId, isNew: !isExisting, order });
      order += 1;
    }

    // Delete subtasks that were removed in the new list (drafts only).
    if (plan.status === 'draft') {
      for (const t of existing) {
        if (!incomingIds.has(t.id)) deleteBoardTask(t.id);
      }
    }

    for (const { s, serverId, isNew, order: ord } of upsertPlan) {
      const deps = Array.isArray(s.depends_on)
        ? s.depends_on.map(d => idMap.get(d)).filter((d): d is string => Boolean(d))
        : [];
      const sTitle = String(s.title ?? '').trim();
      if (isNew && plan.status === 'draft') {
        createBoardTask({
          id: serverId,
          title: sTitle,
          description: s.description ?? sTitle,
          project_id: plan.project_id,
          persona_id: s.persona_id ?? null,
          required_skills: Array.isArray(s.required_skills) ? s.required_skills : null,
          plan_id: id,
          step_order: ord,
          status: 'staged',
        });
      }
      const patch: Record<string, unknown> = {
        title: sTitle,
        description: s.description ?? sTitle,
        required_skills_json: Array.isArray(s.required_skills) ? JSON.stringify(s.required_skills) : null,
        persona_id: s.persona_id ?? null,
        step_order: ord,
        depends_on_json: deps.length ? JSON.stringify(deps) : null,
      };
      if (typeof s.canvas_x === 'number') patch.canvas_x = s.canvas_x;
      if (typeof s.canvas_y === 'number') patch.canvas_y = s.canvas_y;
      updateBoardTask(serverId, patch);
    }
  }

  return NextResponse.json({ plan: getPlanWithSubtasks(id) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deletePlan(id);
  return NextResponse.json({ ok: true });
}
