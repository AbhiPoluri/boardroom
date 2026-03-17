import { NextResponse } from 'next/server';
import { getAllSummaries } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const summaries = getAllSummaries();
  return NextResponse.json({ summaries: summaries.map((s: any) => {
    let files_changed: unknown[] = [];
    let commits: unknown[] = [];
    try { files_changed = JSON.parse(s.files_changed || '[]'); } catch { files_changed = []; }
    try { commits = JSON.parse(s.commits || '[]'); } catch { commits = []; }
    return { ...s, files_changed, commits };
  })});
}
