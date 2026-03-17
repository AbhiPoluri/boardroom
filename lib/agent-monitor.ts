/**
 * Agent Monitor — autonomous background supervisor.
 * Watches running agents and sends input when they appear stuck or waiting.
 * No user intervention required.
 */

import { getAllAgents, getLogsForAgent, insertLog, cleanupOldPtyChunks } from './db';
import { sendToAgent, isRunning } from './spawner';
import { runClaudeCLI } from './orchestrator';
import type { Agent } from '@/types';

// Patterns that indicate the process is waiting for user input
const WAITING_PATTERNS = [
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /\(yes\/no\)\s*[:\?]?\s*$/i,
  /\(y\/n\)\s*[:\?]?\s*$/i,
  /press enter to continue/i,
  /press any key/i,
  /\?\s*$/, // line ending with ?
  /:\s*$/, // line ending with : (prompt)
  /password[:\s]*$/i,
  /confirm[:\s]*$/i,
  /continue\s*\?/i,
  /proceed\s*\?/i,
  /overwrite\s*\?/i,
];

// Simple rule-based responses for common patterns (fast path — no LLM needed)
function quickResponse(line: string): string | null {
  if (/\[Y\/n\]/i.test(line)) return 'y';
  if (/\[y\/N\]/i.test(line)) return 'y';
  if (/\(yes\/no\)/i.test(line)) return 'yes';
  if (/\(y\/n\)/i.test(line)) return 'y';
  if (/press enter/i.test(line)) return '';
  if (/press any key/i.test(line)) return '';
  if (/password[:\s]*$/i.test(line)) return ''; // blank — can't guess password
  return null;
}

// Per-agent state tracking
const lastSeenLogId = new Map<string, number>();
const lastActivityAt = new Map<string, number>();
const beingAssessed = new Set<string>();

let monitorStarted = false;

// Call once — safe to call multiple times (idempotent)
export function startMonitor(): void {
  if (monitorStarted) return;
  monitorStarted = true;
  // Stagger start by 5s so the server has time to fully initialize
  setTimeout(() => {
    setInterval(tick, 12000);
  }, 5000);
}

let cleanupCounter = 0;

async function tick(): Promise<void> {
  // Run DB cleanup every ~5 ticks (~60s)
  cleanupCounter++;
  if (cleanupCounter % 5 === 0) {
    try { cleanupOldPtyChunks(); } catch {}
  }

  const agents = getAllAgents();
  const active = agents.filter(a => a.status === 'running' || a.status === 'spawning');

  // Clean up tracking state for agents that are no longer active
  const activeIds = new Set(active.map(a => a.id));
  for (const id of beingAssessed) {
    if (!activeIds.has(id)) beingAssessed.delete(id);
  }
  for (const id of lastSeenLogId.keys()) {
    if (!activeIds.has(id)) { lastSeenLogId.delete(id); lastActivityAt.delete(id); }
  }

  for (const agent of active) {
    if (beingAssessed.has(agent.id)) continue;
    checkAgent(agent);
  }
}

async function checkAgent(agent: Agent): Promise<void> {
  const logs = getLogsForAgent(agent.id, 30);
  if (logs.length === 0) return;

  const lastLog = logs[logs.length - 1];
  const prevLastId = lastSeenLogId.get(agent.id) ?? -1;

  if (lastLog.id > prevLastId) {
    // New logs came in — update tracking, not stuck
    lastSeenLogId.set(agent.id, lastLog.id);
    lastActivityAt.set(agent.id, Date.now());
    return;
  }

  // No new logs since last check — see how long it's been quiet
  const lastActivity = lastActivityAt.get(agent.id) ?? Date.now();
  const quietMs = Date.now() - lastActivity;

  // Only intervene after 45s of silence
  if (quietMs < 45000) return;
  if (!isRunning(agent.id)) {
    // Agent died — clean up tracking state
    lastSeenLogId.delete(agent.id);
    lastActivityAt.delete(agent.id);
    beingAssessed.delete(agent.id);
    return;
  }

  const lastContent = lastLog.content.trim();
  const looksLikeWaiting = WAITING_PATTERNS.some(p => p.test(lastContent));

  if (!looksLikeWaiting) return;

  beingAssessed.add(agent.id);
  try {
    await respondToAgent(agent, logs.map(l => l.content), lastContent);
    // Reset activity timer so we don't spam
    lastActivityAt.set(agent.id, Date.now());
  } finally {
    beingAssessed.delete(agent.id);
  }
}

async function respondToAgent(
  agent: Agent,
  recentLines: string[],
  lastLine: string
): Promise<void> {
  insertLog(agent.id, 'system', `[monitor] agent silent for 45s — last line: "${lastLine.slice(0, 80)}"`);

  // Fast path: simple rule-based response
  const quick = quickResponse(lastLine);
  if (quick !== null) {
    insertLog(agent.id, 'system', `[monitor] auto-responding with: ${JSON.stringify(quick)}`);
    sendToAgent(agent.id, quick);
    return;
  }

  // Slow path: ask Claude to decide
  const context = recentLines.slice(-12).join('\n');
  const prompt = `You are autonomously monitoring an AI agent named "${agent.name}".
Task: "${agent.task}"

The agent has been silent for 45+ seconds. Here are its last output lines:
---
${context}
---

Decide what input to send to unblock it. Reply with ONLY valid JSON (no markdown):
{"input": "...", "reason": "..."}

Rules:
- For yes/no questions, respond "y" unless clearly destructive (delete, wipe, remove all, etc.)
- For destructive questions, respond "n"
- For "press enter" or similar, respond with ""
- For interactive menus (numbered options), pick the most sensible option number
- If the output doesn't look like it needs input (just verbose output that paused), send ""
- Never send passwords or secrets — use "" for password prompts`;

  try {
    const result = await runClaudeCLI(prompt);
    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) {
      insertLog(agent.id, 'system', `[monitor] could not parse response — skipping`);
      return;
    }
    const parsed = JSON.parse(match[0]) as { input?: string; reason?: string };
    if (parsed.input !== undefined) {
      insertLog(agent.id, 'system', `[monitor] sending "${parsed.input}" — ${parsed.reason ?? 'no reason given'}`);
      sendToAgent(agent.id, parsed.input);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    insertLog(agent.id, 'system', `[monitor] error deciding input: ${msg.slice(0, 100)}`);
  }
}
