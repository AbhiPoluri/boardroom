import { NextRequest } from 'next/server';
import { getAgentById } from '@/lib/db';
import { getWorktreeGitInfo, getWorktreeDiff, mergeWorktreeBranch, cherryPickCommits, createPatch } from '@/lib/worktree';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = getAgentById(id);
  if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404 });
  if (!agent.worktree_path) return Response.json({ error: 'No worktree' }, { status: 404 });

  const url = new URL(req.url);
  const includeDiff = url.searchParams.get('diff') === '1';

  const info = getWorktreeGitInfo(agent.worktree_path, agent.repo || undefined);

  let diff: string | null = null;
  if (includeDiff && info.isGit) {
    diff = getWorktreeDiff(agent.worktree_path, info.baseBranch);
  }

  return Response.json({ git: info, diff });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = getAgentById(id);
  if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404 });
  if (!agent.repo) return Response.json({ error: 'Agent has no repo' }, { status: 400 });

  const body = await req.json();
  const { action, baseBranch = 'main', commits } = body as {
    action: 'merge' | 'cherry-pick' | 'patch';
    baseBranch?: string;
    commits?: string[];
  };

  const info = getWorktreeGitInfo(agent.worktree_path!, agent.repo);
  if (!info.isGit || !info.branch) {
    return Response.json({ error: 'Not a git worktree' }, { status: 400 });
  }

  switch (action) {
    case 'merge': {
      const result = mergeWorktreeBranch(agent.repo, info.branch, baseBranch);
      return Response.json(result);
    }
    case 'cherry-pick': {
      if (!commits?.length) return Response.json({ error: 'No commits specified' }, { status: 400 });
      const result = cherryPickCommits(agent.repo, commits, baseBranch);
      return Response.json(result);
    }
    case 'patch': {
      const patch = createPatch(agent.worktree_path!, info.baseBranch);
      if (!patch) return Response.json({ error: 'No patch generated' }, { status: 400 });
      return new Response(patch, {
        headers: { 'Content-Type': 'text/plain', 'Content-Disposition': `attachment; filename="${info.branch}.patch"` },
      });
    }
    default:
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
