import { spawn, ChildProcess } from 'child_process';
import * as pty from 'node-pty';
import { createWorktree, removeWorktree } from './worktree';
import {
  insertLog, updateAgentStatus, updateAgent, getAgentById, insertPtyChunk, clearPtyChunks,
  recordTokenUsage, getLogsForAgent, getPtyChunks,
  createPendingQuestion, getOpenPendingQuestionsForAgent, getPersonaForAgent,
  updateBoardTask,
} from './db';
import { stripAnsi, isTuiChrome } from './strip-tui';
import { notifyAgentComplete } from './notifications';
import { generateAgentSummary } from './agent-summary';
import { v4 as uuidv4 } from 'uuid';
import type { AgentType } from '@/types';

/**
 * Detect [ASK_USER]{...json...}[/ASK_USER] markers inside a stream of plain text.
 * Returns the parsed questions and the stripped text (markers removed) so the
 * remaining log lines stay readable.
 */
const ASK_USER_REGEX = /\[ASK_USER\]([\s\S]*?)\[\/ASK_USER\]/g;

interface AskUserPayload {
  question: string;
  options?: string[];
  default?: string;
}

/**
 * A real question must be more than placeholder text. Models often regurgitate
 * the literal protocol example ("...", options ["a","b"]) — drop those.
 */
function isPlaceholderQuestion(p: AskUserPayload): boolean {
  const q = (p.question ?? '').trim();
  if (q.length < 4) return true;
  if (/^\.{1,5}$/.test(q)) return true;          // "...", "..", etc.
  if (/^(your real question|your question( here)?|placeholder|example)$/i.test(q)) return true;
  // The literal example payload from the old preamble:
  if (q === '...' && Array.isArray(p.options) && p.options.length === 2 &&
      p.options[0] === 'a' && p.options[1] === 'b') return true;
  // Generic single-letter option lists are a strong placeholder signal.
  if (Array.isArray(p.options) && p.options.length > 0 &&
      p.options.every(o => /^[a-z]$/i.test(o.trim()))) return true;
  return false;
}

/**
 * Capture a recap from the agent's PTY output and write it to its current
 * task's `result` field. Called immediately when an agent transitions to
 * 'done' so we don't lose PTY chunks to later cleanup.
 */
