/**
 * Hermes progress watcher.
 *
 * `hermes -z` redirects all intermediate stdout/stderr to /dev/null and only
 * writes the final response at the end (oneshot.py:175-181). The PTY is
 * silent for the whole run, so users see "nothing → nothing → big dump".
 *
 * Workaround: hermes also writes a structured session JSON to
 * `~/.hermes/sessions/session_*.json` and *updates it during the run* as
 * messages, tool calls, and results land. We poll that file and surface
 * each new message as a friendly line in boardroom's PTY stream — same
 * channel xterm.js is already rendering.
 *
 * Format roughly:
 *   · thinking  re-reading README-research.md to understand context
 *   → terminal  {"command": "pwd && ls -la"}
 *   ← result    /tmp/nba-parlay/total 12 drwxr-xr-x …
 *
 * Doesn't change how hermes is invoked, doesn't require a hermes patch,
 * doesn't slow anything down — just exposes the state that was already
 * being written to disk.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { insertPtyChunk } from './db';

const SESSIONS_DIR = path.join(os.homedir(), '.hermes', 'sessions');
const POLL_MS = 600;
// Don't dump huge tool outputs into the terminal — preview is enough.
const REASONING_PREVIEW = 240;
const TOOL_ARG_PREVIEW = 160;
const TOOL_RESULT_PREVIEW = 200;

interface ProgressState {
  agentId: string;
  /** Watcher started at this epoch ms; only session files modified after
   *  this are candidates for "ours". */
  mtimeFloor: number;
  /** Resolved once a candidate session file is found. */
  sessionFile: string | null;
  /** Number of session.messages we've already flushed to the PTY stream. */
  lastMessageCount: number;
  /** Set of session files known to be claimed by another watcher, so we
   *  don't double-bind when multiple hermes agents spawn within one tick. */
  timer: ReturnType<typeof setInterval> | null;
}

interface Store {
  agents: Map<string, ProgressState>;
  claimedFiles: Set<string>;
}
const STATE_KEY = '__brr_hermes_progress__';
const g = globalThis as unknown as Record<string, Store>;
const store: Store = g[STATE_KEY] ?? (g[STATE_KEY] = {
  agents: new Map(),
  claimedFiles: new Set(),
});

interface AssistantTC {
  function?: { name?: string; arguments?: string };
  name?: string;
  arguments?: string | Record<string, unknown>;
}
interface SessionMessage {
  role?: string;
  content?: string | Array<unknown> | null;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: AssistantTC[];
  tool_call_id?: string;
}

/** Begin watching a session JSON for the given agent. Call right after the
 *  hermes PTY is spawned. Safe to call twice — second call is a no-op. */
export function startHermesProgressWatcher(agentId: string): void {
  if (store.agents.has(agentId)) return;
  // Sessions dir must exist; bail silently otherwise (no progress, but the
  // agent still runs and the final output still lands the normal way).
  try { fs.accessSync(SESSIONS_DIR, fs.constants.R_OK); } catch { return; }

  const state: ProgressState = {
    agentId,
    mtimeFloor: Date.now() - 1000, // 1s slack to avoid racing the spawn
    sessionFile: null,
    lastMessageCount: 0,
    timer: null,
  };
  state.timer = setInterval(() => {
    try { tick(state); } catch { /* best-effort */ }
  }, POLL_MS);
  if (state.timer && typeof (state.timer as { unref?: () => void }).unref === 'function') {
    (state.timer as { unref: () => void }).unref();
  }
  store.agents.set(agentId, state);
}

/** Stop watching. Does a final drain so any messages written between the
 *  last poll and process exit still land on the stream. */
export function stopHermesProgressWatcher(agentId: string): void {
  const state = store.agents.get(agentId);
  if (!state) return;
  if (state.timer) clearInterval(state.timer);
  try { tick(state); } catch { /* ignore */ }
  if (state.sessionFile) store.claimedFiles.delete(state.sessionFile);
  store.agents.delete(agentId);
}

function tick(state: ProgressState): void {
  if (!state.sessionFile) {
    state.sessionFile = findOurSessionFile(state.mtimeFloor);
    if (!state.sessionFile) return;
    store.claimedFiles.add(state.sessionFile);
  }
  let data: { messages?: SessionMessage[] } | null = null;
  try {
    const raw = fs.readFileSync(state.sessionFile, 'utf-8');
    data = JSON.parse(raw);
  } catch {
    // Mid-write or partial flush — skip this tick, try again.
    return;
  }
  const messages = data?.messages ?? [];
  if (messages.length <= state.lastMessageCount) return;
  for (let i = state.lastMessageCount; i < messages.length; i++) {
    const lines = formatMessage(messages[i]);
    for (const line of lines) {
      const chunk = Buffer.from(line + '\r\n').toString('base64');
      try { insertPtyChunk(state.agentId, chunk); } catch { /* best-effort */ }
    }
  }
  state.lastMessageCount = messages.length;
}

function findOurSessionFile(mtimeFloor: number): string | null {
  let entries: string[];
  try { entries = fs.readdirSync(SESSIONS_DIR); } catch { return null; }
  let pick: { path: string; mtime: number } | null = null;
  for (const name of entries) {
    if (!name.startsWith('session_') || !name.endsWith('.json')) continue;
    const p = path.join(SESSIONS_DIR, name);
    if (store.claimedFiles.has(p)) continue;
    let mt: number;
    try { mt = fs.statSync(p).mtimeMs; } catch { continue; }
    if (mt < mtimeFloor) continue;
    if (!pick || mt > pick.mtime) pick = { path: p, mtime: mt };
  }
  return pick?.path ?? null;
}

// ── Formatting ───────────────────────────────────────────────────────────

const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function clip(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n) + '…' : oneLine;
}

function formatMessage(msg: SessionMessage): string[] {
  const out: string[] = [];
  const role = msg.role ?? '';

  // Don't echo the user's own message back — they wrote it, they don't need
  // to see it again in the terminal.
  if (role === 'user' || role === 'system') return out;

  if (role === 'assistant') {
    const reasoning = msg.reasoning_content || msg.reasoning;
    if (reasoning && reasoning.trim()) {
      out.push(`${CYAN}· thinking${RESET}  ${clip(reasoning, REASONING_PREVIEW)}`);
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name ?? tc.name ?? 'tool';
        const rawArgs = tc.function?.arguments ?? tc.arguments ?? '';
        const argStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs);
        out.push(`${YELLOW}→ ${name}${RESET}  ${clip(argStr, TOOL_ARG_PREVIEW)}`);
      }
    }
    // Skip plain assistant.content — hermes already prints its final
    // response to stdout, so the PTY captures it via the normal path.
    // Emitting it here too would duplicate every reply. The watcher's
    // value is the *intermediate* state (reasoning + tool calls + tool
    // results), which `hermes -z` swallows.
  } else if (role === 'tool') {
    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content);
    out.push(`${DIM}← result    ${clip(content, TOOL_RESULT_PREVIEW)}${RESET}`);
  }

  return out;
}
