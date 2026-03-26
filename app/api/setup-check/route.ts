import { execFileSync } from 'child_process';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, { installed: boolean; version?: string }> = {};

  try { checks.node = { installed: true, version: execFileSync('node', ['--version'], { encoding: 'utf-8' }).trim() }; }
  catch { checks.node = { installed: false }; }

  try { checks.git = { installed: true, version: execFileSync('git', ['--version'], { encoding: 'utf-8' }).trim().replace('git version ', '') }; }
  catch { checks.git = { installed: false }; }

  try { checks.claude = { installed: true, version: execFileSync('claude', ['--version'], { encoding: 'utf-8' }).trim() }; }
  catch { checks.claude = { installed: false }; }

  try { checks.codex = { installed: true, version: execFileSync('codex', ['--version'], { encoding: 'utf-8' }).trim() }; }
  catch { checks.codex = { installed: false }; }

  try { checks.opencode = { installed: true, version: execFileSync('opencode', ['--version'], { encoding: 'utf-8' }).trim() }; }
  catch { checks.opencode = { installed: false }; }

  return NextResponse.json(checks);
}
