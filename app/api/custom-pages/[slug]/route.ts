import { NextRequest, NextResponse } from 'next/server';
import { getActiveProject } from '@/lib/db';
import {
  getCustomPageBySlug,
  updateCustomPage,
  deleteCustomPage,
} from '@/lib/custom-pages';

export const dynamic = 'force-dynamic';

function projectIdFromReq(req: NextRequest): string | null {
  const fromQuery = new URL(req.url).searchParams.get('projectId');
  return fromQuery ?? getActiveProject()?.id ?? null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const page = getCustomPageBySlug(slug, projectIdFromReq(req));
    if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ page });
  } catch (err) {
    console.error('GET /api/custom-pages/[slug] error:', err);
    return NextResponse.json({ error: 'Failed to fetch page' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const body = await req.json();
    const projectId = projectIdFromReq(req);
    const updated = updateCustomPage(slug, projectId, {
      title: typeof body.title === 'string' ? body.title : undefined,
      content: typeof body.content === 'string' ? body.content : undefined,
    });
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ page: updated });
  } catch (err) {
    console.error('PATCH /api/custom-pages/[slug] error:', err);
    return NextResponse.json({ error: 'Failed to update page' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const projectId = projectIdFromReq(req);
    const removed = deleteCustomPage(slug, projectId);
    if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/custom-pages/[slug] error:', err);
    return NextResponse.json({ error: 'Failed to delete page' }, { status: 500 });
  }
}
