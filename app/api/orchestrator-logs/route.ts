import { NextRequest, NextResponse } from 'next/server';
import { getOrchestratorLogs, getOrchestratorLogStats } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const stats = req.nextUrl.searchParams.get('stats');
  if (stats) {
    return NextResponse.json(getOrchestratorLogStats());
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '200');
  const since = req.nextUrl.searchParams.get('since');
  const logs = getOrchestratorLogs(limit, since ? parseInt(since) : undefined);
  return NextResponse.json({ logs });
}
