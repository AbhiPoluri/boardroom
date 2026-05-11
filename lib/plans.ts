/**
 * Plan runtime — converts a saved plan into running subtasks the dispatcher /
 * personas can pick up.
 *
 * Subtask lifecycle inside a plan:
 *   staged (waiting for plan to start, or for predecessor in sequential mode)
 *   ↓
 *   open (eligible for pickup / manual assignment)
 *   ↓
 *   assigned → in_progress → done | blocked | cancelled
 *
 * On every subtask completion we re-evaluate the plan: if all are done, the
 * plan finishes; if sequential, we open the next staged step.
 */

import {
  Plan,
  getPlanById,
  getSubtasksForPlan,
  updatePlan,
  updateBoardTask,
} from './db';

export interface StartPlanResult {
  opened: number;
  total: number;
}

function parseDeps(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}

/**
 * Wake any newly-opened subtasks that have a pre-assigned persona. Called
 * after we transition subtasks to 'open' so they don't sit there waiting on
 * the dispatcher. Lazy-imports to avoid a personas.ts ↔ plans.ts cycle.
 */
function spawnPreAssignedOpenSubtasks(subtaskIds: string[]): void {
  if (subtaskIds.length === 0) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getBoardTaskById } = require('./db') as typeof import('./db');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { assignTaskToPersona } = require('./personas') as typeof import('./personas');
  for (const id of subtaskIds) {
    const t = getBoardTaskById(id);
    if (!t || t.status !== 'open' || !t.persona_id) continue;
    assignTaskToPersona(t.persona_id, t).catch(err => {
      console.error(`[plans] auto-spawn for subtask ${id} failed:`, err);
    });
  }
}

/** Move a draft plan to active and open the first batch of subtasks. */
export function startPlan(planId: string): StartPlanResult {
  const plan = getPlanById(planId);
  if (!plan) throw new Error(`plan ${planId} not found`);
  if (plan.status === 'active') {
    return { opened: 0, total: getSubtasksForPlan(planId).length };
  }
  if (plan.status !== 'draft') {
    throw new Error(`cannot start plan in status ${plan.status}`);
  }
  const subtasks = getSubtasksForPlan(planId);
  if (subtasks.length === 0) {
    throw new Error('plan has no subtasks');
  }

  const now = Date.now();
  updatePlan(planId, { status: 'active', started_at: now });

  let opened = 0;
  const openedIds: string[] = [];
  if (plan.execution_mode === 'sequential') {
    // Open only the first staged subtask. Others stay 'staged' until predecessor is done.
    const first = subtasks.find(t => t.status === 'staged' || t.status === 'open');
    if (first) {
      if (first.status !== 'open') updateBoardTask(first.id, { status: 'open' });
      openedIds.push(first.id);
      opened = 1;
    }
    for (const t of subtasks) {
      if (t.id === first?.id) continue;
      if (t.status !== 'staged') updateBoardTask(t.id, { status: 'staged' });
    }
  } else {
    // parallel mode — but if a subtask declares dependencies, it stays staged
    // until those deps are 'done'. This makes the canvas DAG actually mean
    // something at runtime without a separate execution_mode for it.
    const doneIds = new Set(subtasks.filter(t => t.status === 'done').map(t => t.id));
    for (const t of subtasks) {
      const deps = parseDeps(t.depends_on_json);
      const ready = deps.length === 0 || deps.every(d => doneIds.has(d));
      const next = ready ? 'open' : 'staged';
      if (t.status !== next) updateBoardTask(t.id, { status: next });
      if (next === 'open') {
        openedIds.push(t.id);
        opened += 1;
      }
    }
  }

  // Pre-assigned subtasks should spawn their persona immediately — don't make
  // them wait for the next dispatcher tick.
  spawnPreAssignedOpenSubtasks(openedIds);

  return { opened, total: subtasks.length };
}

/**
 * After a subtask transitions to 'done', re-evaluate its plan. Opens the next
 * step in sequential mode, opens DAG-ready successors in parallel mode, and
 * finishes the plan when all subtasks are done.
 */
