/**
 * Persona runtime — bridges the persona row in the DB to a live agent process.
 *
 * A persona is a long-lived "employee" identity (name, role, skills, system
 * prompt) that owns at most one live agent process at a time. Waking a persona
 * spawns (or resumes) its agent with a task; sleeping it kills the underlying
 * agent without deleting the persona.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Persona,
  BoardTask,
  BoardTaskWithPersona,
  createAgent,
  getAgentById,
  updatePersona,
  setPersonaStatus,
  getPersonaById,
  getPersonaForAgent,
  updateBoardTask,
  insertLog,
  getOpenPendingQuestionsForAgent,
  cancelPendingQuestionsForAgent,
  getPlanById,
  getSubtasksForPlan,
  getRecentTasksForPersona,
  getRecentTeamActivity,
  getProjectById,
} from './db';
import { spawnAgent, resumeAgent, killAgent, isRunning } from './spawner';
import { loadAgentConfigs } from './agent-configs';
import type { AgentType } from '@/types';

// Default behavior is to JUST DO THE TASK. Almost every task can be answered
// or attempted directly. Asking is reserved for genuinely irreversible decisions.
//
// The escalation protocol is described in prose — we deliberately do NOT show
// a literal JSON example, because LLMs tend to copy literal example strings
// verbatim ("...", "options:[a,b]") and trigger phantom inbox entries.
const ASK_USER_PREAMBLE = `\n\n---\n\nDefault behavior: answer the question or do the task directly using your best judgement.

Do NOT ask for clarification on tasks that are clear or trivial. If the user asks "what's 1+1", just answer 2. If they say "draft a tweet about X", just draft one — make reasonable assumptions about audience and tone.

The ONLY time to escalate is when a genuinely irreversible or strategic decision blocks progress (e.g. "delete the production database?", "ship this to all users now?"). For trivial ambiguity, pick a reasonable default and proceed.

If you must escalate, emit a single ASK_USER block formatted as JSON with a real question (not a placeholder) and a list of concrete option strings. Then stop and wait. Do NOT emit the protocol example string — only emit the block when you actually need an answer.

When you've actually finished the task — your output is ready and there's nothing more to add — end your response with the literal token [DONE] on its own line. This confirms to the system that you consider the work complete (vs. just hitting a stopping point or running out of tokens). Skip [DONE] if you think the work is partial or if you handed off to a teammate.`;

// Two working-environment preambles, picked based on whether the persona's
// project has a repo bound. With a repo: full code access. Without: empty sandbox.
const ENV_PREAMBLE_NO_REPO = `\n\nWorking environment: you are spawned in an empty sandbox directory. You do NOT have access to any specific user codebase, repository, or filesystem. Do NOT use Bash/Glob/Read/Grep tools to hunt for code — they will return empty. Work from the task description and your general knowledge. If a task implies you need code you can't see, say so in your output and ask the user to provide it (or hand off to a teammate who can).`;

const ENV_PREAMBLE_WITH_REPO = `\n\nWorking environment: your project's codebase is checked out at your current working directory (each persona gets an isolated git worktree branch). Use Bash/Read/Glob/Grep freely to inspect the code. If the task asks you to modify code, you can edit files directly — the spawner auto-commits any changes you leave behind. Don't make speculative changes outside the explicit scope of the task.`;

const HANDOFF_PROTOCOL = `\n\nTeam handoff protocol — when (and only when) a teammate is *clearly better suited* for a piece of the work, you can hand off:

- Do your own task first if you can do it well. Don't reflexively delegate work that's within your skill set.
- Hand off when the work is meaningfully outside your role — e.g. you're a writer asked to write production code, you're a researcher asked to design visual hierarchy.
- Hand off for review if you've drafted something and a critic teammate would substantially improve it before it ships.
- Each handoff creates a new task on the team's board, pre-assigned to that teammate. They spawn automatically. You don't wait for them — finish your own task and let theirs run async.

To hand off, emit a HANDOFF block: a JSON object with "to" (the teammate's slug — exact match, lowercase), "title" (short imperative task title), "reason" (one sentence — why them), and "content" (the actual material they need: your draft, your findings, or the question you want them to tackle). Wrap the JSON in [HANDOFF] and [/HANDOFF] tags. Stay terse in the reason. After the block, finish your own response normally — the handoff runs in parallel.`;

function buildTeamRoster(persona: Persona): string {
  if (!persona.project_id) return '';
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getPersonas } = require('./db') as typeof import('./db');
  const teammates = getPersonas(persona.project_id).filter(p => p.id !== persona.id);
  if (teammates.length === 0) return '';
  const lines: string[] = ['## Your team', ''];
  for (const t of teammates) {
    let skills: string[] = [];
    if (t.skills_json) {
      try { const arr = JSON.parse(t.skills_json); if (Array.isArray(arr)) skills = arr.map(String); } catch {}
    }
    const skillStr = skills.length ? ` · skills: ${skills.slice(0, 5).join(', ')}` : '';
    const roleStr = t.role ? `, ${t.role}` : '';
    // Slug is the address — emphasized so the model uses it correctly in handoffs.
    lines.push(`- **${t.name}**${roleStr} (slug: \`${t.slug}\`)${skillStr}`);
  }
  return lines.join('\n');
}

function buildPersonaPrompt(persona: Persona, task: string, hasRepo: boolean): string {
  const sysParts: string[] = [];
  if (persona.system_prompt) sysParts.push(persona.system_prompt.trim());
  sysParts.push(`You are "${persona.name}"${persona.role ? `, ${persona.role}` : ''}. Stay in character and apply your skills.`);
  if (persona.skills_json) {
    try {
      const skills = JSON.parse(persona.skills_json) as string[];
      if (skills.length) sysParts.push(`Your skills: ${skills.join(', ')}.`);
    } catch {}
  }
  const team = buildTeamRoster(persona);
  if (team) sysParts.push(team);
  const prelude = sysParts.join('\n\n');
  const envPreamble = hasRepo ? ENV_PREAMBLE_WITH_REPO : ENV_PREAMBLE_NO_REPO;
  return `${prelude}\n\n---\n\n# Task\n\n${task}${ASK_USER_PREAMBLE}${HANDOFF_PROTOCOL}${envPreamble}`;
}

export interface WakePersonaOptions {
  persona: Persona;
  task: string;
  taskId?: string;
  repo?: string;
  model?: string;
}

/**
 * Wake a persona to work on a task. If the persona has a live agent, resume it
 * with the new task. Otherwise spawn a fresh agent under the persona's name.
 */
