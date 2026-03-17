import { NextResponse } from 'next/server';
import { getRecentWorkflowRuns } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const runs = getRecentWorkflowRuns(20);
  return NextResponse.json({
    runs: runs.map((r: any) => ({
      ...r,
      agent_ids: r.agent_ids_json ? (() => { try { return JSON.parse(r.agent_ids_json); } catch { return []; } })() : [],
    })),
  });
}
