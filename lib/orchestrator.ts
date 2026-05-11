import * as pty from 'node-pty';
import { getAllAgents, getActiveAgentsCount, getPendingTasksCount, createAgent, getLogsForAgent, recordTokenUsage, insertPtyChunk, clearPtyChunks, getPushRequests, getPushRequest, updatePushRequest, createNotification, getActiveProject, getPersonas, getPersonaById, getPersonaBySlug, createBoardTask, getBoardTasks, createPlan } from '@/lib/db';
import { wakePersona } from '@/lib/personas';
import { startPlan } from '@/lib/plans';
import { spawnAgent, resumeAgent } from '@/lib/spawner';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import type { AgentType } from '@/types';
import { cleanLogLine, stripAnsi } from './strip-tui';

// Fixed ID for the orchestrator — used to store PTY chunks
export const ORCHESTRATOR_ID = '__orchestrator__';

// JSON protocol for tool calling via claude --print (no API key required — uses CLI subscription)
const SYSTEM_PROMPT = `You are the Boardroom orchestrator — a senior engineering manager that coordinates a team of personas (named workers with skills + a runtime) via the task board.

When the user gives you a task, plan ALL steps required and execute them in one shot. Do not stop halfway.

How work happens in Boardroom:
- Every project has a set of **personas** (claude / hermes / codex / opencode runtime, each with skills + a system prompt). You'll see the current project's roster in context below.
- Work flows through the **task board**. You create tasks, assigning them either directly to a persona or leaving them OPEN for the auto-pickup dispatcher to match by skills.
- When a persona starts work, the spawner brings up its CLI in an isolated git worktree. When the agent finishes it auto-commits + opens a push request the user reviews via /review.

Preferred tools (use these for normal work):
- "create_task" — drops ONE task on the board's OPEN column. ALWAYS lands in OPEN, never directly in_progress. The optional persona_id is just a routing hint — the task is visible to the user, and the dispatcher will route it to that persona on the next tick if they're auto+ready. Use this for single-step work.
- "create_plan" — for ANY multi-step request (more than one task, or work that spans multiple personas). Create a plan with ordered subtasks; the plan stages them off-board until the user starts it from /planning. Pick execution_mode: "sequential" when subtasks must run in order (auto_merge=true accumulates file edits across steps), "parallel" when independent.
- "wake_persona" — only when the user explicitly says "wake X now" or "have Maya do this immediately". Skips the OPEN column and goes straight to working. Avoid by default; let tasks flow through the board.

Lower-level tools (escape hatches — only use if no persona fits, or for the legacy fleet):
- "spawn_agent": spawn a loose claude/codex/opencode agent OUTSIDE the persona system. Avoid unless the user specifically asks for a one-off.
- "resume_agent" / "kill_agent": manage existing loose agents.
- "review_push_request" / "create_workflow" / "run_workflow" / "swarm_agents": legacy paths kept for compatibility.

You MUST respond with ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "reply": "your message to the user",
  "actions": [
    {"tool": "create_task", "input": {"title": "...", "description": "...", "persona_id": "maya", "required_skills": ["research"], "priority": 0}},
    {"tool": "create_plan", "input": {"title": "...", "description": "...", "execution_mode": "sequential", "auto_merge": true, "subtasks": [{"title": "step 1", "description": "...", "persona_id": "maya"}, {"title": "step 2", "description": "...", "persona_id": "theo"}]}},
    {"tool": "wake_persona", "input": {"persona_id": "iris", "task": "..."}},
    {"tool": "spawn_agent", "input": {"task": "...", "type": "claude", "name": "short-name", "model": "sonnet", "repo": "/path/to/repo"}},
    {"tool": "resume_agent", "input": {"id": "agent-id-or-8char-prefix", "task": "new task description"}},
    {"tool": "kill_agent", "input": {"id": "agent-id-or-prefix"}},
    {"tool": "review_push_request", "input": {"id": "push-request-id", "action": "approve", "comment": "optional reason"}},
    {"tool": "create_workflow", "input": {"name": "my-workflow", "description": "what it does", "steps": [{"name": "step-1", "type": "claude", "task": "...", "model": "sonnet", "dependsOn": [], "stepType": "standard"}]}},
    {"tool": "run_workflow", "input": {"name": "existing-workflow-name"}},
    {"tool": "swarm_agents", "input": {"task": "overall goal", "agents": [{"name": "...", "subtask": "..."}, ...], "repo": "/path"}}
  ]
}

Persona selection:
- persona_id can be the full id, a project-qualified slug ("proj:maya"), or just the bare slug ("maya") — bare slugs resolve against the active project.
- Match the persona to the task: research/web/summarize work → researcher persona; coding/refactoring → engineer/implementer; copy/writing → writer; design/critique → critic.
- Personas with autonomy=auto pick up open tasks matching their skills automatically — so for skill-tagged tasks you can leave persona_id empty and just create_task with required_skills.

Push Requests:
- When agents finish work on a repo, they auto-create push requests for review
- You'll see pending push requests in the fleet context below
- Do NOT auto-approve push requests — let the user review and approve them via the UI
- Only use "review_push_request" when the user explicitly asks you to approve or reject a specific PR
- action must be "approve" or "reject"

NOTE: Agent output is already included in the fleet context below for done/error agents (last 30 stdout lines). You do NOT need to fetch it — just read it from context and act on it directly.

Rules for actions:
- Include ALL actions required to complete the full task in one response — never do partial work
- For multi-step tasks: include every spawn/resume needed up front, agents run in parallel unless you note they're sequential
- PREFER resume_agent over spawn_agent when a done/error/killed agent has the same repo/context
- Give agents detailed, self-contained task descriptions — they have no other context beyond what you write
- "name" should be 1-3 words, kebab-case
- For coding tasks always use type "claude"
- "model" is optional: "haiku" for simple/fast tasks, "sonnet" for coding (default), "opus" for complex reasoning. Omit to use the default model.
- "repo" is optional: absolute path to a git repo. When set, the agent gets its own git worktree (branch) of that repo. Use this for any task that involves reading or modifying code in a specific repo. Each agent gets an isolated branch so they can work in parallel without conflicts.
- Use swarm_agents for large tasks that can be parallelized across 3-5 agents. Each agent gets an isolated git branch. Example: refactoring a large codebase — one agent per module.
- IMPORTANT: When agents work on a repo, ALWAYS include in the task description: "When done, git add all new/changed files and commit with a descriptive message. Then submit a push request so changes can be reviewed and merged."
- When spawning a follow-up agent that needs files from multiple prior agents' branches, include instructions like: "First merge branch boardroom/AGENT_ID into your branch using: git merge boardroom/AGENT_ID" so it can access all the work.

Workflows:
- Use "create_workflow" to define reusable multi-step pipelines that can be saved and re-run
- Each step has: name, type (claude/test), task, model (optional), dependsOn (list of step names), stepType (standard/evaluator/router)
- stepType "evaluator": evaluates its dependency's output — retries if FAIL/NEEDS CHANGES (set maxRetries, default 3)
- stepType "router": classifies input and routes to one of its "routes" (list of step names) — skips unselected routes
- Output from completed steps is automatically injected as context into dependent steps
- Use "run_workflow" to execute an already-saved workflow by name
- Workflows run in ~/boardroom-sandbox by default

Rules for reply:
- Be specific and detailed: explain exactly what you're doing and why
- Name each agent being spawned/resumed and what it will do
- If you're spawning multiple agents, explain how they divide the work
- If you're not spawning any agents, explain your reasoning clearly
- Narrate the full plan — don't be vague or terse
- Example good reply: "Spawning two agents in parallel: research-agent will map out the existing auth flow and document how JWT tokens are issued, while db-agent will audit the user table schema and flag any columns that could store session data. Once both finish, resume them with the next steps."
- Example bad reply: "OK, spawning agents." (too vague)`;