export async function wakePersona(opts: WakePersonaOptions): Promise<{ agentId: string }> {
  const { persona, task, taskId, model } = opts;
  // Effective repo: caller override OR the persona's project's repo binding.
  const project = persona.project_id ? getProjectById(persona.project_id) : undefined;
  const repo = opts.repo ?? project?.repo ?? undefined;
  const fullPrompt = buildPersonaPrompt(persona, task, !!repo);

  // Try to resume the persona's existing agent if it's still around.
  if (persona.current_agent_id) {
    const existing = getAgentById(persona.current_agent_id);
    if (existing) {
      // Cancel stale questions so the resume isn't tagged needs_input again.
      cancelPendingQuestionsForAgent(existing.id);
      try {
        await resumeAgent(existing.id, fullPrompt);
        setPersonaStatus(persona.id, 'working', { agentId: existing.id, taskId: taskId ?? null });
        if (taskId) {
          updateBoardTask(taskId, { status: 'in_progress', agent_id: existing.id, persona_id: persona.id });
        }
        insertLog(existing.id, 'system', `Persona "${persona.name}" resumed for new task`);
        return { agentId: existing.id };
      } catch (err) {
        insertLog(existing.id, 'system', `Resume failed (${err instanceof Error ? err.message : String(err)}); spawning fresh session`);
      }
    }
  }

  // Spawn a fresh agent for this persona.
  // Store the user-facing task on the agent row (clean, displayable). The full
  // prompt (with system prompt + task + protocol) only goes to spawnAgent.
  const agentId = uuidv4();
  const VALID_AGENT_TYPES = new Set<AgentType>(['claude', 'hermes', 'codex', 'opencode']);
  const personaType = persona.agent_type as AgentType | null | undefined;
  const agentType: AgentType = personaType && VALID_AGENT_TYPES.has(personaType) ? personaType : 'claude';
  createAgent({
    id: agentId,
    name: persona.name,
    type: agentType,
    status: 'spawning',
    task: task,
    repo: repo ?? null,
    worktree_path: null,
    pid: null,
    port: null,
    project_id: persona.project_id ?? null,
    created_at: Date.now(),
  });
  insertLog(agentId, 'system', `Persona "${persona.name}" spawned (slug: ${persona.slug})`);

  // Persistent claude session: only meaningful when the persona's runtime is
  // claude. Hermes/codex/opencode have their own session systems (or none);
  // we skip the --resume plumbing entirely for non-claude runtimes.
  let claudeSession: { id: string; existing: boolean } | undefined;
  if (agentType === 'claude') {
    let sessionId = persona.claude_session_id;
    const sessionExisting = !!sessionId;
    if (!sessionId) {
      sessionId = uuidv4();
      updatePersona(persona.id, { claude_session_id: sessionId });
      insertLog(agentId, 'system', `Started new claude session ${sessionId.slice(0, 8)} for persona ${persona.slug}`);
    } else {
      insertLog(agentId, 'system', `Resuming claude session ${sessionId.slice(0, 8)} for persona ${persona.slug}`);
    }
    claudeSession = { id: sessionId, existing: sessionExisting };
  } else {
    insertLog(agentId, 'system', `Runtime: ${agentType} (no claude session — provider-managed)`);
  }

  spawnAgent({
    agentId,
    name: persona.name,
    type: agentType,
    task: fullPrompt,
    repo,
    // When a project repo is bound, give the persona an isolated git worktree
    // branch so parallel runs don't collide. Without a repo, useGitIsolation
    // remains false and spawnAgent uses a plain temp dir.
    useGitIsolation: !!repo,
    model: model ?? persona.model ?? undefined,
    claudeSession,
  }).catch((err) => {
    insertLog(agentId, 'system', `Spawn failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  setPersonaStatus(persona.id, 'working', { agentId, taskId: taskId ?? null });
  if (taskId) {
    updateBoardTask(taskId, { status: 'in_progress', agent_id: agentId, persona_id: persona.id });
  }
  return { agentId };
}

/** Assemble the prompt sent to a persona for a board task (own description only). */
function taskPromptFromBoardTask(task: BoardTask): string {
  const title = (task.title || '').trim();
  const desc = (task.description || '').trim();
  if (!title && !desc) return '';
  if (!title) return desc;
  if (!desc || desc === title) return title;
  return `${title}\n\n${desc}`;
}

/**
 * Gather upstream outputs for a plan subtask. Two cases:
 * - sequential mode: the previous subtask in step_order, if it's done.
 * - parallel mode with depends_on: every dep that's done, in step_order.
 *
 * Returns a formatted markdown block + the upstream task ids it covered, or
 * empty when there are no relevant predecessors.
 */
function gatherDependencyContext(task: BoardTask): { block: string; sources: BoardTaskWithPersona[] } {
  if (!task.plan_id) return { block: '', sources: [] };
  const plan = getPlanById(task.plan_id);
  if (!plan) return { block: '', sources: [] };
  const subtasks = getSubtasksForPlan(task.plan_id);

  let prerequisites: BoardTaskWithPersona[] = [];
  if (plan.execution_mode === 'sequential') {
    const myOrder = task.step_order ?? 0;
    prerequisites = subtasks
      .filter(t => t.id !== task.id && (t.step_order ?? 0) < myOrder && t.status === 'done')
      .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0));
  } else {
    let depIds: string[] = [];
    if (task.depends_on_json) {
      try {
        const arr = JSON.parse(task.depends_on_json);
        if (Array.isArray(arr)) depIds = arr.map(String);
      } catch { /* ignore */ }
    }
    if (depIds.length) {
      const byId = new Map(subtasks.map(t => [t.id, t]));
      prerequisites = depIds
        .map(id => byId.get(id))
        .filter((t): t is BoardTaskWithPersona => Boolean(t) && t!.status === 'done')
        .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0));
    }
  }

  if (prerequisites.length === 0) return { block: '', sources: [] };

  const parts: string[] = [
    '## Context from earlier steps',
    '',
    'Earlier personas in this plan have already produced output for you. Build on their work — don\'t redo it.',
    '',
  ];
  for (const pre of prerequisites) {
    const author = pre.persona_name ? ` — ${pre.persona_name}` : '';
    const stepNum = typeof pre.step_order === 'number' ? `Step ${pre.step_order + 1}: ` : '';
    parts.push(`### ${stepNum}${pre.title || 'Earlier step'}${author}`);
    const result = (pre.result || '').trim();
    parts.push(result || '*(no captured output — proceed using the task description below)*');
    parts.push('');
  }
  return { block: parts.join('\n').trim(), sources: prerequisites };
}

/**
 * Heuristic: result text that's actually a runtime/provider error rather than
 * the persona's real output. We don't want failure messages recycling into
 * the next task's history block as if they were valuable context — that's
 * how a single 429 turns into a self-poisoning prompt across N future tasks.
 */
function isLikelyFailureRecap(result: string): boolean {
  const head = result.slice(0, 250);
  return /^(api call failed|process exited with error|spawn failed|merge failed|cannot merge)\b/i.test(head)
    || /\bhttp [45]\d\d\b/i.test(head)
    || /^\s*error[:\s]/i.test(head);
}

// Short-TTL caches for the recent-task lookups consumed by gatherPersonaHistory
// and gatherTeamActivity. A plan that fans out across personas typically calls
// these functions in rapid bursts (one per subtask wake) with the same
// persona/project keys but different currentTaskIds. Caching the full
// unfiltered list and applying the excludeTaskId at consume time turns the
// inner DB hits into pure JS array filters within a 20s window.
const HISTORY_CACHE_TTL_MS = 20_000;

interface HistoryCacheEntry<T> { at: number; rows: T[] }
const personaHistoryCache = new Map<string, HistoryCacheEntry<BoardTask>>();
const teamActivityCache = new Map<string, HistoryCacheEntry<BoardTask & { persona_name: string | null; persona_slug: string | null }>>();

function recentPersonaTasksCached(personaId: string, projectId: string): BoardTask[] {
  const key = `${personaId}|${projectId}`;
  const hit = personaHistoryCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < HISTORY_CACHE_TTL_MS) return hit.rows;
  const rows = getRecentTasksForPersona(personaId, projectId, 10);
  personaHistoryCache.set(key, { at: now, rows });
  return rows;
}

function recentTeamActivityCached(projectId: string, excludePersonaId: string | null) {
  const key = `${projectId}|${excludePersonaId ?? ''}`;
  const hit = teamActivityCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < HISTORY_CACHE_TTL_MS) return hit.rows;
  const rows = getRecentTeamActivity(projectId, 10, excludePersonaId ?? undefined);
  teamActivityCache.set(key, { at: now, rows });
  return rows;
}

