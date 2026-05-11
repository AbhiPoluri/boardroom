import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllProjects,
  createProject,
  getProjectById,
  setActiveProject,
  getDefaultPackSlugs,
  createPersona,
  getPersonaBySlug,
} from '@/lib/db';
import { getPackBySlug } from '@/lib/persona-packs';

export async function GET() {
  return NextResponse.json({ projects: getAllProjects() });
}

export async function POST(req: NextRequest) {
  let body: {
    name?: string;
    repo?: string | null;
    branch?: string | null;
    working_dir?: string | null;
    goal?: string | null;
    activate?: boolean;
    skip_default_packs?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const name = (body.name || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const id = uuidv4();
  createProject({
    id,
    name,
    repo: body.repo?.trim() || null,
    branch: body.branch?.trim() || null,
    working_dir: body.working_dir?.trim() || null,
    goal: body.goal?.trim() || null,
  });

  // Auto-install any persona packs the user has pinned as defaults so a fresh
  // project comes with their starter team, not an empty roster. Pass
  // `skip_default_packs: true` to opt out (e.g. a scripted bare project).
  const installedPacks: Record<string, number> = {};
  if (!body.skip_default_packs) {
    for (const slug of getDefaultPackSlugs()) {
      const pack = getPackBySlug(slug);
      if (!pack) continue;
      let installed = 0;
      for (const p of pack.personas) {
        if (getPersonaBySlug(p.slug, id)) continue;
        try {
          createPersona({
            id: `${id}:${p.slug}`,
            project_id: id,
            slug: p.slug,
            name: p.name,
            role: p.role,
            color: p.color,
            model: p.model,
            skills: p.skills,
            system_prompt: p.system_prompt,
            autonomy: 'manual',
          });
          installed += 1;
        } catch (err) {
          console.error(`[projects] auto-install ${p.slug} failed:`, err);
        }
      }
      if (installed > 0) installedPacks[slug] = installed;
    }
  }

  if (body.activate !== false) {
    setActiveProject(id);
  }
  return NextResponse.json({
    project: getProjectById(id),
    auto_installed_packs: installedPacks,
  }, { status: 201 });
}
