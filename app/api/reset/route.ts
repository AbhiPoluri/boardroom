import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { killAgent } from '@/lib/spawner';
import { getAllAgents } from '@/lib/db';
import { removeWorktree } from '@/lib/worktree';
import { execFileSync } from 'child_process';

export const dynamic = 'force-dynamic';

// Per-IP rate limiter: max 2 requests per minute
const resetRateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RESET_RATE_LIMIT_WINDOW_MS = 60_000;
const RESET_RATE_LIMIT_MAX = 2;

function checkResetRateLimit(ip: string): boolean {
  const now = Date.now();

  // Cleanup stale entries
  if (resetRateLimitMap.size > 10000) {
    for (const [key, val] of resetRateLimitMap) {
      if (now - val.windowStart > 2 * RESET_RATE_LIMIT_WINDOW_MS) {
        resetRateLimitMap.delete(key);
      }
    }
  }

  const entry = resetRateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RESET_RATE_LIMIT_WINDOW_MS) {
    resetRateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= RESET_RATE_LIMIT_MAX;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  if (!checkResetRateLimit(ip)) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Max ${RESET_RATE_LIMIT_MAX} reset requests per minute.` },
      { status: 429 }
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || (body as Record<string, unknown>).confirm !== 'yes') {
    return NextResponse.json({ error: 'Missing confirmation: send { "confirm": "yes" }' }, { status: 400 });
  }

  try {
    const agents = getAllAgents();

    // Kill ALL agents (running, spawning, or otherwise) and clean up worktrees
    for (const agent of agents) {
      // Kill the process
      killAgent(agent.id);

      // Also force-kill by PID in case killAgent missed it
      if (agent.pid) {
        try { process.kill(agent.pid, 'SIGKILL'); } catch {}
      }

      // Clean up worktree/tmp dirs
      try {
        await removeWorktree(agent.id, agent.repo || undefined);
      } catch {}
    }

    // Kill any orphaned processes in agent worktree directories
    for (const agent of agents) {
      if (agent.worktree_path) {
        try {
          const lsofOutput = execFileSync('lsof', ['+D', agent.worktree_path, '-t'], { stdio: 'pipe' }).toString().trim();
          if (lsofOutput) {
            for (const pidStr of lsofOutput.split('\n')) {
              const pid = parseInt(pidStr, 10);
              if (pid > 0) try { process.kill(pid, 'SIGKILL'); } catch {}
            }
          }
        } catch {}
      }
    }

    // Clear all tables
    const db = getDb();
    db.exec('DELETE FROM logs');
    db.exec('DELETE FROM pty_chunks');
    db.exec('DELETE FROM tasks');
    db.exec('DELETE FROM chat_messages');
    db.exec('DELETE FROM token_usage');
    db.exec('DELETE FROM agents');
    db.exec('DELETE FROM notifications');
    db.exec('DELETE FROM push_requests');
    db.exec('DELETE FROM workflows');
    db.exec('DELETE FROM workflow_runs');
    db.exec('DELETE FROM cron_jobs');
    db.exec('DELETE FROM bus_messages');
    try { db.exec('DELETE FROM orchestrator_memory'); } catch {}
    try { db.exec('DELETE FROM agent_summaries'); } catch {}

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('POST /api/reset error:', err);
    return NextResponse.json({ error: 'Failed to reset session' }, { status: 500 });
  }
}