/**
 * First non-empty, non-header, non-marker line of a recap — used as the
 * compact summary when we don't have budget for the full body.
 */
function recapHeadline(result: string, maxChars: number): string {
  const lines = result.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue; // skip markdown headers
    if (line === '[DONE]') continue;
    return line.length > maxChars ? line.slice(0, maxChars) + '…' : line;
  }
  return result.slice(0, maxChars).trim();
}

/**
 * Pull a short rolling history of the persona's recent done tasks on this
 * project. Three guardrails make this bounded regardless of how many tasks
 * the persona has shipped:
 *
 *   1. Failure-shaped results are filtered out — provider 429s, error
 *      messages, etc. don't poison future prompts.
 *   2. Tasks are deduped by title — three "smoke test" reruns collapse to one.
 *   3. Total budget is a single hard cap (1500 chars). The most recent task
 *      gets a full body slice; older entries get one-line headlines only,
 *      stopping early when the budget is hit.
 */
function gatherPersonaHistory(personaId: string, projectId: string | null, currentTask: BoardTask, planPredIds: Set<string>): string {
  if (!projectId) return '';
  // Pull a wider net (10) so dedupe + filtering still leaves usable entries.
  // The cache is keyed by (persona, project); excludeTaskId is applied at
  // filter-time so plan bursts within the TTL window all share one DB read.
  const candidates = recentPersonaTasksCached(personaId, projectId)
    .filter(t => t.id !== currentTask.id)
    .filter(t => !planPredIds.has(t.id))
    .filter(t => t.result && !isLikelyFailureRecap(t.result));
  if (candidates.length === 0) return '';

  const seenTitles = new Set<string>();
  const recent: typeof candidates = [];
  for (const t of candidates) {
    const titleKey = (t.title || t.description || '').trim().toLowerCase();
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    recent.push(t);
    if (recent.length >= 5) break;
  }
  if (recent.length === 0) return '';

  const TOTAL_BUDGET = 1500;
  const FIRST_BODY_CAP = 600;
  const HEADLINE_CAP = 200;

  const header = `## Your recent work on this project\n\nYou've completed these tasks earlier on this project. Build on them — don't repeat work, and stay consistent with what you've already concluded.\n`;
  const parts: string[] = [header];
  let used = header.length;

  for (let i = 0; i < recent.length; i++) {
    const t = recent[i];
    const title = (t.title || t.description || '').slice(0, 80).trim();
    const body = (t.result || '').trim();
    let entry: string;
    if (i === 0) {
      const slice = body.length > FIRST_BODY_CAP ? body.slice(0, FIRST_BODY_CAP) + '…' : body;
      entry = `### ${title}\n${slice}\n`;
    } else {
      entry = `### ${title}\n${recapHeadline(body, HEADLINE_CAP)}\n`;
    }
    if (used + entry.length > TOTAL_BUDGET) break;
    parts.push(entry);
    used += entry.length;
  }
  return parts.join('\n').trim();
}

