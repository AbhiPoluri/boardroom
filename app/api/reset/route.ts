import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { killAgent } from '@/lib/spawner';
import { getAllAgents } from '@/lib/db';
import { removeWorktree } from '@/lib/worktree';
import { execFileSync } from 'child_process';

export const dynamic = 'force-dynamic';

export async function POST() {
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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('POST /api/reset error:', err);
    return NextResponse.json({ error: 'Failed to reset session' }, { status: 500 });
  }
}
