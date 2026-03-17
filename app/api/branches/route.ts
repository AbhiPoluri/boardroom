import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/db';
import { getWorktreeGitInfo, getWorktreeDiff } from '@/lib/worktree';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId');
  const includeDiff = searchParams.get('diff') === '1';

  // Single agent diff request
  if (agentId) {
    const agents = getAllAgents();
    const agent = agents.find((a: any) => a.id === agentId);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    if (!agent.worktree_path) return NextResponse.json({ error: 'No worktree' }, { status: 404 });

    const info = getWorktreeGitInfo(agent.worktree_path, agent.repo || undefined);
    let diff: string | null = null;
    if (includeDiff && info.isGit) {
      diff = getWorktreeDiff(agent.worktree_path, info.baseBranch);
    }
    return NextResponse.json({ agent: { id: agent.id, name: agent.name, status: agent.status }, git: info, diff });
  }

  // List all agents with git info
  const agents = getAllAgents();
  const branches = agents
    .filter((a: any) => a.worktree_path || a.repo)
    .map((a: any) => {
      const info = getWorktreeGitInfo(
        a.worktree_path || a.repo,
        a.repo || undefined
      );
      return {
        agentId: a.id,
        agentName: a.name,
        agentStatus: a.status,
        repo: a.repo,
        worktreePath: a.worktree_path,
        ...info,
      };
    })
    .filter((b: any) => b.isGit);

  return NextResponse.json({ branches });
}
