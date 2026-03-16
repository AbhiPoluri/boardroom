import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

const WORKTREES_DIR = path.join(os.homedir(), 'boardroom', 'worktrees');

export interface WorktreeResult {
  path: string;
  created: boolean;
  error?: string;
}

export function ensureWorktreesDir(): void {
  if (!fs.existsSync(WORKTREES_DIR)) {
    fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  }
}

export async function createWorktree(agentId: string, repo?: string): Promise<WorktreeResult> {
  ensureWorktreesDir();

  const worktreePath = path.join(WORKTREES_DIR, agentId);

  // No repo — use a persistent dir under worktrees/
  if (!repo) {
    fs.mkdirSync(worktreePath, { recursive: true });
    return { path: worktreePath, created: true };
  }

  // Check if repo is a valid git repo
  try {
    execSync(`git -C "${repo}" rev-parse --git-dir`, { stdio: 'pipe' });
  } catch {
    fs.mkdirSync(worktreePath, { recursive: true });
    return { path: worktreePath, created: true, error: `Repo ${repo} is not a git repo, using worktrees dir` };
  }

  // Create git worktree
  try {
    execSync(
      `git -C "${repo}" worktree add "${worktreePath}" -b "boardroom/${agentId}"`,
      { stdio: 'pipe' }
    );
    return { path: worktreePath, created: true };
  } catch (err) {
    // Worktree creation failed — still use the worktrees dir
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

  // Clean up git branch
  if (repo) {
    try {
      execSync(`git -C "${repo}" branch -D "boardroom/${agentId}"`, { stdio: 'pipe' });
    } catch {}
  }
}
