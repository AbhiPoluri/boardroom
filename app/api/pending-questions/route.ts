import { NextRequest, NextResponse } from 'next/server';
import {
  getOpenPendingQuestions, getOpenPendingQuestionsCount, getActiveProject,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectIdParam = url.searchParams.get('projectId');
    const countOnly = url.searchParams.get('count') === '1';
    const project = projectIdParam ? { id: projectIdParam } : getActiveProject();

    if (countOnly) {
      return NextResponse.json({ count: getOpenPendingQuestionsCount(project?.id) });
    }
    const questions = getOpenPendingQuestions(project?.id);
    return NextResponse.json({ questions });
  } catch (err) {
    console.error('GET /api/pending-questions error:', err);
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 });
  }
}
