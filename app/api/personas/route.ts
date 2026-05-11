import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  getPersonas, createPersona, getActiveProject, getPersonaBySlug,
} from '@/lib/db';
import { seedPersonasFromConfigs } from '@/lib/personas';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectIdParam = url.searchParams.get('projectId');
    const project = projectIdParam ? { id: projectIdParam } : getActiveProject();
    if (!project) return NextResponse.json({ personas: [] });

    // Idempotent: ensures the generalist starter pack exists, and (one-time)
    // cleans up the legacy dev-pack personas if they were never activated.
    seedPersonasFromConfigs(project.id);
    const personas = getPersonas(project.id);
    return NextResponse.json({ personas });
  } catch (err) {
    console.error('GET /api/personas error:', err);
    return NextResponse.json({ error: 'Failed to fetch personas' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const project = getActiveProject();
    const projectId = body.project_id ?? project?.id ?? 'default';
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const slug = (body.slug as string | undefined) ?? toSlug(body.name);
    const id = body.id ?? `${projectId}:${slug}`;
    if (getPersonaBySlug(slug, projectId)) {
      return NextResponse.json({ error: 'persona with this slug already exists' }, { status: 409 });
    }
    createPersona({
      id,
      project_id: projectId,
      slug,
      name: body.name,
      role: body.role ?? null,
      avatar: body.avatar ?? null,
      color: body.color ?? null,
      model: body.model ?? null,
      skills: Array.isArray(body.skills) ? body.skills.map(String) : null,
      system_prompt: body.system_prompt ?? null,
      autonomy: body.autonomy === 'auto' ? 'auto' : 'manual',
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('POST /api/personas error:', err);
    return NextResponse.json({ error: 'Failed to create persona' }, { status: 500 });
  }
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `persona-${Date.now()}`;
}
