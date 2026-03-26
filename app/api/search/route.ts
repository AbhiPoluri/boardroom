import { NextRequest, NextResponse } from 'next/server';
import { searchLogs } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  let q = req.nextUrl.searchParams.get('q');
  const raw = req.nextUrl.searchParams.get('limit') || '100';
  const limit = Math.min(500, parseInt(raw, 10) || 100);

  if (!q || q.length < 2) {
    return NextResponse.json({ error: 'query must be at least 2 characters' }, { status: 400 });
  }

  if (q.length > 200) q = q.slice(0, 200);

  const results = searchLogs(q, limit);
  return NextResponse.json({ results, query: q });
}
