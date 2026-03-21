import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Worktrees live outside any repo to avoid git confusion
const WORKTREES_DIR = path.join(os.homedir(), '.boardroom', 'worktrees');

export interface WorktreeResult {
  path: string;
  created: boolean;
  error?: string;
}

export interface GitInfo {
  isGit: boolean;
  branch?: string;
  baseBranch?: string;
  aheadBy?: number;
  changedFiles?: ChangedFile[];
  diff?: string;
  recentCommits?: CommitInfo[];
}

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions?: number;
  deletions?: number;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

function git(cwd: string, cmd: string): string {
  return execSync(`git -C "${cwd}" ${cmd}`, { stdio: 'pipe', encoding: 'utf-8' }).trim();
}

function gitSafe(cwd: string, cmd: string): string | null {
  try { return git(cwd, cmd); } catch { return null; }
}

export function ensureWorktreesDir(): void {
  if (!fs.existsSync(WORKTREES_DIR)) {
    fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  }
}

export async function createWorktree(agentId: string, repo?: string, agentName?: string): Promise<WorktreeResult> {
  ensureWorktreesDir();

  const worktreePath = path.join(WORKTREES_DIR, agentId);

  if (!repo) {
    fs.mkdirSync(worktreePath, { recursive: true });
    return { path: worktreePath, created: true };
  }

  try {
    execSync(`git -C "${repo}" rev-parse --git-dir`, { stdio: 'pipe' });
  } catch {
    fs.mkdirSync(worktreePath, { recursive: true });
    return { path: worktreePath, created: true, error: `Repo ${repo} is not a git repo, using worktrees dir` };
  }

  try {
    // Branch name: reponame/agent-name-shortid
    const repoName = path.basename(repo);
    const safeName = (agentName || 'agent').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30);
    const shortId = agentId.slice(0, 8);
    const branchName = `${repoName}/${safeName}-${shortId}`;
    execSync(
      `git -C "${repo}" worktree add "${worktreePath}" -b "${branchName}"`,
      { stdio: 'pipe' }
    );
    return { path: worktreePath, created: true };
  } catch (err) {
    fs.mkdirSync(worktreePath, { recursive: true });
    const error = err instanceof Error ? err.message : String(err);
    return { path: worktreePath, created: true, error: `Worktree creation failed: ${error}` };
  }
}

export async function removeWorktree(agentId: string, repo?: string): Promise<void> {
  const worktreePath = path.join(WORKTREES_DIR, agentId);

  if (repo && fs.existsSync(worktreePath)) {
    try {
      execSync(`git -C "${repo}" worktree remove "${worktreePath}" --force`, { stdio: 'pipe' });
    } catch {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {}
    }
  } else if (fs.existsSync(worktreePath)) {
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } catch {}
  }

  if (repo) {
    try {
      execSync(`git -C "${repo}" branch -D "boardroom/${agentId}"`, { stdio: 'pipe' });
    } catch {}
  }
}

/** Get git info for an agent's worktree */
export function getWorktreeGitInfo(worktreePath: string, repo?: string): GitInfo {
  if (!worktreePath || !fs.existsSync(worktreePath)) return { isGit: false };

  // Check if it's a git worktree/repo
  const gitDir = gitSafe(worktreePath, 'rev-parse --git-dir');
  if (!gitDir) return { isGit: false };

  const branch = gitSafe(worktreePath, 'rev-parse --abbrev-ref HEAD') || undefined;

  // Find the base branch (what the worktree was created from)
  let baseBranch: string | undefined;
  if (repo) {
    // Try common base branches
    for (const candidate of ['main', 'master', 'develop']) {
      if (gitSafe(worktreePath, `rev-parse --verify ${candidate} 2>/dev/null`)) {
        baseBranch = candidate;
        break;
      }
    }
  }

  // Commits ahead of base
  let aheadBy: number | undefined;
  if (baseBranch && branch) {
    const countStr = gitSafe(worktreePath, `rev-list --count ${baseBranch}..${branch}`);
    if (countStr) aheadBy = parseInt(countStr, 10);
  }

  // Changed files (staged + unstaged + untracked)
  const changedFiles: ChangedFile[] = [];

  // Diff vs base branch (if we have commits ahead)
  if (baseBranch && aheadBy && aheadBy > 0) {
    const numstat = gitSafe(worktreePath, `diff --numstat ${baseBranch}...${branch}`);
    if (numstat) {
      for (const line of numstat.split('\n')) {
        if (!line.trim()) continue;
        const [add, del, filePath] = line.split('\t');
        changedFiles.push({
          path: filePath,
          status: 'modified',
          additions: add === '-' ? undefined : parseInt(add, 10),
          deletions: del === '-' ? undefined : parseInt(del, 10),
        });
      }
    }
  }

  // Working directory changes (uncommitted)
  const statusOut = gitSafe(worktreePath, 'status --porcelain');
  if (statusOut) {
    for (const line of statusOut.split('\n')) {
      if (!line.trim()) continue;
      const code = line.substring(0, 2);
      const filePath = line.substring(3).trim();
      if (!filePath) continue;
      // Skip files already in changedFiles from commit diff
      if (changedFiles.some(f => f.path === filePath)) continue;
      let status: ChangedFile['status'] = 'modified';
      if (code === '??' || code === 'A') status = 'added';
      else if (code === 'D') status = 'deleted';
      else if (code.startsWith('R')) status = 'renamed';
      changedFiles.push({ path: filePath, status });
    }
  }

  // Recent commits on this branch (since base or last 10)
  const recentCommits: CommitInfo[] = [];
  const logRange = baseBranch ? `${baseBranch}..${branch}` : '-10';
  const logOut = gitSafe(worktreePath, `log ${logRange} --format="%H|%s|%an|%ci" --no-merges`);
  if (logOut) {
    for (const line of logOut.split('\n')) {
      if (!line.trim()) continue;
      const [hash, message, author, date] = line.split('|');
      recentCommits.push({
        hash: hash?.slice(0, 8) || '',
        message: message || '',
        author: author || '',
        date: date || '',
      });
    }
  }

  return {
    isGit: true,
    branch,
    baseBranch,
    aheadBy,
    changedFiles: changedFiles.length > 0 ? changedFiles : undefined,
    recentCommits: recentCommits.length > 0 ? recentCommits : undefined,
  };
}