/**
 * Recent work other personas have shipped on this project. Same three
 * guardrails as gatherPersonaHistory (filter failures, dedupe by title,
 * one-line headlines under a total budget) — at a tighter cap because
 * cross-persona context is summary-level, not the persona's own playbook.
 */
function gatherTeamActivity(
  projectId: string | null,
  currentPersonaId: string | null,
  currentTask: BoardTask,
  planPredIds: Set<string>,
): string {
  if (!projectId) return '';
  const candidates = recentTeamActivityCached(projectId, currentPersonaId ?? null)
    .filter(t => t.id !== currentTask.id)
    .filter(t => !planPredIds.has(t.id))
    .filter(t => t.result && !isLikelyFailureRecap(t.result));
  if (candidates.length === 0) return '';

  const seenTitles = new Set<string>();
  const recent: typeof candidates = [];
  for (const t of candidates) {
    const titleKey = (t.title || t.description || '').trim().toLowerCase();
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    recent.push(t);
    if (recent.length >= 5) break;
  }
  if (recent.length === 0) return '';

  const TOTAL_BUDGET = 800;
  const HEADLINE_CAP = 150;

  const header = `## Team activity\n\nRecent work your teammates have just shipped on this project. Stay aware of it — don't duplicate, contradict, or undo their work.\n`;
  const parts: string[] = [header];
  let used = header.length;

  for (const t of recent) {
    const author = t.persona_name || t.persona_slug || 'a teammate';
    const title = (t.title || t.description || '').slice(0, 80).trim();
    const body = (t.result || '').trim();
    const entry = `### ${title} — ${author}\n${recapHeadline(body, HEADLINE_CAP)}\n`;
    if (used + entry.length > TOTAL_BUDGET) break;
    parts.push(entry);
    used += entry.length;
  }
  return parts.join('\n').trim();
}

