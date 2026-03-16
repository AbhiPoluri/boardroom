import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getAllAgents, createAgent, getActiveAgentsCount, getPendingTasksCount, getLogCountToday, getAllTokenUsage } from '@/lib/db';
import { spawnAgent } from '@/lib/spawner';
import { startMonitor } from '@/lib/agent-monitor';
import type { SpawnAgentRequest } from '@/types';

// Start autonomous agent monitor (idempotent — safe to call on every request)
startMonitor();

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const agents = getAllAgents();
    const agentTokens = getAllTokenUsage();
    const stats = {
      active: getActiveAgentsCount(),
      pending_tasks: getPendingTasksCount(),
      logs_today: getLogCountToday(),
    };
    return NextResponse.json({ agents, stats, tokens: agentTokens });
  } catch (err) {
    console.error('GET /api/agents error:', err);
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: SpawnAgentRequest = await req.json();
    const { task, type = 'claude', repo, name } = body;

    if (!task) {
      return NextResponse.json({ error: 'task is required' }, { status: 400 });
    }

    const id = uuidv4();
    const agentName = name || `${type}-${id.slice(0, 8)}`;
    const now = Date.now();

    // Create agent record first
    createAgent({
      id,
      name: agentName,
      type,
      status: 'spawning',
      task,
      repo: repo || null,
      worktree_path: null,
      pid: null,
      port: null,
      created_at: now,
    });

    // Spawn the agent async (don't await - return immediately)
    spawnAgent({ agentId: id, name: agentName, type, task, repo }).catch((err) => {
      console.error(`Failed to spawn agent ${id}:`, err);
    });

    const agent = { id, name: agentName, type, status: 'spawning', task, repo, created_at: now };
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    console.error('POST /api/agents error:', err);
    return NextResponse.json({ error: 'Failed to spawn agent' }, { status: 500 });
  }
}