/** Get the full diff for an agent's worktree */
export function getWorktreeDiff(worktreePath: string, baseBranch?: string): string | null {
  if (!worktreePath || !fs.existsSync(worktreePath)) return null;
  const gitDir = gitSafe(worktreePath, 'rev-parse --git-dir');
  if (!gitDir) return null;

  const branch = gitSafe(worktreePath, 'rev-parse --abbrev-ref HEAD');
  if (!branch) return null;

  // Committed changes vs base
  let diff = '';
  if (baseBranch) {
    diff = gitSafe(worktreePath, `diff ${baseBranch}...${branch}`) || '';
  }

  // Uncommitted changes
  const wdDiff = gitSafe(worktreePath, 'diff') || '';
  const stagedDiff = gitSafe(worktreePath, 'diff --cached') || '';

  return [diff, stagedDiff, wdDiff].filter(Boolean).join('\n') || null;
}

/** Merge agent branch back into base branch. On conflict, auto-resolves via a resolver agent. */
export function mergeWorktreeBranch(
  repo: string,
  agentBranch: string,
  baseBranch = 'main'
): { success: boolean; message: string; needsAgent?: boolean; conflictFiles?: string[] } {
  try {
    if (!/^[\w\-\/\.]+$/.test(baseBranch)) throw new Error('Invalid branch name');
    if (!/^[\w\-\/\.]+$/.test(agentBranch)) throw new Error('Invalid branch name');
    git(repo, `checkout ${baseBranch}`);
    git(repo, `merge ${agentBranch} --no-ff -m "Merge ${agentBranch} into ${baseBranch}"`);
    return { success: true, message: `Merged ${agentBranch} into ${baseBranch}` };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const stderr = err?.stderr?.toString() || '';
    const fullError = msg + ' ' + stderr;

    // Check if it's a merge conflict
    if (fullError.includes('CONFLICT') || fullError.includes('Merge conflict') || fullError.includes('Automatic merge failed')) {
      // Try to get conflict files from the error message since merge may already be aborted
      let conflictFiles: string[] = [];
      // First try git's unmerged files list (if merge is still in progress)
      const conflictOutput = gitSafe(repo, 'diff --name-only --diff-filter=U') || '';
      if (conflictOutput) {
        conflictFiles = conflictOutput.split('\n').filter(Boolean);
      } else {
        // Extract file names from the error message (e.g. "CONFLICT (add/add): Merge conflict in src/app/page.tsx")
        const conflictMatches = fullError.match(/Merge conflict in ([^\n]+)/g) || [];
        conflictFiles = conflictMatches.map(m => m.replace('Merge conflict in ', '').trim());
      }
      if (conflictFiles.length === 0) conflictFiles = ['unknown files'];

      // Abort the failed merge so repo is clean
      gitSafe(repo, 'merge --abort');

      return {
        success: false,
        message: `Merge conflict in ${conflictFiles.length} file(s): ${conflictFiles.join(', ')}`,
        needsAgent: true,
        conflictFiles,
      };
    }

    gitSafe(repo, 'merge --abort');
    return { success: false, message: `Merge failed: ${msg}` };
  }
}

/** Cherry-pick specific commits from agent branch */
export function cherryPickCommits(
  repo: string,
  commits: string[],
  baseBranch = 'main'
): { success: boolean; message: string } {
  try {
    if (!/^[\w\-\/\.]+$/.test(baseBranch)) throw new Error('Invalid branch name');
    git(repo, `checkout ${baseBranch}`);
    for (const hash of commits) {
      if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('Invalid commit hash');
      git(repo, `cherry-pick ${hash}`);
    }
    return { success: true, message: `Cherry-picked ${commits.length} commit(s) onto ${baseBranch}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    gitSafe(repo, 'cherry-pick --abort');
    return { success: false, message: `Cherry-pick failed: ${msg}` };
  }
}

/** Create a patch file from agent's changes */
export function createPatch(worktreePath: string, baseBranch?: string): string | null {
  if (!worktreePath || !fs.existsSync(worktreePath)) return null;
  const branch = gitSafe(worktreePath, 'rev-parse --abbrev-ref HEAD');
  if (!branch || !baseBranch) return null;
  return gitSafe(worktreePath, `format-patch ${baseBranch}..${branch} --stdout`);
}
