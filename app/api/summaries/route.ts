import { NextResponse } from 'next/server';
import { getAllSummaries } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const summaries = getAllSummaries();
  return NextResponse.json({ summaries: summaries.map((s: any) => ({
    ...s,
    files_changed: JSON.parse(s.files_changed || '[]'),
    commits: JSON.parse(s.commits || '[]'),
  }))});
}
