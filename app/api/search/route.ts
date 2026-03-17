import { NextRequest, NextResponse } from 'next/server';
import { searchLogs } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100');

  if (!q || q.length < 2) {
    return NextResponse.json({ error: 'query must be at least 2 characters' }, { status: 400 });
  }

  const results = searchLogs(q, limit);
  return NextResponse.json({ results, query: q });
}
