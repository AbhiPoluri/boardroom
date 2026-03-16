import { spawn, ChildProcess } from 'child_process';
import * as pty from 'node-pty';
import { createWorktree, removeWorktree } from './worktree';
import { insertLog, updateAgentStatus, updateAgent, getAgentById, insertPtyChunk, clearPtyChunks, recordTokenUsage, getLogsForAgent } from './db';
import { stripAnsi, isTuiChrome } from './strip-tui';
import type { AgentType } from '@/types';

// Processes: either node-pty IPty or standard ChildProcess
type AnyProcess = pty.IPty | ChildProcess;
const processes = new Map<string, AnyProcess>();
const ptyProcesses = new Map<string, pty.IPty>(); // PTY-specific lookup

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
}

export async function spawnAgent(opts: SpawnOptions): Promise<{ pid: number; worktreePath: string }> {
  const { agentId, name, type, task, repo, model, existingWorktreePath } = opts;

  insertLog(agentId, 'system', `Agent "${name}" starting up (type: ${type})`);

  let worktreePath: string;

  if (existingWorktreePath && require('fs').existsSync(existingWorktreePath)) {
    worktreePath = existingWorktreePath;
    // Clear old PTY chunks so the terminal starts fresh for this task
    clearPtyChunks(agentId);
    insertLog(agentId, 'system', `Reusing worktree: ${worktreePath}`);
  } else {
    const worktreeResult = await createWorktree(agentId, repo);
    if (worktreeResult.error) insertLog(agentId, 'system', `Worktree warning: ${worktreeResult.error}`);
    worktreePath = worktreeResult.path;
    updateAgent(agentId, { worktree_path: worktreePath });
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

  // claude type: use PTY so the full TUI renders with ANSI colors/boxes/spinners
  if (type === 'claude') {
    const modelFlag = model ? ` --model ${model}` : '';
    const shellCmd = `${nvmInit} && claude --dangerously-skip-permissions${modelFlag} '${escapedTask}'`;

    const ptyProc = pty.spawn('/bin/sh', ['-c', shellCmd], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: worktreePath,
      env: { ...process.env, HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
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

    // Store raw PTY output as base64 chunks
    ptyProc.onData((data: string) => {
      // Store raw bytes for xterm.js rendering
      insertPtyChunk(agentId, Buffer.from(data).toString('base64'));
      // Extract plain text for orchestrator context (strip ANSI + TUI chrome)
      const plain = stripAnsi(data);
      const lines = plain.split(/\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!isTuiChrome(trimmed)) {
          insertLog(agentId, 'stdout', trimmed);
        }
      }

      // Reset idle timer on every data event — Claude is still producing output
      if (idleTimer) clearTimeout(idleTimer);

      // Only start idle detection after startup grace period
      if (Date.now() - startTime > STARTUP_GRACE_MS) {
        idleTimer = setTimeout(() => {
          insertLog(agentId, 'system', 'Claude Code idle for 15s — sending /exit');
          try { ptyProc.write('/exit\r'); } catch {}
        }, IDLE_TIMEOUT_MS);
      }
    });

    ptyProc.onExit(({ exitCode, signal }) => {
      processes.delete(agentId);
      ptyProcesses.delete(agentId);
      if (idleTimer) clearTimeout(idleTimer);

      if (signal === 15 || signal === 9) {
        updateAgentStatus(agentId, 'killed');
        insertLog(agentId, 'system', `Process killed (signal: ${signal})`);
      } else if (exitCode === 0) {
        updateAgentStatus(agentId, 'done');
        insertLog(agentId, 'system', `Process exited successfully (code: 0)`);
      } else {
        updateAgentStatus(agentId, 'error');
        insertLog(agentId, 'system', `Process exited with error (code: ${exitCode})`);
      }

      // Parse token usage from agent logs (Claude Code shows "↓ Xk tokens" in output)
      try {
        const logs = getLogsForAgent(agentId, 500);
        const allText = logs.map(l => l.content).join(' ');
        // Match patterns like "↓ 2.1k tokens" or "↑ 703 tokens" or "1.5k tokens"
        const tokenMatch = allText.match(/(\d+\.?\d*k?)\s*tokens/gi);
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

      if (!existingWorktreePath) removeWorktree(agentId, repo).catch(() => {});
    });

    return { pid, worktreePath };
  }

  // All other types: use regular child_process with pipes
  let shellCmd: string;
  let closeStdin = false;

  switch (type) {
    case 'codex':
      shellCmd = `${nvmInit} && codex '${escapedTask}'`;
      closeStdin = true;
      break;
    case 'test':
      shellCmd = `echo "boardroom agent started"; echo "task: ${escapedTask}"; sleep 1; echo "done"`;
      break;
    case 'custom':
      shellCmd = `${nvmInit} && ${task}`;
      break;
    default:
      shellCmd = `${nvmInit} && ${task}`;
  }

  const child = spawn('/bin/sh', ['-c', shellCmd], {
    cwd: worktreePath,
    env: { ...process.env, HOME: home },
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
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      updateAgentStatus(agentId, 'killed');
      insertLog(agentId, 'system', `Process killed (signal: ${signal})`);
    } else if (code === 0) {
      updateAgentStatus(agentId, 'done');
      insertLog(agentId, 'system', `Process exited successfully (code: 0)`);
    } else {
      updateAgentStatus(agentId, 'error');
      insertLog(agentId, 'system', `Process exited with error (code: ${code})`);
    }
    if (!existingWorktreePath) removeWorktree(agentId, repo).catch(() => {});
  });

  child.on('error', (err) => {
    processes.delete(agentId);
    updateAgentStatus(agentId, 'error');
    insertLog(agentId, 'system', `Process error: ${err.message}`);
    if (!existingWorktreePath) removeWorktree(agentId, repo).catch(() => {});
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