export function onSubtaskCompleted(planId: string): void {
  const plan = getPlanById(planId);
  if (!plan || plan.status !== 'active') return;
  const subtasks = getSubtasksForPlan(planId);

  // Auto-merge gate: in plans flagged auto_merge=true, approve+merge any
  // pending PR produced by a just-finished subtask before advancing. This
  // ensures sequential subtasks see prior work on disk — without it, every
  // persona's branch starts from the same base and chained doc/code edits
  // are lost.
  if (plan.auto_merge) {
    autoMergeFinishedSubtasks(subtasks);
  }

  const allDone = subtasks.every(t => t.status === 'done' || t.status === 'cancelled');
  if (allDone) {
    updatePlan(planId, { status: 'done', finished_at: Date.now() });
    return;
  }

  const newlyOpened: string[] = [];
  if (plan.execution_mode === 'sequential') {
    const inFlight = subtasks.some(t => t.status === 'in_progress' || t.status === 'assigned' || t.status === 'open');
    if (!inFlight) {
      const next = subtasks.find(t => t.status === 'staged');
      if (next) {
        updateBoardTask(next.id, { status: 'open' });
        newlyOpened.push(next.id);
      }
    }
  } else {
    // parallel: any 'staged' subtask whose dependencies are now all done becomes 'open'.
    const doneIds = new Set(subtasks.filter(t => t.status === 'done').map(t => t.id));
    for (const t of subtasks) {
      if (t.status !== 'staged') continue;
      const deps = parseDeps(t.depends_on_json);
      if (deps.length === 0 || deps.every(d => doneIds.has(d))) {
        updateBoardTask(t.id, { status: 'open' });
        newlyOpened.push(t.id);
      }
    }
  }

  spawnPreAssignedOpenSubtasks(newlyOpened);
}

/** Cancel a plan: marks plan + any non-done subtasks cancelled. */
export function cancelPlan(planId: string): void {
  const plan = getPlanById(planId);
  if (!plan) return;
  const subtasks = getSubtasksForPlan(planId);
  for (const t of subtasks) {
    if (t.status !== 'done') {
      updateBoardTask(t.id, { status: 'cancelled' });
    }
  }
  updatePlan(planId, { status: 'cancelled', finished_at: Date.now() });
}

/** Sync helper: walk all active plans and call onSubtaskCompleted to advance them. */
export function syncActivePlans(plans: Plan[]): void {
  for (const p of plans) {
    if (p.status === 'active') onSubtaskCompleted(p.id);
  }
}

/**
 * For an auto-merge plan, scan its subtasks and approve+merge any pending PR
 * tied to a `done` subtask. Idempotent — already-approved PRs are skipped.
 * If a merge conflicts, the resolver is left to land it (same flow as the
 * /review approve action). Errors are logged but never block plan advance,
 * so a merge failure on step N still lets step N+1 spawn (it'll just start
 * from main without N's content — same as auto_merge=false).
 */
function autoMergeFinishedSubtasks(subtasks: Array<{ id: string; status: string; agent_id: string | null }>): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getPushRequests, getAgentById, updatePushRequest, createNotification } = require('./db') as typeof import('./db');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mergeWorktreeBranch } = require('./worktree') as typeof import('./worktree');

  const doneAgentIds = new Set(
    subtasks.filter(t => t.status === 'done' && t.agent_id).map(t => t.agent_id as string),
  );
  if (doneAgentIds.size === 0) return;

  const pending = getPushRequests('pending', 200) as Array<{
    id: string; agent_id: string; agent_name: string; branch: string; base_branch: string;
  }>;
  for (const pr of pending) {
    if (!doneAgentIds.has(pr.agent_id)) continue;
    const agent = getAgentById(pr.agent_id);
    if (!agent?.repo) continue;
    try {
      const result = mergeWorktreeBranch(agent.repo, pr.branch, pr.base_branch, agent.id);
      if (result.success) {
        updatePushRequest(pr.id, 'approved', 'auto-merged by plan');
        createNotification(
          'push_approved',
          `Auto-merged: ${pr.agent_name}`,
          `Plan auto_merge: ${pr.branch} → ${pr.base_branch}`,
          pr.agent_id,
        );
      }
      // Conflicted PRs leave a resolver running; the next plan tick will
      // re-check this same PR and advance once the resolver lands the merge.
    } catch (err) {
      // Don't block plan advancement on a single failed merge.
      console.error('[plans] auto-merge failed for PR', pr.id, err);
    }
  }
}
