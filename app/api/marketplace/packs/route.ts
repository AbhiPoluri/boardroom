import { NextResponse } from 'next/server';
import { PERSONA_PACKS } from '@/lib/persona-packs';
import { getPersonas, getActiveProject, getDefaultPackSlugs } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const project = getActiveProject();
    const installed = project ? new Set(getPersonas(project.id).map(p => p.slug)) : new Set<string>();
    const defaults = new Set(getDefaultPackSlugs());
    const packs = PERSONA_PACKS.map(pack => ({
      slug: pack.slug,
      name: pack.name,
      tagline: pack.tagline,
      description: pack.description,
      accent: pack.accent,
      personas: pack.personas.map(p => ({
        slug: p.slug,
        name: p.name,
        role: p.role,
        color: p.color,
        skills: p.skills,
        installed: installed.has(p.slug),
      })),
      installedCount: pack.personas.filter(p => installed.has(p.slug)).length,
      total: pack.personas.length,
      is_default: defaults.has(pack.slug),
    }));
    return NextResponse.json({ packs });
  } catch (err) {
    console.error('GET /api/marketplace/packs error:', err);
    return NextResponse.json({ error: 'Failed to fetch packs' }, { status: 500 });
  }
}
