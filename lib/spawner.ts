import { spawn, ChildProcess } from 'child_process';
import * as pty from 'node-pty';
import { createWorktree, removeWorktree } from './worktree';
import { insertLog, updateAgentStatus, updateAgent, getAgentById, insertPtyChunk, clearPtyChunks, recordTokenUsage, getLogsForAgent, getPtyChunks } from './db';
import { stripAnsi, isTuiChrome } from './strip-tui';
import { notifyAgentComplete } from './notifications';
import { generateAgentSummary } from './agent-summary';
import type { AgentType } from '@/types';

// Processes: either node-pty IPty or standard ChildProcess
type AnyProcess = pty.IPty | ChildProcess;
const processes = new Map<string, AnyProcess>();
const ptyProcesses = new Map<string, pty.IPty>(); // PTY-specific lookup
const chunkCounts = new Map<string, number>(); // per-agent PTY chunk counter

function cleanupProcesses() {
  for (const [, p] of ptyProcesses) {
    try { p.kill(); } catch {}
  }
}
process.on('SIGTERM', cleanupProcesses);
process.on('SIGINT', cleanupProcesses);

export function isPtyProcess(agentId: string): boolean {
  return ptyProcesses.has(agentId);
}

export function isRunning(agentId: string): boolean {
  const proc = processes.get(agentId);
  if (!proc) return false;
  if ('pid' in proc && typeof (proc as pty.IPty).write === 'function') {
    // node-pty: check if pid is still alive
    const ptyProc = proc as pty.IPty;
    try { process.kill(ptyProc.pid, 0); return true; } catch { return false; }
  }
  const cp = proc as ChildProcess;
  return cp.exitCode === null && !cp.killed;
}

export interface SpawnOptions {
  agentId: string;
  name: string;
  type: AgentType;
  task: string;
  repo?: string;
  model?: string;
  existingWorktreePath?: string;
  /** When false (default), repo is used as cwd directly — no worktree branch created */
  useGitIsolation?: boolean;
}

