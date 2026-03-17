import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getAllAgents, createAgent, getActiveAgentsCount, getPendingTasksCount, getLogCountToday, getAllTokenUsage, insertLog, updateAgent } from '@/lib/db';
import { spawnAgent } from '@/lib/spawner';
import { startMonitor } from '@/lib/agent-monitor';
import { startCronScheduler } from '@/lib/cron-scheduler';
import type { SpawnAgentRequest, ImportAgentRequest } from '@/types';
import fs from 'fs';
import path from 'path';

// Start autonomous agent monitor (idempotent — safe to call on every request)
startMonitor();
startCronScheduler();

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
    const body = await req.json();
    const { task, type = 'claude', repo, name, model, depends_on } = body as SpawnAgentRequest & { depends_on?: string[] };

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

    // Set depends_on if provided
    if (depends_on && depends_on.length > 0) {
      updateAgent(id, { depends_on: depends_on.join(',') });
    }

    // Spawn the agent async (don't await - return immediately)
    spawnAgent({ agentId: id, name: agentName, type, task, repo, model }).catch((err) => {
      console.error(`Failed to spawn agent ${id}:`, err);
    });

    const agent = { id, name: agentName, type, status: 'spawning', task, repo, created_at: now };
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    console.error('POST /api/agents error:', err);
    return NextResponse.json({ error: 'Failed to spawn agent' }, { status: 500 });
  }
}

/** PUT /api/agents — import an existing directory as an agent */
export async function PUT(req: NextRequest) {
  try {
    const body: ImportAgentRequest = await req.json();
    const { path: dirPath, name, task, type = 'claude', model } = body;

    if (!dirPath) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }

    // Resolve and validate the path — prevent directory traversal
    const resolved = path.resolve(dirPath);
    const homeDir = require('os').homedir();
    if (!resolved.startsWith(homeDir) && !resolved.startsWith('/tmp')) {
      return NextResponse.json({ error: `Path must be under home directory or /tmp` }, { status: 400 });
    }
    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: `Path does not exist: ${resolved}` }, { status: 400 });
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: `Path is not a directory: ${resolved}` }, { status: 400 });
    }

    // Detect if it's a git repo
    let isGitRepo = false;
    let gitBranch: string | null = null;
    try {
      const { execFileSync } = require('child_process');
      execFileSync('git', ['-C', resolved, 'rev-parse', '--git-dir'], { stdio: 'pipe' });
      isGitRepo = true;
      gitBranch = execFileSync('git', ['-C', resolved, 'rev-parse', '--abbrev-ref', 'HEAD'], { stdio: 'pipe', encoding: 'utf-8' }).trim();
    } catch {}

    const id = uuidv4();
    const agentName = name || path.basename(resolved);
    const now = Date.now();
    const agentTask = task || `Imported from ${resolved}`;

    createAgent({
      id,
      name: agentName,
      type,
      status: task ? 'spawning' : 'idle',
      task: agentTask,
      repo: isGitRepo ? resolved : null,
      worktree_path: resolved,
      pid: null,
      port: null,
      created_at: now,
    });

    insertLog(id, 'system', `Imported directory: ${resolved}`);
    if (isGitRepo) {
      insertLog(id, 'system', `Git repo detected — branch: ${gitBranch}`);
    }

    // If a task was provided, spawn the agent to work on it
    if (task) {
      spawnAgent({
        agentId: id,
        name: agentName,
        type,
        task,
        repo: isGitRepo ? resolved : undefined,
        model,
        existingWorktreePath: resolved,
      }).catch((err) => {
        console.error(`Failed to spawn imported agent ${id}:`, err);
      });
      insertLog(id, 'system', `Spawning agent with task: ${task.slice(0, 100)}`);
    } else {
      updateAgent(id, { status: 'idle' });
    }

    const agent = {
      id,
      name: agentName,
      type,
      status: task ? 'spawning' : 'idle',
      task: agentTask,
      repo: isGitRepo ? resolved : null,
      worktree_path: resolved,
      gitBranch,
      created_at: now,
    };
    return NextResponse.json({ agent, imported: true }, { status: 201 });
  } catch (err) {
    console.error('PUT /api/agents error:', err);
    return NextResponse.json({ error: 'Failed to import agent' }, { status: 500 });
  }
}