/**
 * Build the full prompt for a task.
 *
 * `sessionResumed` skips the team-activity + persona-history blocks because
 * the persona's claude session already carries the prior conversation —
 * re-injecting summaries is duplicate context that costs ~1–4k input tokens
 * per task. Plan-dependency context is *always* included since it can
 * reference work done by OTHER personas (different sessions, different
 * memories) that the current persona has never seen.
 */
function buildTaskPromptWithContext(task: BoardTask, sessionResumed = false): string {
  const own = taskPromptFromBoardTask(task);
  const { block: depBlock, sources } = gatherDependencyContext(task);
  const planPredIds = new Set(sources.map(s => s.id));
  const personaId = task.persona_id;
  const historyBlock = sessionResumed || !personaId
    ? ''
    : gatherPersonaHistory(personaId, task.project_id, task, planPredIds);
  const teamBlock = sessionResumed
    ? ''
    : gatherTeamActivity(task.project_id, personaId, task, planPredIds);

  const sections: string[] = [];
  if (teamBlock) sections.push(teamBlock);
  if (historyBlock) sections.push(historyBlock);
  if (depBlock) sections.push(depBlock);
  if (sections.length === 0) return own;
  sections.push(`## Your task\n\n${own}`);
  return sections.join('\n\n---\n\n');
}

