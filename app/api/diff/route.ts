import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import fs from 'fs';

const SAFE_REF = /^[\w\-\/\.]+$/;

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get('repo');
  const branch = req.nextUrl.searchParams.get('branch');
  const base = req.nextUrl.searchParams.get('base') || 'main';

  if (!repo) return NextResponse.json({ error: 'repo parameter required' }, { status: 400 });
  if (!fs.existsSync(repo)) return NextResponse.json({ error: 'repo not found' }, { status: 404 });
  if (branch && !SAFE_REF.test(branch)) return NextResponse.json({ error: 'invalid branch name' }, { status: 400 });
  if (!SAFE_REF.test(base)) return NextResponse.json({ error: 'invalid base name' }, { status: 400 });

  try {
    // If branch specified, diff against base
    if (branch) {
      const diff = execFileSync('git', ['-C', repo, 'diff', `${base}...${branch}`, '--stat', '--no-color'],
        { encoding: 'utf-8', stdio: 'pipe' }
      ).trim();

      const fullDiff = execFileSync('git', ['-C', repo, 'diff', `${base}...${branch}`, '--no-color'],
        { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 5 * 1024 * 1024 }
      ).trim();

      const commits = execFileSync('git', ['-C', repo, 'log', `${base}..${branch}`, '--oneline', '--no-color', '-20'],
        { encoding: 'utf-8', stdio: 'pipe' }
      ).trim();

      // How many commits the branch is behind base
      let behindBy = 0;
      try {
        const behindLines = execFileSync('git', ['-C', repo, 'log', `${branch}..${base}`, '--oneline', '--no-color'],
          { encoding: 'utf-8', stdio: 'pipe' }
        ).trim();
        behindBy = behindLines ? behindLines.split('\n').filter(Boolean).length : 0;
      } catch {}

      return NextResponse.json({ diff: fullDiff, stat: diff, commits: commits.split('\n').filter(Boolean), branch, base, behindBy });
    }

    // Otherwise, show working directory changes
    const diff = execFileSync('git', ['-C', repo, 'diff', '--no-color'],
      { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 5 * 1024 * 1024 }
    ).trim();

    const staged = execFileSync('git', ['-C', repo, 'diff', '--cached', '--no-color'],
      { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 5 * 1024 * 1024 }
    ).trim();

    const status = execFileSync('git', ['-C', repo, 'status', '--short', '--no-color'],
      { encoding: 'utf-8', stdio: 'pipe' }
    ).trim();

    return NextResponse.json({ diff, staged, status: status.split('\n').filter(Boolean) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'git diff failed' }, { status: 500 });
  }
}
