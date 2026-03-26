import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get('repo');
  if (!repo) return NextResponse.json({ error: 'Missing repo param' }, { status: 400 });

  // Prevent traversal above home
  const home = os.homedir();
  const resolved = path.resolve(repo);
  if (!resolved.startsWith(home + path.sep)) {
    return NextResponse.json({ error: 'access denied' }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'Repo path does not exist' }, { status: 400 });
  }

  try {
    const graph = execFileSync(
      'git',
      ['log', '--all', '--oneline', '--graph', '--decorate', '-30'],
      { cwd: resolved, encoding: 'utf8', timeout: 5000 }
    );
    return NextResponse.json({ graph });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    return NextResponse.json({ error: 'git log failed' }, { status: 500 });
  }
}