/** Assign a task to a persona and wake them on it. */
export async function assignTaskToPersona(
  personaId: string,
  task: BoardTask,
): Promise<{ agentId: string }> {
  const persona = getPersonaById(personaId);
  if (!persona) throw new Error(`persona ${personaId} not found`);
  updateBoardTask(task.id, { status: 'assigned', persona_id: persona.id });
  // Reflect the freshly-assigned persona in the task object so context-gathering
  // (history, deps) can find it; otherwise we'd skip the persona-history block.
  const taskWithAssignment: BoardTask = { ...task, persona_id: persona.id };
  // Session resume = claude already has the prior conversation, so we skip
  // the team-activity + persona-history blocks (saves ~1–4k tokens/task).
  // Hermes keeps full context — the blocks are how its persona stays aware
  // of teammates' work since hermes has no equivalent of --resume here.
  const sessionResumed = !!persona.claude_session_id;
  const prompt = buildTaskPromptWithContext(taskWithAssignment, sessionResumed);
  return wakePersona({
    persona,
    task: prompt,
    taskId: task.id,
  });
}

/** Stop a persona's current session without deleting the persona. */
export function sleepPersona(personaId: string): boolean {
  const persona = getPersonaById(personaId);
  if (!persona) return false;
  const agentId = persona.current_agent_id;
  if (agentId && isRunning(agentId)) {
    killAgent(agentId);
  }
  setPersonaStatus(persona.id, 'offline', { agentId: null, taskId: null });
  return true;
}

/** Reflect a finished/errored agent back onto its persona. */
export function syncPersonaFromAgent(agentId: string): void {
  const persona = getPersonaForAgent(agentId);
  if (!persona) return;
  const agent = getAgentById(agentId);
  if (!agent) {
    setPersonaStatus(persona.id, 'offline', { agentId: null, taskId: null });
    return;
  }
  const open = getOpenPendingQuestionsForAgent(agentId);
  if (open.length > 0) {
    setPersonaStatus(persona.id, 'needs_input', { agentId, taskId: persona.current_task_id });
    return;
  }
  switch (agent.status) {
    case 'running':
    case 'spawning':
      setPersonaStatus(persona.id, 'working', { agentId, taskId: persona.current_task_id });
      break;
    case 'needs_input':
      setPersonaStatus(persona.id, 'needs_input', { agentId, taskId: persona.current_task_id });
      break;
    case 'done': {
      const finishedTaskId = persona.current_task_id;
      if (finishedTaskId) {
        // Capture a recap of the agent's actual output before we cut the
        // session loose. Stored on the task so the card surfaces it.
        let recapText: string | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { extractAgentRecap } = require('./recap') as typeof import('./recap');
          const recap = extractAgentRecap(agentId);
          if (recap?.text) recapText = recap.text;
        } catch {}
        updateBoardTask(finishedTaskId, {
          status: 'done',
          ...(recapText ? { result: recapText } : {}),
        });
      }
      // Clear the persona's current_agent_id BEFORE advancing the plan. The
      // plan engine calls wakePersona for the next subtask synchronously,
      // and wakePersona only spawns a fresh agent when current_agent_id is
      // null — otherwise it falls into the resume path, reuses the same
      // worktree/branch, and never creates a per-task PR (chained subtasks
      // pile up on one branch).
      setPersonaStatus(persona.id, 'idle', { agentId: null, taskId: null });
      updatePersona(persona.id, { current_agent_id: null, current_task_id: null, last_agent_id: agentId });
      // If the task belongs to a plan, advance the plan now that the persona
      // slot is free.
      if (finishedTaskId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { getBoardTaskById } = require('./db') as typeof import('./db');
          const t = getBoardTaskById(finishedTaskId);
          if (t?.plan_id) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { onSubtaskCompleted } = require('./plans') as typeof import('./plans');
            onSubtaskCompleted(t.plan_id);
          }
        } catch {}
      }
      break;
    }
    case 'error':
    case 'killed':
      if (persona.current_task_id) {
        updateBoardTask(persona.current_task_id, { status: 'open', persona_id: null });
      }
      setPersonaStatus(persona.id, agent.status === 'error' ? 'error' : 'idle', { agentId: null, taskId: null });
      updatePersona(persona.id, { last_agent_id: agentId });
      break;
    default:
      break;
  }
}

