import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get('repo') || '';
  const q = searchParams.get('q') || '';

  if (!repo || !q) {
    return NextResponse.json({ results: [] });
  }

  // Basic path safety check
  if (!fs.existsSync(repo)) {
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
    '--include="*.ts"',
    '--include="*.tsx"',
    '--include="*.js"',
    '--include="*.jsx"',
    '--include="*.py"',
    '--include="*.rs"',
    '--include="*.go"',
    '--include="*.java"',
    '--include="*.cs"',
    '--include="*.rb"',
  ].join(' ');

  try {
    // Find files containing the search term
    const { stdout: filesOut } = await execAsync(
      `grep -rl "${primary}" "${repo}" ${includeFlags} 2>/dev/null | head -10`,
      { timeout: 10000 }
    );

    const files = filesOut.trim().split('\n').filter(Boolean);
    if (files.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const results: Array<{ file: string; line: number; context: string }> = [];

    for (const file of files) {
      try {
        const { stdout: grepOut } = await execAsync(
          `grep -n "${primary}" "${file}" 2>/dev/null | head -3`,
          { timeout: 5000 }
        );

        const lines = grepOut.trim().split('\n').filter(Boolean);
        for (const grepLine of lines) {
          const colonIdx = grepLine.indexOf(':');
          if (colonIdx === -1) continue;
          const lineNum = parseInt(grepLine.slice(0, colonIdx), 10);
          if (isNaN(lineNum)) continue;
          const content = grepLine.slice(colonIdx + 1);

          // Get 3 lines of context around the match
          let context = content;
          try {
            const { stdout: ctxOut } = await execAsync(
              `sed -n "${Math.max(1, lineNum - 1)},${lineNum + 1}p" "${file}" 2>/dev/null`,
              { timeout: 3000 }
            );
            context = ctxOut || content;
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
