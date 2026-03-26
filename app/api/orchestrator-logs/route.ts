import { NextRequest, NextResponse } from 'next/server';
import { getOrchestratorLogs, getOrchestratorLogStats } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const stats = req.nextUrl.searchParams.get('stats');
  if (stats) {
    return NextResponse.json(getOrchestratorLogStats());
  }

  const rawLimit = req.nextUrl.searchParams.get('limit') || '200';
  const limit = Math.max(1, Math.min(1000, parseInt(rawLimit, 10) || 200));
  const since = req.nextUrl.searchParams.get('since');
  const rawSince = since ? parseInt(since, 10) : NaN;
  const logs = getOrchestratorLogs(limit, !isNaN(rawSince) ? rawSince : undefined);
  return NextResponse.json({ logs });
}
