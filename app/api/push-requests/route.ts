import { NextRequest } from 'next/server';
import { createPushRequest, getPushRequests, getPushRequest, updatePushRequest, getPendingPushRequestsCount, getAgentById, createNotification, getActiveProject } from '@/lib/db';
import { getWorktreeGitInfo, getWorktreeDiff, mergeWorktreeBranch, revertMergedBranch, isBranchMergedInto } from '@/lib/worktree';
import { spawnConflictResolver } from '@/lib/conflict-resolver';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

// Project scoping: by default we filter to the active project's PRs so the
// bell + /review reflect the project the user is currently in. Pass
// `?project=all` to get the cross-project view.
function resolveProjectScope(searchParams: URLSearchParams): string | undefined {
  const param = searchParams.get('project');
  if (param === 'all') return undefined;
  if (param && param !== 'active') return param;
  return getActiveProject()?.id;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const id = searchParams.get('id');
  const countOnly = searchParams.get('count') === '1';
  const projectId = resolveProjectScope(searchParams);

  if (countOnly) {
    return Response.json({ count: getPendingPushRequestsCount(projectId) });
  }

  if (id) {
    const pr = getPushRequest(id);
    if (!pr) return Response.json({ error: 'Not found' }, { status: 404 });

    // Include diff + worktree info if requested. The /review page uses
    // worktree_path to build editor deep-links for individual file pills.
    const includeDiff = searchParams.get('diff') === '1';
    let diff: string | null = null;
    let worktreePath: string | null = null;
    let repoPath: string | null = null;
    const agent = getAgentById(pr.agent_id);
    if (agent) {
      worktreePath = agent.worktree_path ?? null;
      repoPath = agent.repo ?? null;
      if (includeDiff && agent.worktree_path) {
        diff = getWorktreeDiff(agent.worktree_path, pr.base_branch);
      }
    }
    // Surface conflict-resolver state when one was spawned for this PR.
    // The resolver agent's `done` status alone isn't authoritative — claude
    // can exit cleanly without actually committing the merge. We cross-check
    // the parent-repo log for the canonical merge commit and downgrade
    // `done → done_unverified` when the merge isn't actually there.
    let resolverStatus: string | null = null;
    let resolverMergeLanded = false;
    if (pr.resolver_agent_id) {
      const resolver = getAgentById(pr.resolver_agent_id);
      resolverStatus = resolver?.status ?? null;
      if (resolverStatus === 'done' && agent?.repo) {
        resolverMergeLanded = isBranchMergedInto(agent.repo, pr.branch, pr.base_branch);
        if (!resolverMergeLanded) resolverStatus = 'done_unverified';
      }
    }
    return Response.json({
      ...pr,
      diff,
      worktree_path: worktreePath,
      repo: repoPath,
      resolver_status: resolverStatus,
      resolver_merge_landed: resolverMergeLanded,
    });
  }

  const requests = getPushRequests(status, 50, projectId);
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
  let body: { id: string; action: 'approve' | 'reject' | 'retry_resolver' | 'revert'; comment?: string };
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
  // retry_resolver and revert operate on already-approved PRs. Approve/reject
  // are only valid on pending ones.
  const postApprovalActions = new Set(['retry_resolver', 'revert']);
  if (!postApprovalActions.has(action) && pr.status !== 'pending') {
    return Response.json({ error: `Already ${pr.status}` }, { status: 400 });
  }

  if (action === 'revert') {
    if (pr.status !== 'approved') {
      return Response.json({ error: 'revert only valid on approved PRs' }, { status: 400 });
    }
    const agent = getAgentById(pr.agent_id);
    if (!agent?.repo) {
      return Response.json({ error: 'cannot revert — owning agent or its repo is missing' }, { status: 400 });
    }
    const result = revertMergedBranch(agent.repo, pr.branch, pr.base_branch, agent.id);
    if (!result.success) {
      return Response.json({ error: result.message }, { status: 500 });
    }
    updatePushRequest(id, 'rejected', `reverted: ${comment || result.message}`);
    createNotification('push_rejected', `Push reverted: ${pr.agent_name}`, result.message, pr.agent_id);
    return Response.json({ id, status: 'reverted', message: result.message, revertCommit: result.revertCommit });
  }

  if (action === 'retry_resolver') {
    if (pr.status !== 'approved') {
      return Response.json({ error: 'retry only valid on approved PRs whose resolver failed' }, { status: 400 });
    }
    const agent = getAgentById(pr.agent_id);
    if (!agent?.repo) {
      return Response.json({ error: 'cannot retry — owning agent or its repo is missing' }, { status: 400 });
    }
    const result = mergeWorktreeBranch(agent.repo, pr.branch, pr.base_branch, agent.id);
    if (result.success) {
      return Response.json({ id, status: 'merged', message: result.message });
    }
    if (result.needsAgent && result.conflictFiles) {
      const { shortId } = await spawnConflictResolver({
        pr: { id: pr.id, agent_id: pr.agent_id, branch: pr.branch, base_branch: pr.base_branch },
        repo: agent.repo,
        conflictFiles: result.conflictFiles,
      });
      return Response.json({ conflict: true, message: `Re-spawned resolver`, resolver: shortId });
    }
    return Response.json({ error: `Retry failed: ${result.message}` }, { status: 500 });
  }

  if (action === 'approve') {
    // Update DB status first so it's correct even if merge fails
    updatePushRequest(id, 'approved', comment);
    createNotification('push_approved', `Push request approved: ${pr.agent_name}`, comment || `Branch ${pr.branch} merged to ${pr.base_branch}`, pr.agent_id);
    // Actually merge the branch
    const agent = getAgentById(pr.agent_id);
    if (agent?.repo) {
      const result = mergeWorktreeBranch(agent.repo, pr.branch, pr.base_branch, agent.id);
      if (!result.success) {
        if (result.needsAgent && result.conflictFiles) {
          const conflictList = result.conflictFiles.join(', ');
          const { shortId } = await spawnConflictResolver({
            pr: { id: pr.id, agent_id: pr.agent_id, branch: pr.branch, base_branch: pr.base_branch },
            repo: agent.repo,
            conflictFiles: result.conflictFiles,
          });
          return Response.json({ conflict: true, message: `Merge conflict in ${conflictList}. Spawned merge-resolver agent to resolve.`, resolver: shortId });
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
