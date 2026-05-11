/**
 * Autonomous goal loop.
 *
 * When the user gives the orchestrator a goal that warrants multiple steps,
 * the orchestrator calls create_plan with continuation_goal=<original goal>.
 * That plan auto-starts. When it finishes:
 *
 *   1. We synthesise a follow-up "system continuation" chat message that
 *      packages: the original goal, what the plan just did, and the per-
 *      subtask results.
 *   2. We invoke the orchestrator again with the full chat history + this
 *      synthetic continuation. The orchestrator decides:
 *        - Goal met → respond with a final "done" message → loop ends.
 *        - More work needed → call create_plan again (continuation_goal
 *          carries forward) → loop continues.
 *
 * The user only ever has to talk once; the system runs by itself until the
 * goal is reached or the user stops it from the chat panel.
 */

import { getPlanById, getSubtasksForPlan, saveChatMessage, getChatHistory, updatePlan } from './db';
import { runOrchestrator, OrchestratorEvent } from './orchestrator';
import type { BoardTaskWithPersona } from './db';

const MAX_LOOP_DEPTH = 10;

let inFlight = new Set<string>();

/**
 * Called from onSubtaskCompleted when plan transitions to 'done'. If the
 * plan has a continuation_goal, run an orchestrator continuation in the
 * background. Fire-and-forget — the chat UI polls /api/chat and will
 * surface the new assistant message when it lands.
 */
export function maybeRunContinuation(planId: string): void {
  if (inFlight.has(planId)) return;
  const plan = getPlanById(planId);
  if (!plan || plan.status !== 'done') return;
  if (!plan.continuation_goal || !plan.continuation_goal.trim()) return;

  inFlight.add(planId);
  // Fire and forget. Errors are logged but don't propagate — a stuck loop
  // shouldn't bring the server down.
  void runContinuation(plan.id, plan.continuation_goal).catch(err => {
    console.error('[autonomous-loop] continuation failed for plan', planId, err);
  }).finally(() => {
    inFlight.delete(planId);
  });
}

async function runContinuation(planId: string, goal: string): Promise<void> {
  // Safety: hard cap on how many continuations a single goal can fire so
  // a misbehaving orchestrator can't infinite-loop the user's wallet.
  const depth = countContinuationDepth(goal);
  if (depth >= MAX_LOOP_DEPTH) {
    saveChatMessage('assistant', `Autonomous loop stopped — hit depth limit (${MAX_LOOP_DEPTH}). The goal is taking too many plan iterations; review the chat history and decide whether to nudge the orchestrator manually.`, []);
    return;
  }

  const plan = getPlanById(planId);
  if (!plan) return;
  const subtasks = getSubtasksForPlan(planId);
  const summary = buildPlanSummary(plan.title, subtasks);

  const continuationUser = [
    `[autonomous-loop] Plan "${plan.title}" just finished. Subtask summary:`,
    summary,
    '',
    `Original goal:`,
    goal,
    '',
    `Is the goal met? If yes, reply with a short final message — no actions. If not, call create_plan again with the remaining work and include continuation_goal so I can keep going. Do NOT create individual tasks here — only create_plan or no action at all.`,
  ].join('\n');

  // Save the synthetic user message so the chat UI sees it on the next poll.
  saveChatMessage('user', continuationUser, []);

  // Pull full history for the orchestrator (includes our just-added msg).
  const history = getChatHistory(40).map(r => ({
    role: r.role as 'user' | 'assistant',
    content: r.content,
  }));
  const last = history.pop(); // remove the just-added user msg so runOrchestrator gets it as the "userMessage" arg
  const userMessage = last?.content ?? continuationUser;

  // Drain the orchestrator's event stream into a single saved assistant
  // message — same shape POST /api/chat saves on a normal turn.
  let assistantText = '';
  const events: OrchestratorEvent[] = [];
  try {
    for await (const evt of runOrchestrator(userMessage, history)) {
      if (evt.type === 'text') assistantText += evt.content || '';
      if (evt.type === 'tool_use' || evt.type === 'tool_result' || evt.type === 'error') {
        events.push(evt);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    saveChatMessage('assistant', `Autonomous continuation errored: ${msg}`, []);
    return;
  }

  saveChatMessage('assistant', assistantText || '(no response)', events);
}

function buildPlanSummary(title: string, subtasks: BoardTaskWithPersona[]): string {
  if (subtasks.length === 0) return '  (no subtasks)';
  const sorted = [...subtasks].sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0));
  return sorted.map(t => {
    const persona = t.persona_name ?? 'unassigned';
    const recap = (t.result ?? '').replace(/\s+/g, ' ').slice(0, 240);
    return `  - [${t.status}] ${t.title} · ${persona}${recap ? `\n      ${recap}` : ''}`;
  }).join('\n');
}

/** Walk recent chat history and count how many autonomous-loop continuations
 *  the same goal has already triggered. Crude — based on a substring match
 *  in user messages — but enough to stop runaway loops in dev. */
function countContinuationDepth(goal: string): number {
  const recent = getChatHistory(80);
  let n = 0;
  const goalSnippet = goal.slice(0, 80);
  for (const m of recent) {
    if (m.role !== 'user') continue;
    if (m.content.startsWith('[autonomous-loop]') && m.content.includes(goalSnippet)) n++;
  }
  return n;
}
