import { v4 as uuidv4 } from 'uuid';
import { createAgent, getDb } from './db';
import { spawnAgent } from './spawner';

interface ResolverInput {
  pr: { id: string; agent_id: string; branch: string; base_branch: string };
  repo: string;
  conflictFiles: string[];
}

interface ResolverResult {
  resolverId: string;
  shortId: string;
}

/**
 * Build the prompt the merge-resolver agent receives. Kept here so both the
 * /review approval handler and the orchestrator path use the same wording —
 * they had drifted into two slightly different prompts.
 */
export function buildResolverPrompt(input: ResolverInput): string {
  const { pr, repo, conflictFiles } = input;
  const fileList = conflictFiles.join(', ');
  return [
    `Resolve merge conflicts in ${repo}.`,
    `The branch ${pr.branch} conflicts with ${pr.base_branch} in these files: ${fileList}.`,
    '',
    'Steps:',
    `1) git checkout ${pr.base_branch}`,
    `2) git merge ${pr.branch} --no-ff`,
    '3) For each conflicted file, read it, resolve the conflict markers (<<<<<<< ======= >>>>>>>) by keeping BOTH sets of changes intelligently combined.',
    '4) git add the resolved files',
    `5) git commit -m "merge: resolve conflicts for ${pr.branch} into ${pr.base_branch}"`,
    '',
    'Do NOT delete code — combine both versions. Output [DONE] when committed.',
  ].join('\n');
}

/**
 * Spin up a merge-resolver agent for a conflicted PR and record the link on
 * the push_request row so /review can surface its progress. The merge itself
 * runs without git isolation — the resolver works directly on the parent repo.
 */
export async function spawnConflictResolver(input: ResolverInput): Promise<ResolverResult> {
  const { pr, repo } = input;
  const resolverId = uuidv4();
  const task = buildResolverPrompt(input);

  createAgent({
    id: resolverId,
    name: 'merge-resolver',
    type: 'claude',
    status: 'spawning',
    task,
    repo,
    worktree_path: null,
    pid: null,
    port: null,
    created_at: Date.now(),
  });

  // Track the resolver on the PR so the UI can surface its state. The column
  // is added via the v17 migration in lib/db.ts.
  try {
    getDb().prepare(
      `UPDATE push_requests SET resolver_agent_id = ? WHERE id = ?`
    ).run(resolverId, pr.id);
  } catch {
    // Column may not exist on extremely old installs; non-fatal.
  }

  // Fire-and-forget spawn. Failures here don't block the API response —
  // /review polls the PR row + agent status to surface stuck resolvers.
  spawnAgent({
    agentId: resolverId,
    task,
    type: 'claude',
    name: 'merge-resolver',
    repo,
    model: 'sonnet',
    useGitIsolation: false,
  }).catch(() => {});

  return { resolverId, shortId: resolverId.slice(0, 8) };
}
