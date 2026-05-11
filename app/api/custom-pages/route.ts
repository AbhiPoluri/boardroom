import { NextRequest, NextResponse } from 'next/server';
import { getActiveProject } from '@/lib/db';
import {
  listCustomPages,
  createCustomPage,
  getCustomPageBySlug,
  isValidSlug,
} from '@/lib/custom-pages';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectIdParam = url.searchParams.get('projectId');
    const projectId = projectIdParam ?? getActiveProject()?.id ?? null;
    const pages = listCustomPages(projectId);
    return NextResponse.json({ pages });
  } catch (err) {
    console.error('GET /api/custom-pages error:', err);
    return NextResponse.json({ error: 'Failed to fetch pages' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.slug || typeof body.slug !== 'string') {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }
    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    if (!isValidSlug(body.slug)) {
      return NextResponse.json({
        error: 'slug must be lowercase letters/digits/hyphens, start with a letter/digit, max 80 chars',
      }, { status: 400 });
    }
    const projectId = body.project_id ?? getActiveProject()?.id ?? null;
    if (getCustomPageBySlug(body.slug, projectId)) {
      return NextResponse.json({ error: 'A page with this slug already exists in this project' }, { status: 409 });
    }
    const page = createCustomPage({
      slug: body.slug,
      title: body.title,
      content: typeof body.content === 'string' ? body.content : '',
      project_id: projectId,
      author_persona_id: body.author_persona_id ?? null,
    });
    return NextResponse.json({ page }, { status: 201 });
  } catch (err) {
    console.error('POST /api/custom-pages error:', err);
    return NextResponse.json({ error: 'Failed to create page' }, { status: 500 });
  }
}
