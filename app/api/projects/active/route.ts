import { NextRequest, NextResponse } from 'next/server';
import { getActiveProject, setActiveProject, getProjectById } from '@/lib/db';

export async function GET() {
  return NextResponse.json({ project: getActiveProject() ?? null });
}

export async function POST(req: NextRequest) {
  let body: { id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }); }
  const id = (body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const project = getProjectById(id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  setActiveProject(id);
  return NextResponse.json({ project });
}
