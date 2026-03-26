import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get('repo') || '';
  const q = searchParams.get('q') || '';

  if (!repo || !q) {
    return NextResponse.json({ results: [] });
  }

  // Home directory guard — prevent path traversal outside home
  const resolvedRepo = path.resolve(repo);
  const homeDir = os.homedir();
  if (!resolvedRepo.startsWith(homeDir + path.sep) && resolvedRepo !== homeDir) {
    return NextResponse.json({ error: 'repo must be under home directory' }, { status: 403 });
  }

  // Basic path safety check
  if (!fs.existsSync(resolvedRepo)) {
    return NextResponse.json({ error: 'repo not found', results: [] }, { status: 400 });
  }

  // Build keyword list from query (split on whitespace and common separators)
  const keywords = q.trim().split(/[\s,]+/).filter(Boolean);
  if (keywords.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // Use the first keyword as the primary grep pattern, additional keywords as context
  const primary = keywords[0].replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!primary) {
    return NextResponse.json({ results: [] });
  }

  const includeFlags = [
    '--include=*.ts',
    '--include=*.tsx',
    '--include=*.js',
    '--include=*.jsx',
    '--include=*.py',
    '--include=*.rs',
    '--include=*.go',
    '--include=*.java',
    '--include=*.cs',
    '--include=*.rb',
  ];

  try {
    // Find files containing the search term
    let filesOut = '';
    try {
      filesOut = execFileSync('grep', ['-rl', primary, resolvedRepo, ...includeFlags], { timeout: 10000, encoding: 'utf-8' });
    } catch (e: any) {
      // grep exits 1 when no matches found — that's fine
      if (e.status !== 1) throw e;
    }

    const files = filesOut.trim().split('\n').filter(Boolean).slice(0, 10);
    if (files.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const results: Array<{ file: string; line: number; context: string }> = [];

    for (const file of files) {
      try {
        let grepOut = '';
        try {
          grepOut = execFileSync('grep', ['-n', primary, file], { timeout: 5000, encoding: 'utf-8' });
        } catch (e: any) {
          if (e.status !== 1) throw e;
        }

        const lines = grepOut.trim().split('\n').filter(Boolean).slice(0, 3);
        for (const grepLine of lines) {
          const colonIdx = grepLine.indexOf(':');
          if (colonIdx === -1) continue;
          const lineNum = parseInt(grepLine.slice(0, colonIdx), 10);
          if (isNaN(lineNum)) continue;
          const content = grepLine.slice(colonIdx + 1);

          // Get 3 lines of context around the match using fs.readFileSync
          let context = content;
          try {
            const allLines = fs.readFileSync(file, 'utf-8').split('\n');
            const start = Math.max(0, lineNum - 2);
            const end = Math.min(allLines.length, lineNum + 1);
            context = allLines.slice(start, end).join('\n') || content;
          } catch {}

          results.push({ file, line: lineNum, context });
          if (results.length >= 10) break;
        }
      } catch {}
      if (results.length >= 10) break;
    }

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ results: [], error: String(err) });
  }
}