export interface OrchestratorEvent {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'done' | 'error';
  content?: string;
  tool?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

interface CLIResult {
  text: string;
  usage?: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number };
  cost_usd?: number;
  model?: string;
}

export async function runClaudeCLI(prompt: string): Promise<CLIResult> {
  // Clear old PTY chunks so the terminal starts fresh
  clearPtyChunks(ORCHESTRATOR_ID);

  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (val: CLIResult) => { if (!settled) { settled = true; resolve(val); } };
    const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err); } };

    const home = process.env.HOME || os.homedir();
    const nvmInit = `export NVM_DIR="${home}/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"`;

    // Write prompt to temp file to avoid shell argument length limits
    const fs = require('fs');
    const path = require('path');
    const tmpFile = path.join(os.tmpdir(), `boardroom-prompt-${crypto.randomUUID()}.txt`);
    fs.writeFileSync(tmpFile, prompt);
    const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch {} };
    const cmd = `${nvmInit} && cat '${tmpFile}' | claude --print --dangerously-skip-permissions --model sonnet --output-format json -`;

    // Use PTY so the orchestrator terminal can render live output
    const ptyProc = pty.spawn('/bin/sh', ['-c', cmd], {
      name: 'xterm-256color',
      cols: 120,
      rows: 20,
      env: { ...process.env, HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor', CLAUDE_CODE_ENTRYPOINT: '', CLAUDECODE: '' } as Record<string, string>,
    });

    let output = '';

    ptyProc.onData((data: string) => {
      insertPtyChunk(ORCHESTRATOR_ID, Buffer.from(data).toString('base64'));
      output += stripAnsi(data);
    });

    ptyProc.onExit(({ exitCode }) => {
      cleanup();
      if (exitCode !== 0) {
        safeReject(new Error(`claude CLI exited with code ${exitCode}: ${output.slice(0, 200)}`));
        return;
      }
      try {
        const jsonMatch = output.match(/(\{[\s\S]*\})/);
        const jsonStr = jsonMatch ? jsonMatch[1] : output;
        const parsed = JSON.parse(jsonStr.trim());
        const text = parsed.result ?? parsed.content ?? output;
        const usage = parsed.usage ? {
          input_tokens: parsed.usage.input_tokens || 0,
          output_tokens: parsed.usage.output_tokens || 0,
          cache_read_tokens: parsed.usage.cache_read_input_tokens || 0,
          cache_write_tokens: parsed.usage.cache_creation_input_tokens || 0,
        } : undefined;
        const model = parsed.modelUsage ? Object.keys(parsed.modelUsage)[0] : undefined;
        safeResolve({ text, usage, cost_usd: parsed.total_cost_usd, model });
      } catch {
        safeResolve({ text: output });
      }
    });

    // 3 minute timeout
    setTimeout(() => {
      if (!settled) {
        cleanup();
        try { ptyProc.kill(); } catch {}
        safeReject(new Error('claude CLI timed out after 180s'));
      }
    }, 180000);
  });
}

