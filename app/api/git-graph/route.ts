import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get('repo');
  if (!repo) return NextResponse.json({ error: 'Missing repo param' }, { status: 400 });

  try {
    const graph = execSync(
      'git log --all --oneline --graph --decorate -30',
      { cwd: repo, encoding: 'utf8', timeout: 5000 }
    );
    return NextResponse.json({ graph });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `git log failed: ${msg}` }, { status: 500 });
  }
}
