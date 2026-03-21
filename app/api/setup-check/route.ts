import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, { installed: boolean; version?: string }> = {};

  try { checks.node = { installed: true, version: execSync('node --version', { encoding: 'utf-8' }).trim() }; }
  catch { checks.node = { installed: false }; }

  try { checks.git = { installed: true, version: execSync('git --version', { encoding: 'utf-8' }).trim().replace('git version ', '') }; }
  catch { checks.git = { installed: false }; }

  try { checks.claude = { installed: true, version: execSync('claude --version 2>&1', { encoding: 'utf-8' }).trim() }; }
  catch { checks.claude = { installed: false }; }

  return NextResponse.json(checks);
}