interface OrchestratorAction {
  tool: string;
  input: Record<string, unknown>;
}

interface OrchestratorResponse {
  reply: string;
  actions: OrchestratorAction[];
}

/** Resolve a repo path — tries the exact path first, then common locations */
function resolveRepoPath(repoPath: string): string | undefined {
  const fs = require('fs');
  const path = require('path');
  const home = os.homedir();

  // Try exact path first
  if (fs.existsSync(repoPath) && fs.existsSync(path.join(repoPath, '.git'))) return repoPath;

  // Extract the repo name from the path (last segment)
  const repoName = path.basename(repoPath);

  // Try common locations
  const candidates = [
    path.join(home, repoName),
    path.join(home, 'repos', repoName),
    path.join(home, 'projects', repoName),
    path.join(home, 'code', repoName),
    path.join(home, 'dev', repoName),
    path.join(home, 'Documents', repoName),
    path.join(home, 'Desktop', repoName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

async function executeAction(action: OrchestratorAction): Promise<unknown> {
  switch (action.tool) {
    case 'spawn_agent': {
      const { task, type, name: agentName, model } = action.input as {
        task: string; type: AgentType; name: string; repo?: string; model?: string;
      };
      let repo = (action.input as { repo?: string }).repo;

      // Validate and resolve repo path
      if (repo) {
        repo = resolveRepoPath(repo);
        if (!repo) {
          return { error: `Repo not found. Tried the path and common locations (~/, ~/repos/, ~/projects/, ~/code/). Make sure the repo exists and provide the full absolute path.` };
        }
      }

      const id = uuidv4();
      const now = Date.now();
      // Create agent record first (spawner expects it to exist in DB)
      createAgent({
        id,
        name: agentName,
        type: type || 'claude',
        status: 'spawning',
        task,
        repo: repo || null,
        worktree_path: null,
        pid: null,
        port: null,
        created_at: now,
      });
      await spawnAgent({ agentId: id, task, type: type || 'claude', name: agentName, repo, model, useGitIsolation: !!repo });
      return { id, status: 'spawning', message: `Agent "${agentName}" (${id.slice(0, 8)}) spawned${model ? ` with model ${model}` : ''}` };
    }
    case 'resume_agent': {
      const { id, task } = action.input as { id: string; task: string };
      const agents = getAllAgents();
      const agent = agents.find(a => a.id === id || a.id.startsWith(id));
      if (!agent) return { error: `Agent ${id} not found` };
      const { pid } = await resumeAgent(agent.id, task);
      return { id: agent.id.slice(0, 8), status: 'resumed', pid };
    }
    case 'kill_agent': {
      const { id } = action.input as { id: string };
      const agents = getAllAgents();
      const agent = agents.find(a => a.id === id || a.id.startsWith(id));
      if (!agent) return { error: `Agent ${id} not found` };
      if (agent.pid) {
        try { process.kill(agent.pid, 'SIGTERM'); } catch {}
      }
      const { updateAgentStatus } = await import('@/lib/db');
      updateAgentStatus(agent.id, 'killed');
      return { id: agent.id.slice(0, 8), status: 'killed' };
    }
    case 'review_push_request': {
      const { id, action: prAction, comment } = action.input as { id: string; action: 'approve' | 'reject'; comment?: string };
      const pr = getPushRequest(id);
      if (!pr) return { error: `Push request ${id} not found` };
      if (pr.status !== 'pending') return { error: `Already ${pr.status}` };
      if (prAction === 'approve') {
        const { getAgentById } = await import('@/lib/db');
        const agent = getAgentById(pr.agent_id);
        if (agent?.repo) {
          const { mergeWorktreeBranch } = await import('@/lib/worktree');
          const result = mergeWorktreeBranch(agent.repo, pr.branch, pr.base_branch, agent.id);
          if (!result.success) {
            if (result.needsAgent && result.conflictFiles) {
              const { spawnConflictResolver } = await import('@/lib/conflict-resolver');
              const conflictList = result.conflictFiles.join(', ');
              const { shortId } = await spawnConflictResolver({
                pr: { id: pr.id, agent_id: pr.agent_id, branch: pr.branch, base_branch: pr.base_branch },
                repo: agent.repo,
                conflictFiles: result.conflictFiles,
              });
              return { id, status: 'conflict', message: `Merge conflict in ${conflictList}. Spawned merge-resolver agent (${shortId}) to resolve automatically.`, resolver: shortId };
            }
            return { error: `Merge failed: ${result.message}` };
          }
        }
        updatePushRequest(id, 'approved', comment);
        createNotification('push_approved', `Push approved: ${pr.agent_name}`, comment || `${pr.branch} → ${pr.base_branch}`, pr.agent_id);
        return { id, status: 'approved', message: `Merged ${pr.branch} into ${pr.base_branch}` };
      } else {
        updatePushRequest(id, 'rejected', comment);
        createNotification('push_rejected', `Push rejected: ${pr.agent_name}`, comment || 'No reason', pr.agent_id);
        return { id, status: 'rejected' };
      }
    }
    case 'create_workflow': {
      const { name, description, steps, schedule, cron_enabled } = action.input as {
        name: string; description?: string; steps: any[]; schedule?: string; cron_enabled?: boolean;
      };
      const { saveWorkflow } = await import('@/lib/db');
      const id = uuidv4();
      // Auto-assign positions if not provided
      const stepsWithPos = steps.map((s: any, i: number) => ({
        ...s,
        position: s.position || { x: 80 + i * 300, y: 150 },
      }));
      saveWorkflow(id, name, description || '', stepsWithPos, {
        schedule: schedule || null,
        cronEnabled: cron_enabled ? 1 : 0,
        layout: null,
      });
      return { id, name, steps: stepsWithPos.length, message: `Workflow "${name}" created with ${stepsWithPos.length} steps` };
    }
    case 'run_workflow': {
      const { name } = action.input as { name: string };
      const { getAllWorkflows } = await import('@/lib/db');
      const workflows = getAllWorkflows();
      const wf = (workflows as any[]).find((w: any) => w.name === name);
      if (!wf) return { error: `Workflow "${name}" not found` };
      let steps: any[];
      try { steps = JSON.parse(wf.steps_json); } catch { return { error: 'Failed to parse workflow steps' }; }
      const { runWorkflow } = await import('@/lib/workflow-runner');
      const result = await runWorkflow(name, steps);
      return { runId: result.runId, agents: result.agents.length, message: `Workflow "${name}" started (run ${result.runId})` };
    }
    case 'swarm_agents': {
      const { task, agents: agentDefs, model } = action.input as {
        task: string;
        agents: Array<{ name: string; subtask: string }>;
        repo?: string;
        model?: string;
      };
      let repo = (action.input as { repo?: string }).repo;
      if (repo) {
        repo = resolveRepoPath(repo);
        if (!repo) return { error: 'Repo not found. Provide the full absolute path.' };
      }
      const ids: Array<{ name: string; id: string }> = [];
      for (const def of agentDefs) {
        const id = uuidv4();
        const now = Date.now();
        const swarmTask = `[SWARM: ${task}] Your subtask: ${def.subtask}. Coordinate with other agents working on the same goal.`;
        createAgent({
          id,
          name: def.name,
          type: 'claude',
          status: 'spawning',
          task: swarmTask,
          repo: repo || null,
          worktree_path: null,
          pid: null,
          port: null,
          created_at: now,
        });
        await spawnAgent({ agentId: id, task: swarmTask, type: 'claude', name: def.name, repo, model: (model as string | undefined) || 'sonnet', useGitIsolation: !!repo });
        ids.push({ name: def.name, id: id.slice(0, 8) });
      }
      return { agents: ids, message: `Swarm of ${ids.length} agents spawned` };
    }
    // ── Task-board flow (preferred): create_task drops a card on the board.
    // If persona_id is given the task is pre-assigned; otherwise it lands in
    // OPEN and the auto-dispatcher picks it up for any matching persona.
    case 'create_task': {
      const inp = action.input as {
        title: string;
        description?: string;
        persona_id?: string | null;
        required_skills?: string[] | null;
        priority?: number;
      };
      const project = getActiveProject();
      if (!project) return { error: 'No active project — pick one in the workspace switcher first.' };
      if (!inp.title) return { error: 'title is required' };
      // Resolve persona by id, by "project:slug", or by bare slug.
      let personaId: string | null = null;
      if (inp.persona_id) {
        const direct = getPersonaById(inp.persona_id);
        if (direct) personaId = direct.id;
        else {
          const slug = inp.persona_id.includes(':') ? inp.persona_id.split(':').pop()! : inp.persona_id;
          const byslug = getPersonaBySlug(slug, project.id);
          if (!byslug) return { error: `No persona "${inp.persona_id}" in project "${project.name}"` };
          personaId = byslug.id;
        }
      }
      const taskId = uuidv4();
      // Always land in OPEN. persona_id is a "preferred assignee" hint —
      // the task is visible on the board immediately. The dispatcher will
      // route it to that persona on the next tick if they're auto+ready,
      // or the user can manually wake them. This avoids the prior behavior
      // where pre-assigned tasks jumped straight into IN_PROGRESS, hiding
      // the orchestrator's planning from the user.
      createBoardTask({
        id: taskId,
        title: inp.title,
        description: inp.description ?? inp.title,
        status: 'open',
        project_id: project.id,
        persona_id: personaId,
        required_skills: inp.required_skills ?? null,
        priority: inp.priority ?? 0,
      });
      return {
        task_id: taskId.slice(0, 8),
        status: 'open',
        assignee: personaId ? personaId.split(':').pop() : null,
        message: personaId
          ? `Task placed in OPEN, tagged for the suggested persona — dispatcher will route it on the next tick if they're auto+ready.`
          : `Task placed in OPEN — dispatcher will pick it up for any persona whose skills match.`,
      };
    }
    // ── Plan: a structured multi-step workflow. Subtasks land on the board
    // in DRAFT until the user (or the plan engine) starts the plan. Use this
    // for any multi-persona / multi-step request — NOT a string of
    // independent create_tasks. Returns the plan id; the user starts it from
    // /planning or via PATCH /api/plans/<id> {action:'start'}.
    case 'create_plan': {
      const inp = action.input as {
        title: string;
        description?: string;
        execution_mode?: 'parallel' | 'sequential';
        auto_merge?: boolean;
        subtasks: Array<{
          title: string;
          description?: string;
          persona_id?: string;
          required_skills?: string[];
        }>;
      };
      const project = getActiveProject();
      if (!project) return { error: 'No active project — pick one in the workspace switcher first.' };
      if (!inp.title) return { error: 'title is required' };
      if (!Array.isArray(inp.subtasks) || inp.subtasks.length === 0) {
        return { error: 'subtasks must be a non-empty array' };
      }
      // Resolve persona slugs/ids against this project.
      const resolved: Array<{ title: string; description?: string; persona_id: string | null; required_skills: string[] | null }> = [];
      for (const s of inp.subtasks) {
        if (!s.title) return { error: 'every subtask needs a title' };
        let personaId: string | null = null;
        if (s.persona_id) {
          const direct = getPersonaById(s.persona_id);
          if (direct) personaId = direct.id;
          else {
            const slug = s.persona_id.includes(':') ? s.persona_id.split(':').pop()! : s.persona_id;
            const p = getPersonaBySlug(slug, project.id);
            if (!p) return { error: `subtask "${s.title}": no persona "${s.persona_id}" in project "${project.name}"` };
            personaId = p.id;
          }
        }
        resolved.push({
          title: s.title,
          description: s.description,
          persona_id: personaId,
          required_skills: s.required_skills ?? null,
        });
      }
      const planId = uuidv4();
      createPlan({
        id: planId,
        title: inp.title,
        description: inp.description ?? null,
        project_id: project.id,
        execution_mode: inp.execution_mode === 'sequential' ? 'sequential' : 'parallel',
        auto_merge: !!inp.auto_merge,
      });
      // Subtasks land as 'staged' so they don't litter the board until the
      // plan is explicitly started.
      let step = 0;
      for (const s of resolved) {
        createBoardTask({
          id: uuidv4(),
          title: s.title,
          description: s.description ?? s.title,
          status: 'staged',
          project_id: project.id,
          persona_id: s.persona_id,
          required_skills: s.required_skills,
          plan_id: planId,
          step_order: step++,
        });
      }
      // Auto-start the plan: subtasks move staged → open per execution_mode
      // (first one for sequential; all dep-free ones for parallel). Without
      // this, the plan sits in `draft` forever and the user wonders why
      // nothing is happening.
      let opened = 0;
      try {
        const res = startPlan(planId);
        opened = res.opened;
      } catch (err) {
        return { error: `Plan created but failed to start: ${err instanceof Error ? err.message : String(err)}` };
      }
      return {
        plan_id: planId.slice(0, 8),
        subtasks: resolved.length,
        opened,
        execution_mode: inp.execution_mode ?? 'parallel',
        message: `Plan started: ${opened} of ${resolved.length} subtask(s) opened on the board. The rest are staged until their predecessors finish.`,
      };
    }
    // ── Direct shortcut: wake a specific persona with a task right now.
    // Bypasses the auto-pickup tick.
    case 'wake_persona': {
      const inp = action.input as { persona_id: string; task: string };
      const project = getActiveProject();
      if (!project) return { error: 'No active project — pick one in the workspace switcher first.' };
      if (!inp.persona_id || !inp.task) return { error: 'persona_id and task are both required' };
      const direct = getPersonaById(inp.persona_id);
      let persona = direct;
      if (!persona) {
        const slug = inp.persona_id.includes(':') ? inp.persona_id.split(':').pop()! : inp.persona_id;
        persona = getPersonaBySlug(slug, project.id);
      }
      if (!persona) return { error: `No persona "${inp.persona_id}" in project "${project.name}"` };
      const { agentId } = await wakePersona({
        persona,
        task: inp.task,
      });
      return {
        persona: persona.name,
        agent_id: agentId.slice(0, 8),
        message: `${persona.name} is now working on the task.`,
      };
    }
    default:
      return { error: `Unknown tool: ${action.tool}` };
  }
}

export async function* runOrchestrator(
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): AsyncGenerator<OrchestratorEvent> {
  // Scope fleet context to the user's active project. Without this, the
  // orchestrator would pull recent agents from every project on the box —
  // e.g. when working on "nba-parlay" it could see "launch test" agents and
  // confidently claim personas from the wrong project belong here.
  const activeProject = getActiveProject();
  const activeProjectId = activeProject?.id;
  const agents = getAllAgents(200, activeProjectId);

  // Project personas — the named long-lived workers (claude/hermes/codex/
  // opencode) actually available to this orchestrator. The orchestrator needs
  // these in context to answer "who's on the team?" and to pick the right
  // persona when spawning sub-tasks.
  const personas = activeProjectId ? getPersonas(activeProjectId) : [];
  const personaSummary = personas.length === 0
    ? '(none — install a starter pack via /marketplace or create one in /personas)'
    : personas.map(p => {
        const skills: string[] = (() => {
          try { return JSON.parse(p.skills_json ?? '[]'); } catch { return []; }
        })();
        const runtime = (p.agent_type ?? 'claude');
        const status = p.status || 'idle';
        const autonomy = p.autonomy ?? 'manual';
        const role = p.role ? ` — ${p.role}` : '';
        const skillsStr = skills.length ? ` · skills: ${skills.slice(0, 6).join(', ')}` : '';
        return `  - ${p.name} (${runtime}, ${autonomy}, ${status})${role}${skillsStr}`;
      }).join('\n');

  const agentSummary = agents.length === 0
    ? 'No agents.'
    : agents.slice(-12).map(a => {
        const base = `  - ${a.name} (${a.id.slice(0, 8)}) [${a.status}]: ${a.task?.slice(0, 60)}${a.worktree_path ? ' [has worktree]' : ''}`;
        // For finished agents, inline their stdout output so orchestrator can read results
        if (a.status === 'done' || a.status === 'error') {
          const logs = getLogsForAgent(a.id, 500);
          const stdout = logs
            .filter(l => l.stream === 'stdout')
            .slice(-30)
            .map(l => {
              const clean = cleanLogLine(l.content);
              return clean ? `    | ${clean}` : null;
            })
            .filter(Boolean)
            .join('\n');
          return stdout ? `${base}\n    [output]:\n${stdout}` : base;
        }
        return base;
      }).join('\n');

  // Include pending push requests in context
  const pendingPRs = getPushRequests('pending');
  const prContext = pendingPRs.length === 0
    ? 'No pending push requests.'
    : pendingPRs.map((pr: any) => {
        const files = JSON.parse(pr.changed_files_json || '[]');
        return `  - PR #${pr.id.slice(0, 6)} from ${pr.agent_name}: ${pr.branch} → ${pr.base_branch} (${files.length} files) — "${pr.summary}"`;
      }).join('\n');

  const stats = {
    active: getActiveAgentsCount(),
    pending_tasks: getPendingTasksCount(),
    pending_prs: pendingPRs.length,
    total: agents.length,
  };

  // Last 8 turns of conversation context
  const recentHistory = history.slice(-8).map(h =>
    `${h.role === 'user' ? 'User' : 'Orchestrator'}: ${h.content}`
  ).join('\n');

  const projectHeader = activeProject
    ? `Active project: ${activeProject.name}${activeProject.repo ? ` (${activeProject.repo})` : ''}`
    : 'Active project: (none selected — use the workspace switcher)';

  // Show what's on the board right now so the orchestrator can avoid
  // duplicating tasks and can pick up loose threads.
  const boardTasks = activeProjectId ? getBoardTasks(activeProjectId) : [];
  const openLines = boardTasks.filter(t => t.status === 'open').slice(0, 8);
  const wipLines = boardTasks.filter(t => t.status === 'in_progress' || t.status === 'assigned').slice(0, 8);
  const formatTask = (t: typeof boardTasks[number]) =>
    `  - [${t.status}] ${t.title.slice(0, 70)}${t.persona_name ? ` · ${t.persona_name}` : ''}`;
  const boardSummary = boardTasks.length === 0
    ? '(empty)'
    : [
        openLines.length ? 'OPEN:\n' + openLines.map(formatTask).join('\n') : '',
        wipLines.length ? 'IN PROGRESS / ASSIGNED:\n' + wipLines.map(formatTask).join('\n') : '',
      ].filter(Boolean).join('\n');

  const fullPrompt = `${SYSTEM_PROMPT}

${projectHeader}

Personas on this project (named workers you can wake or spawn):
${personaSummary}

Task board (open + in-progress for this project):
${boardSummary}

Current fleet status:
  Active agents: ${stats.active}
  Total agents: ${stats.total}
  Pending tasks: ${stats.pending_tasks}
  Pending push requests: ${stats.pending_prs}

Agent fleet for this project (with output for finished agents):
${agentSummary}

Push requests awaiting review:
${prContext}

${recentHistory ? `Recent conversation:\n${recentHistory}\n` : ''}User: ${userMessage}`;

  let parsed: OrchestratorResponse;

  // Run CLI — yield periodic thinking pulses so the UI knows we're alive
  let cliDone = false;
  let cliResult: CLIResult | null = null;
  let cliError: Error | null = null;

  const cliPromise = runClaudeCLI(fullPrompt)
    .then(result => { cliResult = result; cliDone = true; })
    .catch(err => { cliError = err instanceof Error ? err : new Error(String(err)); cliDone = true; });

  // Yield thinking pulses every 2s so the UI shows progress
  let elapsed = 0;
  while (!cliDone) {
    await new Promise(r => setTimeout(r, 2000));
    elapsed += 2;
    if (!cliDone) {
      yield { type: 'thinking' as const, content: `thinking... ${elapsed}s` };
    }
  }

  if (cliError) throw cliError;
  if (!cliResult) throw new Error('CLI returned no result');

  try {
    const cli = cliResult as CLIResult;

    // Record orchestrator token usage
    if (cli.usage) {
      recordTokenUsage({
        agent_id: null,
        source: 'orchestrator',
        input_tokens: cli.usage.input_tokens,
        output_tokens: cli.usage.output_tokens,
        cache_read_tokens: cli.usage.cache_read_tokens,
        cache_write_tokens: cli.usage.cache_write_tokens,
        cost_usd: cli.cost_usd || 0,
        model: cli.model || null,
      });
    }

    // Extract JSON — claude might wrap in markdown code blocks or return raw
    let rawOutput = cli.text;

    // Strip markdown code blocks if present
    const codeBlockMatch = rawOutput.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) rawOutput = codeBlockMatch[1];

    // Find the outermost JSON object
    const firstBrace = rawOutput.indexOf('{');
    const lastBrace = rawOutput.lastIndexOf('}');
    const jsonStr = firstBrace >= 0 && lastBrace > firstBrace
      ? rawOutput.slice(firstBrace, lastBrace + 1)
      : rawOutput;

    try {
      parsed = JSON.parse(jsonStr.trim());
    } catch {
      // Claude responded with plain text instead of JSON — treat as reply with no actions
      parsed = { reply: rawOutput.trim(), actions: [] };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Orchestrator error';
    yield { type: 'error', error: msg };
    return;
  }

  // Emit the reply text — guard against double-wrapped JSON
  if (parsed.reply) {
    let reply = parsed.reply;
    // If reply is itself a JSON string, extract the inner reply
    if (typeof reply === 'string' && reply.trim().startsWith('{') && reply.includes('"reply"')) {
      try {
        const inner = JSON.parse(reply.trim());
        if (inner.reply) { reply = inner.reply; parsed.actions = inner.actions || parsed.actions; }
      } catch {}
    }
    yield { type: 'text', content: reply };
  }

  // Execute actions
  if (Array.isArray(parsed.actions)) {
    for (const action of parsed.actions) {
      yield { type: 'tool_use', tool: action.tool, input: action.input };
      const result = await executeAction(action);
      yield { type: 'tool_result', tool: action.tool, result };
    }
  }

  yield { type: 'done' };
}