export async function spawnAgent(opts: SpawnOptions): Promise<{ pid: number; worktreePath: string }> {
  const { agentId, name, type, task, repo, model, existingWorktreePath } = opts;
  // Only use git isolation when explicitly requested (workspace, workflows)
  const useGitIsolation = opts.useGitIsolation ?? false;

  insertLog(agentId, 'system', `Agent "${name}" starting up (type: ${type})`);

  let worktreePath: string;

  if (existingWorktreePath && require('fs').existsSync(existingWorktreePath)) {
    worktreePath = existingWorktreePath;
    // Clear old PTY chunks so the terminal starts fresh for this task
    clearPtyChunks(agentId);
    insertLog(agentId, 'system', `Reusing worktree: ${worktreePath}`);
  } else if (repo && !useGitIsolation) {
    // Use the repo directly as cwd — no worktree branch
    worktreePath = repo;
    updateAgent(agentId, { worktree_path: worktreePath });
    insertLog(agentId, 'system', `Working directly in repo (no git isolation): ${worktreePath}`);
  } else {
    // Create an isolated git worktree (or a plain temp dir if no repo)
    const worktreeResult = await createWorktree(agentId, useGitIsolation ? repo : undefined, name);
    if (worktreeResult.error) insertLog(agentId, 'system', `Worktree warning: ${worktreeResult.error}`);
    worktreePath = worktreeResult.path;
    updateAgent(agentId, { worktree_path: worktreePath });
    if (repo && useGitIsolation) {
      const repoName = require('path').basename(repo);
      const safeName = (name || 'agent').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30);
      insertLog(agentId, 'system', `Git isolation ON — branch: ${repoName}/${safeName}-${agentId.slice(0, 8)}`);
    }
  }

  insertLog(agentId, 'system', `Working directory: ${worktreePath}`);

  const home = process.env.HOME || require('os').homedir();
  const fs = require('fs');
  const path = require('path');

  // Pre-trust the worktree directory so Claude Code skips the "trust this folder?" prompt
  // Resolve symlinks (macOS /tmp -> /private/tmp) to match Claude Code's internal path resolution
  try {
    const realWorktreePath = fs.realpathSync(worktreePath);
    const trustedPath = realWorktreePath.replace(/\//g, '-');
    const trustDir = path.join(home, '.claude', 'projects', trustedPath);
    if (!fs.existsSync(trustDir)) {
      fs.mkdirSync(trustDir, { recursive: true });
    }
    // Write a settings.json that marks this directory as trusted
    const trustSettings = path.join(trustDir, 'settings.json');
    if (!fs.existsSync(trustSettings)) {
      fs.writeFileSync(trustSettings, JSON.stringify({ isTrusted: true }, null, 2));
    }
  } catch (err) {
    // Broken symlink or permission error — trust prompt will appear but agent can still proceed
    insertLog(agentId, 'system', `Warning: could not pre-trust worktree directory: ${err instanceof Error ? err.message : String(err)}`);
  }

  const nvmInit = `export NVM_DIR="${home}/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"`;
  const escapedTask = task.replace(/'/g, `'\\''`);

  insertLog(agentId, 'system', `Spawning (type: ${type}): ${task.slice(0, 80)}${task.length > 80 ? '…' : ''}`);

  // PTY-based agent types: claude, codex, opencode — full TUI with ANSI
  if (type === 'claude' || type === 'codex' || type === 'opencode') {
    let shellCmd: string;
    if (type === 'claude') {
      const ALLOWED_MODELS = new Set(['haiku', 'sonnet', 'opus', 'claude-3-5-sonnet-20241022', 'claude-sonnet-4-5-20250514', 'claude-3-haiku-20240307', 'claude-opus-4-5-20250514']);
      const safeModel = model && ALLOWED_MODELS.has(model) ? model : undefined;
      const modelFlag = safeModel ? ` --model ${safeModel}` : '';
      shellCmd = `${nvmInit} && claude --dangerously-skip-permissions${modelFlag} '${escapedTask}'`;
    } else if (type === 'codex') {
      shellCmd = `${nvmInit} && codex exec --full-auto --skip-git-repo-check '${escapedTask}'`;
    } else {
      // opencode — use `run` for non-interactive execution
      shellCmd = `export PATH="$HOME/.opencode/bin:$PATH:/usr/local/bin:/opt/homebrew/bin" && opencode run '${escapedTask}'`;
    }

    const ptyProc = pty.spawn('/bin/sh', ['-c', shellCmd], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: worktreePath,
      env: { ...process.env, HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor', CLAUDE_CODE_ENTRYPOINT: '', CLAUDECODE: '' } as Record<string, string>,
    });

    processes.set(agentId, ptyProc as unknown as ChildProcess);
    ptyProcesses.set(agentId, ptyProc);

    // Auto-accept the workspace trust prompt by sending Enter after a short delay
    // The trust prompt shows "Yes, I trust this folder" selected by default — Enter confirms it
    setTimeout(() => {
      try { ptyProc.write('\r'); } catch {}
    }, 3000);

    const pid = ptyProc.pid;
    updateAgentStatus(agentId, 'running', pid);
    insertLog(agentId, 'system', `Process started with PID ${pid}`);

    // Track idle state to auto-exit when Claude Code finishes its task.
    // Strategy: any new PTY data resets a 15s idle timer. If 15s pass with
    // zero output, Claude is sitting at the ❯ prompt → send /exit.
    // We also skip the first 20s to let Claude start up and begin working.
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const startTime = Date.now();
    const STARTUP_GRACE_MS = 20000;  // ignore idle during first 20s
    const IDLE_TIMEOUT_MS = 15000;   // 15s of no output = done

    // Line buffer: PTY data arrives in arbitrary chunks, so a line may be
    // split across multiple onData calls. Buffer incomplete lines and only
    // flush when we see a newline. This prevents word merging.
    let lineBuffer = '';

    // Store raw PTY output as base64 chunks
    ptyProc.onData((data: string) => {
      // Store raw bytes for xterm.js rendering (cap at 50000 chunks per agent)
      const count = (chunkCounts.get(agentId) || 0) + 1;
      chunkCounts.set(agentId, count);
      if (count <= 50000) {
        insertPtyChunk(agentId, Buffer.from(data).toString('base64'));
      }
      // Extract plain text for orchestrator context (strip ANSI + TUI chrome)
      const plain = stripAnsi(data);
      lineBuffer += plain;

      // Process all complete lines (those ending with \n)
      const parts = lineBuffer.split('\n');
      // Last element is the incomplete line — keep it in the buffer
      lineBuffer = parts.pop() || '';

      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed && !isTuiChrome(trimmed)) {
          insertLog(agentId, 'stdout', trimmed);
        }
      }

      // Reset idle timer on every data event — Claude is still producing output
      if (idleTimer) clearTimeout(idleTimer);

      // Only start idle detection after startup grace period
      if (Date.now() - startTime > STARTUP_GRACE_MS) {
        idleTimer = setTimeout(() => {
          // Flush any remaining buffer before exiting
          if (lineBuffer.trim() && !isTuiChrome(lineBuffer.trim())) {
            insertLog(agentId, 'stdout', lineBuffer.trim());
          }
          lineBuffer = '';
          insertLog(agentId, 'system', 'Claude Code idle for 15s — sending /exit');
          try { ptyProc.write('/exit\r'); } catch {}
        }, IDLE_TIMEOUT_MS);
      }
    });

    ptyProc.onExit(({ exitCode, signal }) => {
      processes.delete(agentId);
      ptyProcesses.delete(agentId);
      chunkCounts.delete(agentId);
      if (idleTimer) clearTimeout(idleTimer);

      // Flush remaining line buffer
      if (lineBuffer.trim() && !isTuiChrome(lineBuffer.trim())) {
        insertLog(agentId, 'stdout', lineBuffer.trim());
      }
      lineBuffer = '';

      let finalStatus: string;
      if (signal === 15 || signal === 9) {
        finalStatus = 'killed';
        updateAgentStatus(agentId, 'killed');
        insertLog(agentId, 'system', `Process killed (signal: ${signal})`);
      } else if (exitCode === 0) {
        finalStatus = 'done';
        updateAgentStatus(agentId, 'done');
        insertLog(agentId, 'system', `Process exited successfully (code: 0)`);
      } else {
        finalStatus = 'error';
        updateAgentStatus(agentId, 'error');
        insertLog(agentId, 'system', `Process exited with error (code: ${exitCode})`);
      }

      // Generate summary and notify
      notifyAgentComplete(agentId, name, finalStatus);
      generateAgentSummary(agentId).catch(() => {});

      // Parse token usage from raw PTY chunks (Claude Code shows token counts in TUI status bar)
      // We check raw chunks because the TUI chrome filter strips status bar lines from logs
      try {
        const chunks = getPtyChunks(agentId);
        const rawText = chunks.map((c: { data: string }) => {
          try { return Buffer.from(c.data, 'base64').toString(); } catch { return ''; }
        }).join('');
        const plainText = stripAnsi(rawText);
        // Match patterns like "↓ 2.1k tokens" or "↑ 703 tokens" or "1.5k tokens"
        const tokenMatch = plainText.match(/(\d+\.?\d*k?)\s*tokens/gi);
        if (tokenMatch) {
          let totalTokens = 0;
          for (const m of tokenMatch) {
            const numStr = m.replace(/\s*tokens/i, '');
            const num = numStr.endsWith('k') ? parseFloat(numStr) * 1000 : parseFloat(numStr);
            if (!isNaN(num)) totalTokens = Math.max(totalTokens, num);
          }
          if (totalTokens > 0) {
            // Rough split: ~80% input, ~20% output for Claude Code agents
            recordTokenUsage({
              agent_id: agentId,
              source: 'agent',
              input_tokens: Math.round(totalTokens * 0.8),
              output_tokens: Math.round(totalTokens * 0.2),
              cache_read_tokens: 0,
              cache_write_tokens: 0,
              cost_usd: 0, // Can't determine exact cost from PTY
              model: model || null,
            });
          }
        }
      } catch {}

      // Auto-commit any uncommitted changes the agent left behind
      if (finalStatus === 'done' && worktreePath) {
        try {
          const { execFileSync } = require('child_process');
          let status = '';
          try {
            status = execFileSync('git', ['-C', worktreePath, 'status', '--porcelain'], { encoding: 'utf-8' }).trim();
          } catch {}
          if (status) {
            execFileSync('git', ['-C', worktreePath, 'add', '-A'], { stdio: 'pipe' });
            execFileSync('git', ['-C', worktreePath, 'commit', '-m', `chore: auto-commit remaining changes from ${name}`], { stdio: 'pipe' });
            insertLog(agentId, 'system', `Auto-committed ${status.split('\n').length} uncommitted file(s)`);
          }
        } catch {}
      }

      // Auto-create push request if agent used git isolation and has commits
      if (useGitIsolation && repo && finalStatus === 'done' && worktreePath !== repo) {
        try {
          const { execFileSync } = require('child_process');
          const repoName = require('path').basename(repo);
          const safeName = (name || 'agent').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30);
          const branch = `${repoName}/${safeName}-${agentId.slice(0, 8)}`;
          const baseBranch = execFileSync('git', ['-C', repo, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
          // Check if agent made any commits on its branch
          let commits = '';
          try {
            commits = execFileSync('git', ['-C', repo, 'log', `${baseBranch}..${branch}`, '--oneline'], { encoding: 'utf-8' }).trim();
          } catch {}
          if (commits) {
            let changedFiles = '';
            try {
              changedFiles = execFileSync('git', ['-C', repo, 'diff', '--name-only', `${baseBranch}...${branch}`], { encoding: 'utf-8' }).trim();
            } catch {}
            const { createPushRequest } = require('./db');
            const { v4: uuid4 } = require('uuid');
            createPushRequest({
              id: uuid4(),
              agent_id: agentId,
              agent_name: name,
              branch,
              base_branch: baseBranch,
              summary: commits.split('\n').map((c: string) => c.replace(/^[a-f0-9]+ /, '')).join('; ').slice(0, 500),
              changed_files_json: JSON.stringify(changedFiles.split('\n').filter(Boolean)),
            });
            insertLog(agentId, 'system', `Push request created: ${branch} → ${baseBranch} (${changedFiles.split('\n').filter(Boolean).length} files)`);
          }
        } catch (prErr) {
          insertLog(agentId, 'system', `Could not auto-create push request: ${prErr instanceof Error ? prErr.message : String(prErr)}`);
        }
      }

      // Keep git worktrees alive so users can review diffs and merge
      // Only clean up plain dirs (no repo)
      if (!existingWorktreePath && !repo) removeWorktree(agentId).catch(() => {});
    });

    return { pid, worktreePath };
  }

  // All other types: use regular child_process with pipes
  let shellCmd: string;
  let closeStdin = false;

  switch (type) {
    case 'test':
      shellCmd = `echo "boardroom agent started"; echo "task: ${escapedTask}"; sleep 1; echo "done"`;
      break;
    case 'custom':
      if (!process.env.BOARDROOM_ALLOW_CUSTOM) {
        throw new Error('Custom agent type is disabled. Set BOARDROOM_ALLOW_CUSTOM=true to enable.');
      }
      shellCmd = `${nvmInit} && ${escapedTask}`;
      break;
    default:
      throw new Error('Unsupported agent type: ' + type);
  }

  const child = spawn('/bin/sh', ['-c', shellCmd], {
    cwd: worktreePath,
    env: { ...process.env, HOME: home, CLAUDE_CODE_ENTRYPOINT: '', CLAUDECODE: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (closeStdin) child.stdin?.end();
  processes.set(agentId, child);

  const pid = child.pid || 0;
  updateAgentStatus(agentId, 'running', pid);
  insertLog(agentId, 'system', `Process started with PID ${pid}`);

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) insertLog(agentId, 'stdout', line);
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) insertLog(agentId, 'stderr', line);
    }
  });

  child.on('exit', (code, signal) => {
    processes.delete(agentId);
    let finalStatus: string;
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      finalStatus = 'killed';
      updateAgentStatus(agentId, 'killed');
      insertLog(agentId, 'system', `Process killed (signal: ${signal})`);
    } else if (code === 0) {
      finalStatus = 'done';
      updateAgentStatus(agentId, 'done');
      insertLog(agentId, 'system', `Process exited successfully (code: 0)`);
    } else {
      finalStatus = 'error';
      updateAgentStatus(agentId, 'error');
      insertLog(agentId, 'system', `Process exited with error (code: ${code})`);
    }
    notifyAgentComplete(agentId, name, finalStatus);
    generateAgentSummary(agentId).catch(() => {});
    if (!existingWorktreePath && !repo) removeWorktree(agentId).catch(() => {});
  });

  child.on('error', (err) => {
    processes.delete(agentId);
    updateAgentStatus(agentId, 'error');
    insertLog(agentId, 'system', `Process error: ${err.message}`);
    if (!existingWorktreePath && !repo) removeWorktree(agentId).catch(() => {});
  });

  return { pid, worktreePath };
}

export function killAgent(agentId: string): boolean {
  const ptyProc = ptyProcesses.get(agentId);
  if (ptyProc) {
    try {
      ptyProc.kill('SIGTERM');
      setTimeout(() => {
        if (ptyProcesses.has(agentId)) {
          try { ptyProc.kill('SIGKILL'); } catch {}
        }
      }, 5000);
      return true;
    } catch { return false; }
  }

  const proc = processes.get(agentId) as ChildProcess | undefined;
  if (!proc) return false;
  try {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (processes.has(agentId)) {
        try { proc.kill('SIGKILL'); } catch {}
      }
    }, 5000);
    return true;
  } catch { return false; }
}

export function sendToAgent(agentId: string, message: string): boolean {
  const ptyProc = ptyProcesses.get(agentId);
  if (ptyProc) {
    try { ptyProc.write(message + '\r'); return true; } catch { return false; }
  }
  const proc = processes.get(agentId) as ChildProcess | undefined;
  if (!proc?.stdin) return false;
  try { proc.stdin.write(message + '\n'); return true; } catch { return false; }
}

export async function resumeAgent(agentId: string, newTask: string): Promise<{ pid: number }> {
  const agent = getAgentById(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  if (isRunning(agentId)) {
    killAgent(agentId);
    await new Promise(r => setTimeout(r, 500));
  }

  updateAgent(agentId, { task: newTask, status: 'spawning' });
  insertLog(agentId, 'system', `─── resuming with new task ───`);
  insertLog(agentId, 'system', `Task: ${newTask.slice(0, 120)}${newTask.length > 120 ? '…' : ''}`);

  const { pid } = await spawnAgent({
    agentId,
    name: agent.name || agentId.slice(0, 8),
    type: (agent.type as AgentType) || 'claude',
    task: newTask,
    repo: agent.repo || undefined,
    existingWorktreePath: agent.worktree_path || undefined,
  });

  return { pid };
}