/**
 * Default starter team — five generalist personas covering the most common
 * work a founder/operator does day-to-day. Dev-specialist personas (bug-fixer,
 * code-reviewer, etc.) are still available via the marketplace but no longer
 * seeded automatically — they made the OS feel like a coding tool.
 */
const STARTER_PACK: Array<{
  slug: string;
  name: string;
  role: string;
  color: string;
  model: string;
  skills: string[];
  system_prompt: string;
}> = [
  {
    slug: 'maya',
    name: 'Maya',
    role: 'researcher',
    color: '#6f7c98',
    model: 'sonnet',
    skills: ['research', 'web', 'comparison', 'summarize', 'fact-check'],
    system_prompt:
`You are Maya, a senior research analyst. Your job is to gather information and synthesize it into clear, sourced answers.

Approach:
1. Just answer the question. Don't ask for clarification on tasks that are clear.
2. Pull from multiple sources, prefer primary data over commentary.
3. Output a tight, structured summary: headline finding, supporting evidence, sources, open questions.
4. Flag uncertainty explicitly — never invent numbers or quotes.

Style: dense, scannable, no hype. Bulleted when bullets help; prose when they don't.`,
  },
  {
    slug: 'ren',
    name: 'Ren',
    role: 'writer',
    color: '#c08552',
    model: 'sonnet',
    skills: ['writing', 'copy', 'email', 'social', 'edit', 'rewrite'],
    system_prompt:
`You are Ren, a senior writer. You write the way the user would write — direct, specific, no filler.

Approach:
1. Just write. Make reasonable assumptions about audience and goal — don't ask first.
2. Drafts come back in the user's voice, not generic SaaS-marketing voice. No "unlock", "leverage", "supercharge", "in today's fast-paced world".
3. Tight sentences. Concrete details. One idea per paragraph.
4. Always offer one alternative phrasing for the headline / subject line / hook.

Default to short. The user can always ask you to expand.`,
  },
  {
    slug: 'theo',
    name: 'Theo',
    role: 'engineer',
    color: '#7d8c5b',
    model: 'sonnet',
    skills: ['code', 'debugging', 'refactor', 'tests', 'architecture'],
    system_prompt:
`You are Theo, a senior software engineer. You ship working code, not prototypes.

Approach:
1. Read the relevant files before changing anything.
2. Make the smallest change that solves the problem. Don't refactor adjacent code unless asked.
3. Match the existing style. If a new dependency would help, just add it (don't ask first for trivial libraries).
4. After editing, run typecheck/tests if available; report what you ran and the result.
5. Only escalate via ASK_USER for *destructive* or *irreversible* decisions (deleting data, force-pushing, etc.) — for everything else, make the call and ship.`,
  },
  {
    slug: 'iris',
    name: 'Iris',
    role: 'designer & critic',
    color: '#a85a5a',
    model: 'sonnet',
    skills: ['design', 'ui-review', 'copy-critique', 'taste', 'feedback'],
    system_prompt:
`You are Iris, a design critic. Your job is to give honest feedback on UI, copy, and visual work — the way a senior designer would in a real review.

Approach:
1. Identify the *intent* of the work first. Critique against intent, not against your taste.
2. Three things that are working, three that aren't, ranked by impact.
3. Concrete suggestions, not vague hand-waving. "Tighten the line-height to 1.4" beats "improve readability".
4. If you'd reject the work in a real review, say so directly.

No hedging. No "this is great, but…" sandwiches.`,
  },
  {
    slug: 'jules',
    name: 'Jules',
    role: 'coordinator',
    color: '#8a6fa1',
    model: 'sonnet',
    skills: ['planning', 'scheduling', 'inbox-triage', 'follow-ups', 'organize'],
    system_prompt:
`You are Jules, a chief of staff. You turn fuzzy intent into a concrete plan and keep things moving.

Approach:
1. Convert vague asks ("plan my week", "organize this project") into a numbered action list with owners and deadlines.
2. Surface the trade-offs the user hasn't seen yet.
3. When delegating to other personas, write the brief *as the user would* — specific, terse, no filler.
4. Make reasonable assumptions and proceed. Only escalate via ASK_USER for genuinely irreversible decisions.

Bias to action over deliberation.`,
  },
];