function captureRecapForAgent(agentId: string): void {
  try {
    const persona = getPersonaForAgent(agentId);
    if (!persona?.current_task_id) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { extractAgentRecap } = require('./recap') as typeof import('./recap');
    const recap = extractAgentRecap(agentId);
    if (recap?.text) {
      updateBoardTask(persona.current_task_id, { result: recap.text });
    }
  } catch (err) {
    insertLog(agentId, 'system', `recap capture failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function extractAskUserMarkers(text: string): { stripped: string; questions: AskUserPayload[] } {
  const questions: AskUserPayload[] = [];
  const stripped = text.replace(ASK_USER_REGEX, (_, rawJson) => {
    try {
      const parsed = JSON.parse(rawJson.trim());
      if (parsed && typeof parsed.question === 'string') {
        const payload: AskUserPayload = {
          question: parsed.question,
          options: Array.isArray(parsed.options) ? parsed.options.map(String) : undefined,
          default: typeof parsed.default === 'string' ? parsed.default : undefined,
        };
        if (!isPlaceholderQuestion(payload)) {
          questions.push(payload);
        }
      }
    } catch {
      // Malformed marker — drop silently; agent should retry.
    }
    return '';
  });
  return { stripped, questions };
}

/**
 * [HANDOFF]{json}[/HANDOFF] — an inline directive from one persona to dispatch
 * a new task to another persona. JSON shape:
 *   { "to": "iris", "title": "review my draft", "reason": "...", "content": "..." }
 */
const HANDOFF_REGEX = /\[HANDOFF\]([\s\S]*?)\[\/HANDOFF\]/g;

interface HandoffPayload {
  to: string;            // persona slug
  title: string;
  reason?: string;
  content?: string;      // body of the handoff
}

function extractHandoffMarkers(text: string): { stripped: string; handoffs: HandoffPayload[] } {
  const handoffs: HandoffPayload[] = [];
  const stripped = text.replace(HANDOFF_REGEX, (_, rawJson) => {
    try {
      const parsed = JSON.parse(rawJson.trim());
      if (
        parsed && typeof parsed.to === 'string' && parsed.to.trim() &&
        typeof parsed.title === 'string' && parsed.title.trim()
      ) {
        const payload: HandoffPayload = {
          to: String(parsed.to).trim(),
          title: String(parsed.title).trim(),
          reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : undefined,
          content: typeof parsed.content === 'string' ? parsed.content : undefined,
        };
        // Reject placeholder/example payloads.
        if (payload.to.length >= 2 && payload.title.length >= 4) {
          handoffs.push(payload);
        }
      }
    } catch {
      // Malformed — drop.
    }
    return '';
  });
  return { stripped, handoffs };
}

/**
 * Apply each handoff: create a new task on the board pre-assigned to the
 * named persona, with attribution back to the sending persona's task.
 * Lazy-imports db helpers to avoid hoisting issues in the spawner module.
 */
function applyHandoffs(
  fromAgentId: string,
  fromPersonaId: string | null,
  fromTaskId: string | null,
  projectId: string | null,
  handoffs: HandoffPayload[],
): void {
  if (handoffs.length === 0) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dbMod = require('./db') as typeof import('./db');
  for (const h of handoffs) {
    const target = dbMod.getPersonaBySlug(h.to, projectId ?? 'default');
    if (!target) {
      insertLog(fromAgentId, 'system', `Handoff failed: no persona "${h.to}" in this project.`);
      continue;
    }
    const id = uuidv4();
    const desc = [
      h.content ? h.content.trim() : '',
      h.reason ? `\n\n*(Reason for handoff: ${h.reason.trim()})*` : '',
    ].filter(Boolean).join('').trim() || h.title;
    try {
      dbMod.createBoardTask({
        id,
        title: h.title,
        description: desc,
        project_id: projectId ?? 'default',
        persona_id: target.id,
        status: 'assigned',
        from_persona_id: fromPersonaId,
        from_task_id: fromTaskId,
        handoff_reason: h.reason ?? null,
      });
      insertLog(fromAgentId, 'system', `Handed off to ${target.name}: "${h.title}"`);
      // Spawn the receiving persona immediately so async handoffs feel alive.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const personaMod = require('./personas') as typeof import('./personas');
      const created = dbMod.getBoardTaskById(id);
      if (created) {
        personaMod.assignTaskToPersona(target.id, created).catch(err => {
          insertLog(fromAgentId, 'system', `Handoff spawn failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    } catch (err) {
      insertLog(fromAgentId, 'system', `Handoff create failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

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

/**
 * If a merge-resolver agent exits without cleanly committing the resolution,
 * the parent repo can be left in MERGE/REVERT-IN-PROGRESS state with conflict
 * markers in tracked files. Future merges + most git commands fail until that
 * state is cleared. This sweep runs `git merge --abort` and `git revert --abort`
 * defensively when a non-isolated agent named 'merge-resolver' exits dirty.
 */
function cleanupHalfMergedRepo(agentId: string, name: string, repo: string | undefined, exitedCleanly: boolean): void {
  if (exitedCleanly) return;
  if (name !== 'merge-resolver') return;
  if (!repo) return;
  try {
    // execFileSync rather than the worktree.ts wrapper because we want hard
    // suppression of failures — both abort commands are no-ops if the repo
    // isn't in the matching state, and we don't want to mask the original
    // resolver failure with an abort error.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require('child_process');
    try { execFileSync('git', ['-C', repo, 'merge', '--abort'], { stdio: 'pipe' }); } catch { /* not in merge */ }
    try { execFileSync('git', ['-C', repo, 'revert', '--abort'], { stdio: 'pipe' }); } catch { /* not in revert */ }
    insertLog(agentId, 'system', `[cleanup] aborted any half-merged state in ${repo}`);
  } catch (err) {
    insertLog(agentId, 'system', `[cleanup] could not abort half-merged state: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Sweep for agent rows whose status is spawning/running but whose recorded PID
 * is no longer alive on the host (typical after a server restart that left
 * "ghost" rows behind, or after the process was OOM-killed). Marks them as
 * error so the persona dispatcher can release the seat and reopen the task.
 *
 * Runs once on server boot.
 */
export function reapGhostAgents(): { reaped: string[] } {
  // Lazy require to avoid a circular import during module init.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getDb } = require('./db') as typeof import('./db');
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, pid FROM agents WHERE status IN ('spawning', 'running')"
  ).all() as Array<{ id: string; pid: number | null }>;

  const reaped: string[] = [];
  for (const row of rows) {
    let alive = false;
    if (row.pid != null) {
      try { process.kill(row.pid, 0); alive = true; } catch { alive = false; }
    }
    if (!alive) {
      try {
        updateAgentStatus(row.id, 'error');
        insertLog(row.id, 'system', `[reap] ghost agent — pid ${row.pid ?? 'unknown'} not alive at boot, marked error`);
        reaped.push(row.id);
      } catch {
        // continue reaping the rest even if one update fails
      }
    }
  }
  if (reaped.length > 0) {
    console.log(`[spawner] reaped ${reaped.length} ghost agent(s) at boot`);
  }
  return { reaped };
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
  /**
   * Persistent claude conversation: when set, claude is launched with
   * `--resume <id>` (existing session) or `--session-id <id>` (fresh session
   * with a stable id). Lets a persona carry conversation memory across tasks
   * — beyond what we manually inject in the team-activity / history blocks.
   */
  claudeSession?: { id: string; existing: boolean };
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

  // ── Claude Code in JSON-streaming mode (clean structured output, no TUI) ──
  if (type === 'claude') {
    const ALLOWED_MODELS = new Set(['haiku', 'sonnet', 'opus', 'claude-3-5-sonnet-20241022', 'claude-sonnet-4-5-20250514', 'claude-3-haiku-20240307', 'claude-opus-4-5-20250514']);
    const safeModel = model && ALLOWED_MODELS.has(model) ? model : undefined;
    const modelFlag = safeModel ? ` --model ${safeModel}` : '';
    // Session continuity: --resume loads the saved conversation, --session-id
    // pins a stable id on a fresh one so the next task can --resume it. The
    // ids are validated as UUIDv4-ish before going into the shell command.
    const session = opts.claudeSession;
    let sessionFlag = '';
    if (session && /^[0-9a-f-]{36}$/i.test(session.id)) {
      // Claude stores session JSONL files under ~/.claude/projects/<cwd-slug>/.
      // Each task spawns in a fresh worktree (different cwd), so --resume
      // can't find the file from the prior task's slot. Copy it across so
      // the resume succeeds. If we can't find the file (e.g. it was pruned
      // by claude itself), drop back to --session-id which starts fresh
      // under the new cwd while keeping the same id.
      let canResume = session.existing;
      if (canResume) {
        try {
          const fsMod = require('fs') as typeof import('fs');
          const projectsDir = path.join(home, '.claude', 'projects');
          const targetSlug = worktreePath.replace(/[^a-zA-Z0-9]/g, '-');
          const targetDir = path.join(projectsDir, targetSlug);
          const targetFile = path.join(targetDir, `${session.id}.jsonl`);
          if (!fsMod.existsSync(targetFile) && fsMod.existsSync(projectsDir)) {
            const slugs = fsMod.readdirSync(projectsDir);
            let sourceFile: string | null = null;
            for (const slug of slugs) {
              const candidate = path.join(projectsDir, slug, `${session.id}.jsonl`);
              if (fsMod.existsSync(candidate)) { sourceFile = candidate; break; }
            }
            if (sourceFile) {
              fsMod.mkdirSync(targetDir, { recursive: true });
              fsMod.copyFileSync(sourceFile, targetFile);
              insertLog(agentId, 'system', `Copied claude session ${session.id.slice(0, 8)} to new cwd for resume`);
            } else {
              canResume = false;
              insertLog(agentId, 'system', `Session ${session.id.slice(0, 8)} not found on disk — starting fresh with same id`);
            }
          }
        } catch (err) {
          canResume = false;
          insertLog(agentId, 'system', `Session copy failed: ${err instanceof Error ? err.message : String(err)} — starting fresh`);
        }
      }
      sessionFlag = canResume ? ` --resume ${session.id}` : ` --session-id ${session.id}`;
    }
    // Token-cost flags (cumulative savings ~10–18k input tokens per spawn vs
    // claude's defaults, measured against a heavy plugin/skill load):
    //   --tools — restrict to the small set personas actually use; cuts
    //     ~5–10k tokens of unused tool JSONSchemas (NotebookEdit, MCP server
    //     bridges, etc.) from the system prompt. Personas can't use a skill
    //     anyway because they run -p (non-interactive).
    //   --disable-slash-commands — strips ~3–5k tokens of skill/command
    //     descriptions. Same justification: -p mode can't invoke them.
    //   --exclude-dynamic-system-prompt-sections — moves cwd/env/git status
    //     into the first user message so the cached system prompt is stable
    //     across machines and worktrees, improving cache-hit rates on resume.
    const COST_FLAGS = ' --tools "Read,Edit,Write,Bash,Glob,Grep,WebFetch" --disable-slash-commands --exclude-dynamic-system-prompt-sections';
    const shellCmd = `${nvmInit} && claude -p${sessionFlag}${COST_FLAGS} --output-format stream-json --verbose --dangerously-skip-permissions${modelFlag} '${escapedTask}'`;

    const child = spawn('/bin/sh', ['-c', shellCmd], {
      cwd: worktreePath,
      env: { ...process.env, HOME: home, CLAUDE_CODE_ENTRYPOINT: '', CLAUDECODE: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    processes.set(agentId, child);
    const pid = child.pid || 0;
    updateAgentStatus(agentId, 'running', pid);
    insertLog(agentId, 'system', `Process started with PID ${pid} (stream-json mode)`);

    // Buffer up to assemble the final answer text from streamed assistant events.
    const assistantText: string[] = [];
    let finalResult: string | null = null;
    let stdoutBuffer = '';
    let stopReason: string | null = null;
    let sawDoneMarker = false;

    const handleEvent = (evt: Record<string, unknown>) => {
      try {
        const t = evt.type as string | undefined;
        if (t === 'assistant') {
          const msg = evt.message as { content?: unknown[] } | undefined;
          const content = Array.isArray(msg?.content) ? (msg!.content as Array<Record<string, unknown>>) : [];
          for (const c of content) {
            if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
              // Strip [HANDOFF] markers from the text before storing/showing,
              // and dispatch the handoffs as new board tasks.
              let display = c.text;
              if (display.includes('[/HANDOFF]')) {
                const { stripped, handoffs } = extractHandoffMarkers(display);
                if (handoffs.length > 0) {
                  display = stripped;
                  const persona = getPersonaForAgent(agentId);
                  applyHandoffs(
                    agentId,
                    persona?.id ?? null,
                    persona?.current_task_id ?? null,
                    persona?.project_id ?? null,
                    handoffs,
                  );
                }
              }
              // Detect explicit [DONE] confirmation (raw, no JSON) and strip it.
              if (/\[DONE\]/.test(display)) {
                sawDoneMarker = true;
                display = display.replace(/\[DONE\]/g, '').trimEnd();
              }
              if (display.trim()) {
                assistantText.push(display);
                insertLog(agentId, 'agent_text', display);
              }
            } else if (c.type === 'tool_use') {
              const name = String(c.name ?? 'tool');
              let inputPreview = '';
              try { inputPreview = JSON.stringify(c.input ?? {}).slice(0, 600); } catch {}
              insertLog(agentId, 'tool_use', `${name}: ${inputPreview}`);
            } else if (c.type === 'thinking' && typeof c.thinking === 'string') {
              // We don't surface thinking by default — too noisy.
            }
          }
        } else if (t === 'user') {
          const msg = evt.message as { content?: unknown[] } | undefined;
          const content = Array.isArray(msg?.content) ? (msg!.content as Array<Record<string, unknown>>) : [];
          for (const c of content) {
            if (c.type === 'tool_result') {
              let preview = '';
              if (typeof c.content === 'string') preview = c.content;
              else if (Array.isArray(c.content)) {
                preview = c.content
                  .map((part: Record<string, unknown>) => typeof part.text === 'string' ? part.text : '')
                  .join('\n');
              }
              insertLog(agentId, 'tool_result', preview.slice(0, 1200));
            }
          }
        } else if (t === 'result') {
          if (typeof evt.result === 'string') finalResult = evt.result;
          if (typeof evt.stop_reason === 'string') stopReason = evt.stop_reason;
          // Token usage
          const usage = evt.usage as Record<string, number> | undefined;
          if (usage) {
            recordTokenUsage({
              agent_id: agentId,
              source: 'agent',
              input_tokens: Number(usage.input_tokens) || 0,
              output_tokens: Number(usage.output_tokens) || 0,
              cache_read_tokens: Number(usage.cache_read_input_tokens) || 0,
              cache_write_tokens: Number(usage.cache_creation_input_tokens) || 0,
              cost_usd: Number(evt.total_cost_usd) || 0,
              model: model || null,
            });
          }
        } else if (t === 'system' && evt.subtype === 'init') {
          // No-op — could log model/session info if useful.
        }
      } catch (err) {
        insertLog(agentId, 'system', `event-parse error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      let nl = stdoutBuffer.indexOf('\n');
      while (nl !== -1) {
        const line = stdoutBuffer.slice(0, nl).trim();
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
        if (line) {
          try {
            const evt = JSON.parse(line);
            if (evt && typeof evt === 'object') handleEvent(evt as Record<string, unknown>);
          } catch {
            // Non-JSON line — likely a stray boot message; log as stdout for visibility.
            insertLog(agentId, 'stdout', line);
          }
        }
        nl = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const l of lines) {
        if (l.trim()) insertLog(agentId, 'stderr', l.trim());
      }
    });

    child.on('exit', (code, signal) => {
      processes.delete(agentId);
      // Drain any trailing JSON in the buffer.
      if (stdoutBuffer.trim()) {
        try {
          const evt = JSON.parse(stdoutBuffer.trim());
          handleEvent(evt as Record<string, unknown>);
        } catch { /* ignore tail */ }
        stdoutBuffer = '';
      }

      let finalStatus: string;
      const openQuestions = getOpenPendingQuestionsForAgent(agentId);
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        finalStatus = 'killed';
        updateAgentStatus(agentId, 'killed');
        insertLog(agentId, 'system', `Process killed (signal: ${signal})`);
      } else if (openQuestions.length > 0) {
        finalStatus = 'needs_input';
        updateAgentStatus(agentId, 'needs_input');
        insertLog(agentId, 'system', `Awaiting user response (${openQuestions.length} open question${openQuestions.length === 1 ? '' : 's'})`);
      } else if (code === 0) {
        finalStatus = 'done';
        updateAgentStatus(agentId, 'done');
        insertLog(agentId, 'system', 'Process exited successfully (code: 0)');
        // Recap = final result text or accumulated assistant text. Strip
        // [HANDOFF] (already-applied) and [DONE] markers so they don't leak
        // into the task.result panel on the OS board.
        let recap = (finalResult ?? assistantText.join('\n\n')).trim();
        if (recap.includes('[/HANDOFF]')) {
          recap = extractHandoffMarkers(recap).stripped.trim();
        }
        if (/\[DONE\]/.test(recap)) {
          if (!sawDoneMarker) sawDoneMarker = true;
          recap = recap.replace(/\[DONE\]/g, '').trimEnd();
        }
        // Compute completion confidence:
        //   confirmed = agent emitted [DONE]
        //   auto      = clean end_turn stop_reason, no marker
        //   truncated = max_tokens (response cut off)
        //   refused   = model refused
        let completion: 'confirmed' | 'auto' | 'truncated' | 'refused' | null = null;
        if (sawDoneMarker) completion = 'confirmed';
        else if (stopReason === 'max_tokens') completion = 'truncated';
        else if (stopReason === 'refusal') completion = 'refused';
        else if (stopReason === 'end_turn' || stopReason === null) completion = 'auto';
        else completion = 'auto';

        insertLog(agentId, 'system', `Completion: ${completion}${stopReason ? ` (stop_reason: ${stopReason})` : ''}`);

        const persona = getPersonaForAgent(agentId);
        if (persona?.current_task_id) {
          const patch: Record<string, unknown> = { completion };
          if (recap) patch.result = recap;
          updateBoardTask(persona.current_task_id, patch);
        }

        // Auto-commit any uncommitted changes the agent left behind in its
        // worktree, then create a push request if there are commits ahead of
        // the base branch. Mirrors the same logic the PTY path runs.
        if (worktreePath) {
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
        if (useGitIsolation && repo && worktreePath !== repo) {
          try {
            const { execFileSync } = require('child_process');
            const repoName = require('path').basename(repo);
            const safeName = (name || 'agent').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30);
            const branch = `${repoName}/${safeName}-${agentId.slice(0, 8)}`;
            const baseBranch = execFileSync('git', ['-C', repo, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
            let commits = '';
            try {
              commits = execFileSync('git', ['-C', repo, 'log', `${baseBranch}..${branch}`, '--oneline'], { encoding: 'utf-8' }).trim();
            } catch {}
            if (commits) {
              let changedFiles = '';
              try {
                changedFiles = execFileSync('git', ['-C', repo, 'diff', '--name-only', `${baseBranch}...${branch}`], { encoding: 'utf-8' }).trim();
              } catch {}
              const { createPushRequest } = require('./db') as typeof import('./db');
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
      } else {
        finalStatus = 'error';
        updateAgentStatus(agentId, 'error');
        insertLog(agentId, 'system', `Process exited with error (code: ${code})`);
      }
      cleanupHalfMergedRepo(agentId, name, repo, code === 0);
      notifyAgentComplete(agentId, name, finalStatus);
      generateAgentSummary(agentId).catch(() => {});
      if (!existingWorktreePath && !repo) removeWorktree(agentId).catch(() => {});
    });

    child.on('error', (err) => {
      processes.delete(agentId);
      updateAgentStatus(agentId, 'error');
      insertLog(agentId, 'system', `Process error: ${err.message}`);
      cleanupHalfMergedRepo(agentId, name, repo, false);
      if (!existingWorktreePath && !repo) removeWorktree(agentId).catch(() => {});
    });

    return { pid, worktreePath };
  }

  // PTY-based agent types: codex, opencode, hermes — output via TUI/text
  if (type === 'codex' || type === 'opencode' || type === 'hermes') {
    let shellCmd: string;
    if (type === 'codex') {
      shellCmd = `${nvmInit} && codex exec --full-auto --skip-git-repo-check '${escapedTask}'`;
    } else if (type === 'opencode') {
      shellCmd = `export PATH="$HOME/.opencode/bin:$PATH:/usr/local/bin:/opt/homebrew/bin" && opencode run '${escapedTask}'`;
    } else {
      // hermes — one-shot prompt via -z, --yolo skips interactive confirmations
      // (analogous to claude's --dangerously-skip-permissions). Optional model
      // override via the persona's `model` column when set; otherwise hermes
      // uses whatever default the user configured via `hermes model`.
      //
      // Filter out Claude-only aliases (sonnet/haiku/opus) — those leak in
      // when a persona's model field was set while runtime was claude and
      // the user later switched runtime to hermes without clearing the
      // model. Hermes' provider router doesn't know what to do with them
      // and will either error or pick a wrong default. Cleaner to drop
      // back to hermes' configured default.
      const CLAUDE_ALIASES = new Set(['sonnet', 'haiku', 'opus']);
      const isClaudeAlias = model ? CLAUDE_ALIASES.has(model.toLowerCase()) : false;
      const safeModel = model && !isClaudeAlias && /^[a-zA-Z0-9_:.\-/]+$/.test(model) ? model : undefined;
      const modelFlag = safeModel ? ` -m ${safeModel}` : '';
      shellCmd = `export PATH="$HOME/.local/bin:$PATH:/usr/local/bin:/opt/homebrew/bin" && hermes${modelFlag} --yolo -z '${escapedTask}'`;
    }

    const ptyProc = pty.spawn('/bin/sh', ['-c', shellCmd], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: worktreePath,
      env: {
        ...process.env,
        HOME: home,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        CLAUDE_CODE_ENTRYPOINT: '',
        CLAUDECODE: '',
        // Hermes is a Python CLI and Python block-buffers stdout when not
        // attached to a "real" TTY in some environments — even via node-pty.
        // The result is no streaming output in the boardroom UI until the
        // whole run completes. Force unbuffered Python I/O so each print
        // flushes immediately. No-op for codex (Node) and opencode (Go).
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
      } as Record<string, string>,
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

    // Track idle state to auto-exit when the agent finishes its task.
    // Strategy:
    //   - Any new PTY data resets the idle timer.
    //   - For claude (legacy TUI), idle → send /exit (slash command).
    //   - For hermes/codex/opencode (one-shot CLIs), idle → SIGTERM. They
    //     don't read stdin in -p / -z mode, so /exit is a no-op there and
    //     would leave the process hung indefinitely.
    //   - When [DONE] marker appears in plain output, shrink the idle
    //     window to DONE_GRACE_MS — the agent has signalled completion,
    //     anything after that is provider/runtime cleanup we shouldn't
    //     wait long for.
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let sawDoneMarker = false;
    const startTime = Date.now();
    const STARTUP_GRACE_MS = 20000;       // ignore idle during first 20s
    const IDLE_TIMEOUT_MS = 15000;        // 15s of no output = done (claude TUI)
    const HERMES_IDLE_MS = 30000;         // hermes streams slowly; longer cap
    const DONE_GRACE_CLAUDE_MS = 5000;    // claude TUI exits cleanly via /exit — 5s is plenty
    const DONE_GRACE_HERMES_MS = 10000;   // one-shot CLIs (hermes/codex/opencode) buffer
                                          // stdout in -z/-p mode; some MCP shutdown bugs
                                          // (e.g. @browsermcp/mcp recursion) leave the
                                          // process wedged. 10s lets the buffer flush
                                          // before we SIGTERM.

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

      // Detect [ASK_USER] markers inside the buffered text. Gated to persona-
      // spawned agents (they're the ones with the protocol preamble); legacy
      // fleet agents may emit the literal string in code/docs without intent.
      if (lineBuffer.includes('[/ASK_USER]') && getPersonaForAgent(agentId)) {
        const { stripped, questions } = extractAskUserMarkers(lineBuffer);
        if (questions.length > 0) {
          lineBuffer = stripped;
          const agent = getAgentById(agentId);
          for (const q of questions) {
            const qid = uuidv4();
            createPendingQuestion({
              id: qid,
              agent_id: agentId,
              project_id: agent?.project_id ?? null,
              question: q.question,
              options: q.options ?? null,
              default_choice: q.default ?? null,
              original_task: agent?.task ?? null,
            });
            insertLog(agentId, 'system', `Question queued for user: ${q.question}`);
          }
          updateAgentStatus(agentId, 'needs_input');
        }
      }

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

      // Detect [DONE] marker in the streamed plain text — agent's own signal
      // that work is complete. Subsequent output is provider/runtime cleanup.
      if (!sawDoneMarker && /\[DONE\]/.test(plain)) {
        sawDoneMarker = true;
        insertLog(agentId, 'system', '[DONE] marker emitted — terminating after grace period');
      }

      // Reset idle timer on every data event — agent is still producing output
      if (idleTimer) clearTimeout(idleTimer);

      // Only start idle detection after startup grace period
      const sinceStart = Date.now() - startTime;
      if (sinceStart > STARTUP_GRACE_MS || sawDoneMarker) {
        const isClaudeTui = type === 'claude'; // legacy claude PTY path
        const DONE_GRACE_MS = isClaudeTui ? DONE_GRACE_CLAUDE_MS : DONE_GRACE_HERMES_MS;
        const timeoutMs = sawDoneMarker
          ? DONE_GRACE_MS
          : (isClaudeTui ? IDLE_TIMEOUT_MS : HERMES_IDLE_MS);

        idleTimer = setTimeout(() => {
          // Flush any remaining buffer before exiting
          if (lineBuffer.trim() && !isTuiChrome(lineBuffer.trim())) {
            insertLog(agentId, 'stdout', lineBuffer.trim());
          }
          lineBuffer = '';

          if (isClaudeTui) {
            // Claude Code TUI: gracefully exit via slash command.
            insertLog(agentId, 'system', `Claude Code idle for ${timeoutMs / 1000}s — sending /exit`);
            try { ptyProc.write('/exit\r'); } catch {}
          } else {
            // hermes/codex/opencode: one-shot CLIs that don't read stdin.
            // /exit would be a no-op and leave the process hung. SIGTERM.
            const reason = sawDoneMarker
              ? `[DONE] emitted ${timeoutMs / 1000}s ago, runtime ${type} not exiting`
              : `${type} idle for ${timeoutMs / 1000}s without [DONE]`;
            insertLog(agentId, 'system', `${reason} — sending SIGTERM`);
            try { ptyProc.kill(); } catch {}
          }
        }, timeoutMs);
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
      const openQuestions = getOpenPendingQuestionsForAgent(agentId);
      if (signal === 15 || signal === 9) {
        finalStatus = 'killed';
        updateAgentStatus(agentId, 'killed');
        insertLog(agentId, 'system', `Process killed (signal: ${signal})`);
      } else if (openQuestions.length > 0) {
        // Agent paused itself by asking the user a question. Don't mark done —
        // wait for the user to resolve the question, which resumes the agent.
        finalStatus = 'needs_input';
        updateAgentStatus(agentId, 'needs_input');
        insertLog(agentId, 'system', `Awaiting user response (${openQuestions.length} open question${openQuestions.length === 1 ? '' : 's'})`);
      } else if (exitCode === 0) {
        finalStatus = 'done';
        updateAgentStatus(agentId, 'done');
        insertLog(agentId, 'system', `Process exited successfully (code: 0)`);
        captureRecapForAgent(agentId);
      } else {
        finalStatus = 'error';
        updateAgentStatus(agentId, 'error');
        insertLog(agentId, 'system', `Process exited with error (code: ${exitCode})`);
      }
      cleanupHalfMergedRepo(agentId, name, repo, exitCode === 0);

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
    const openQuestions = getOpenPendingQuestionsForAgent(agentId);
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      finalStatus = 'killed';
      updateAgentStatus(agentId, 'killed');
      insertLog(agentId, 'system', `Process killed (signal: ${signal})`);
    } else if (openQuestions.length > 0) {
      finalStatus = 'needs_input';
      updateAgentStatus(agentId, 'needs_input');
      insertLog(agentId, 'system', `Awaiting user response (${openQuestions.length} open question${openQuestions.length === 1 ? '' : 's'})`);
    } else if (code === 0) {
      finalStatus = 'done';
      updateAgentStatus(agentId, 'done');
      insertLog(agentId, 'system', `Process exited successfully (code: 0)`);
      captureRecapForAgent(agentId);
    } else {
      finalStatus = 'error';
      updateAgentStatus(agentId, 'error');
      insertLog(agentId, 'system', `Process exited with error (code: ${code})`);
    }
    cleanupHalfMergedRepo(agentId, name, repo, code === 0);
    notifyAgentComplete(agentId, name, finalStatus);
    generateAgentSummary(agentId).catch(() => {});
    if (!existingWorktreePath && !repo) removeWorktree(agentId).catch(() => {});
  });

  child.on('error', (err) => {
    processes.delete(agentId);
    updateAgentStatus(agentId, 'error');
    insertLog(agentId, 'system', `Process error: ${err.message}`);
    cleanupHalfMergedRepo(agentId, name, repo, false);
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
