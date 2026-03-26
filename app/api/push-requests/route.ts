import { NextRequest } from 'next/server';
import { createPushRequest, getPushRequests, getPushRequest, updatePushRequest, getPendingPushRequestsCount, getAgentById, createNotification, createAgent } from '@/lib/db';
import { getWorktreeGitInfo, getWorktreeDiff, mergeWorktreeBranch } from '@/lib/worktree';
import { spawnAgent } from '@/lib/spawner';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const id = searchParams.get('id');
  const countOnly = searchParams.get('count') === '1';

  if (countOnly) {
    return Response.json({ count: getPendingPushRequestsCount() });
  }

  if (id) {
    const pr = getPushRequest(id);
    if (!pr) return Response.json({ error: 'Not found' }, { status: 404 });

    // Include diff if requested
    const includeDiff = searchParams.get('diff') === '1';
    let diff: string | null = null;
    if (includeDiff) {
      const agent = getAgentById(pr.agent_id);
      if (agent?.worktree_path) {
        diff = getWorktreeDiff(agent.worktree_path, pr.base_branch);
      }
    }
    return Response.json({ ...pr, diff });
  }

  const requests = getPushRequests(status);
  return Response.json({ requests });
}

export async function POST(req: NextRequest) {
  let body: { agent_id: string; summary?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { agent_id, summary } = body;

  if (!agent_id) {
    return Response.json({ error: 'agent_id required' }, { status: 400 });
  }

  const agent = getAgentById(agent_id);
  if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404 });
  if (!agent.worktree_path) return Response.json({ error: 'Agent has no worktree' }, { status: 400 });

  const info = getWorktreeGitInfo(agent.worktree_path, agent.repo || undefined);
  if (!info.isGit || !info.branch) {
    return Response.json({ error: 'Not a git worktree' }, { status: 400 });
  }

  const id = uuidv4().slice(0, 8);
  const changedFiles = info.changedFiles || [];

  createPushRequest({
    id,
    agent_id: agent.id,
    agent_name: agent.name,
    branch: info.branch,
    base_branch: info.baseBranch || 'main',
    summary: summary || `Push request from ${agent.name}: ${changedFiles.length} file(s) changed`,
    changed_files_json: JSON.stringify(changedFiles),
  });

  createNotification('push_request', `New push request from ${agent.name}`, `Branch ${info.branch} → ${info.baseBranch || 'main'} (${changedFiles.length} files)`, agent.id);

  return Response.json({ id, status: 'pending', branch: info.branch, baseBranch: info.baseBranch });
}

export async function PATCH(req: NextRequest) {
  let body: { id: string; action: 'approve' | 'reject'; comment?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { id, action, comment } = body;

  if (!id || !action) {
    return Response.json({ error: 'id and action required' }, { status: 400 });
  }

  const pr = getPushRequest(id);
  if (!pr) return Response.json({ error: 'Push request not found' }, { status: 404 });
  if (pr.status !== 'pending') {
    return Response.json({ error: `Already ${pr.status}` }, { status: 400 });
  }

  if (action === 'approve') {
    // Update DB status first so it's correct even if merge fails
    updatePushRequest(id, 'approved', comment);
    createNotification('push_approved', `Push request approved: ${pr.agent_name}`, comment || `Branch ${pr.branch} merged to ${pr.base_branch}`, pr.agent_id);
    // Actually merge the branch
    const agent = getAgentById(pr.agent_id);
    if (agent?.repo) {
      const result = mergeWorktreeBranch(agent.repo, pr.branch, pr.base_branch);
      if (!result.success) {
        if (result.needsAgent && result.conflictFiles) {
          // Auto-spawn resolver agent
          const resolverId = uuidv4();
          const conflictList = result.conflictFiles.join(', ');
          const resolveTask = `Resolve merge conflicts in ${agent.repo}. Branch ${pr.branch} conflicts with ${pr.base_branch} in: ${conflictList}. Steps: 1) git checkout ${pr.base_branch}, 2) git merge ${pr.branch} --no-ff, 3) Resolve all conflict markers by combining both versions, 4) git add resolved files, 5) git commit. Do NOT delete code — combine both.`;
          createAgent({ id: resolverId, name: 'merge-resolver', type: 'claude', status: 'spawning', task: resolveTask, repo: agent.repo, worktree_path: null, pid: null, port: null, created_at: Date.now() });
          spawnAgent({ agentId: resolverId, task: resolveTask, type: 'claude', name: 'merge-resolver', repo: agent.repo, model: 'sonnet', useGitIsolation: false }).catch(() => {});
          return Response.json({ conflict: true, message: `Merge conflict in ${conflictList}. Spawned merge-resolver agent to resolve.`, resolver: resolverId.slice(0,8) });
        }
        return Response.json({ error: `Merge failed: ${result.message}` }, { status: 500 });
      }
    }
  } else {
    updatePushRequest(id, 'rejected', comment);
    createNotification('push_rejected', `Push request rejected: ${pr.agent_name}`, comment || 'No reason given', pr.agent_id);
  }

  return Response.json({ id, status: action === 'approve' ? 'approved' : 'rejected' });
}