const LEGACY_DEV_SLUGS = ['bug-fixer', 'code-reviewer', 'docs-generator', 'refactor-agent', 'security-scanner', 'test-writer'];

/**
 * Seed default starter personas on first boot. Idempotent. Also one-time-cleans
 * up the legacy dev-pack personas IF they've never been activated by the user
 * (no agent runs, no last_active timestamp). If you've actually used one, it
 * stays — we never delete work-in-progress.
 */
export function seedPersonasFromConfigs(projectId: string): number {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dbMod = require('./db') as typeof import('./db');
  const { createPersona, getDb } = dbMod as typeof import('./db') & { getDb: typeof import('./db').getDb };

  // One-time cleanup: drop untouched dev-pack personas before seeding generalists.
  try {
    const db = getDb();
    const placeholders = LEGACY_DEV_SLUGS.map(() => '?').join(',');
    db.prepare(
      `DELETE FROM personas
       WHERE project_id = ?
         AND slug IN (${placeholders})
         AND current_agent_id IS NULL
         AND last_active IS NULL`,
    ).run(projectId, ...LEGACY_DEV_SLUGS);
  } catch {}

  let created = 0;
  for (const p of STARTER_PACK) {
    const id = `${projectId}:${p.slug}`;
    if (getPersonaById(id)) continue;
    try {
      createPersona({
        id,
        project_id: projectId,
        slug: p.slug,
        name: p.name,
        role: p.role,
        avatar: null,
        color: p.color,
        model: p.model,
        skills: p.skills,
        system_prompt: p.system_prompt,
        autonomy: 'manual',
      });
      created += 1;
    } catch {}
  }
  return created;
}

/**
 * One-time refresh: overwrite system_prompt for any persona whose slug matches
 * a STARTER_PACK entry. Used to push prompt-language updates to existing
 * installs without making the user re-create personas. Returns # updated.
 */
export function refreshStarterPersonaPrompts(projectId: string): number {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getDb } = require('./db') as typeof import('./db');
  const db = getDb();
  let updated = 0;
  for (const p of STARTER_PACK) {
    const r = db.prepare(
      `UPDATE personas SET system_prompt = ?, updated_at = ? WHERE project_id = ? AND slug = ?`,
    ).run(p.system_prompt, Date.now(), projectId, p.slug);
    if (r.changes > 0) updated += r.changes;
  }
  return updated;
}

/** Make the legacy dev configs importable on demand from the marketplace surface. */
export function getDevPackTemplates(): Array<{
  slug: string; name: string; role: string; skills: string[]; system_prompt: string; model?: string;
}> {
  const configs = loadAgentConfigs();
  return configs.map(cfg => ({
    slug: cfg.slug,
    name: cfg.name,
    role: cfg.description?.split('.')[0] ?? '',
    skills: inferDevPackSkills(cfg.slug),
    system_prompt: cfg.prompt,
    model: cfg.model,
  }));
}

function inferDevPackSkills(slug: string): string[] {
  const map: Record<string, string[]> = {
    'bug-fixer': ['debugging', 'fixes', 'tests'],
    'code-reviewer': ['review', 'quality', 'security'],
    'docs-generator': ['docs', 'writing', 'readme'],
    'refactor-agent': ['refactor', 'cleanup', 'architecture'],
    'security-scanner': ['security', 'audit', 'vulnerabilities'],
    'test-writer': ['tests', 'unit', 'integration'],
  };
  return map[slug] ?? [slug];
}
