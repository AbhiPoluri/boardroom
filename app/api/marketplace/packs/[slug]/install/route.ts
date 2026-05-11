import { NextRequest, NextResponse } from 'next/server';
import { getPackBySlug } from '@/lib/persona-packs';
import {
  getActiveProject, createPersona, getPersonaBySlug,
  addDefaultPackSlug, removeDefaultPackSlug,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const pack = getPackBySlug(slug);
  if (!pack) return NextResponse.json({ error: 'pack not found' }, { status: 404 });

  // Optional body: { pin_default?: boolean }. Defaults to true on first install
  // so the next project the user creates inherits this pack without thinking.
  let body: { pin_default?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const project = getActiveProject();
  const projectId = project?.id ?? 'default';

  let installed = 0;
  let skipped = 0;
  for (const p of pack.personas) {
    if (getPersonaBySlug(p.slug, projectId)) {
      skipped += 1;
      continue;
    }
    try {
      createPersona({
        id: `${projectId}:${p.slug}`,
        project_id: projectId,
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
      console.error(`[packs] install ${p.slug} failed:`, err);
    }
  }

  // Pin as a default for new projects unless the caller opted out.
  if (body.pin_default !== false) {
    addDefaultPackSlug(slug);
  }

  return NextResponse.json({
    ok: true, installed, skipped, total: pack.personas.length, pinned_as_default: body.pin_default !== false,
  });
}

/** Toggle a pack off the default list (un-pin) without uninstalling personas. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const pack = getPackBySlug(slug);
  if (!pack) return NextResponse.json({ error: 'pack not found' }, { status: 404 });
  removeDefaultPackSlug(slug);
  return NextResponse.json({ ok: true, unpinned: slug });
}
