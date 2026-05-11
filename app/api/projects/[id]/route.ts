import { NextRequest, NextResponse } from 'next/server';
import { getProjectById, updateProject, deleteProject } from '@/lib/db';

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const project = getProjectById(id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const existing = getProjectById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }); }

  const updates: Record<string, string | null> = {};
  for (const k of ['name', 'repo', 'branch', 'working_dir', 'goal'] as const) {
    if (k in body) {
      const v = body[k];
      if (v === null || v === '') updates[k] = null;
      else if (typeof v === 'string') updates[k] = v.trim();
    }
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ project: existing });
  }
  updateProject(id, updates);
  return NextResponse.json({ project: getProjectById(id) });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const existing = getProjectById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  deleteProject(id);
  return NextResponse.json({ ok: true });
}
