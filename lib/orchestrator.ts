import * as pty from 'node-pty';
import { getAllAgents, getActiveAgentsCount, getPendingTasksCount, createAgent, getLogsForAgent, recordTokenUsage, insertPtyChunk, clearPtyChunks, getPushRequests, getPushRequest, updatePushRequest, createNotification } from '@/lib/db';
import { spawnAgent, resumeAgent } from '@/lib/spawner';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import type { AgentType } from '@/types';
import { cleanLogLine, stripAnsi } from './strip-tui';

// Fixed ID for the orchestrator — used to store PTY chunks
export const ORCHESTRATOR_ID = '__orchestrator__';

// JSON protocol for tool calling via claude --print (no API key required — uses CLI subscription)
const SYSTEM_PROMPT = `You are the Boardroom orchestrator — a senior engineering manager that coordinates a fleet of AI coding agents.

When the user gives you a task, plan ALL steps required and execute them in one shot. Do not stop halfway.

Available agent types:
- "claude": Uses Claude Code CLI — for coding, analysis, research, file operations
- "codex": Uses OpenAI Codex CLI — alternative coding agent with --full-auto mode
- "opencode": Uses OpenCode CLI — open-source coding agent
- "test": Quick shell command — for fast/simple checks

You MUST respond with ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "reply": "your message to the user",
  "actions": [
    {"tool": "spawn_agent", "input": {"task": "...", "type": "claude", "name": "short-name", "model": "sonnet", "repo": "/path/to/repo"}},
    {"tool": "resume_agent", "input": {"id": "agent-id-or-8char-prefix", "task": "new task description"}},
    {"tool": "kill_agent", "input": {"id": "agent-id-or-prefix"}},
    {"tool": "review_push_request", "input": {"id": "push-request-id", "action": "approve", "comment": "optional reason"}},
    {"tool": "create_workflow", "input": {"name": "my-workflow", "description": "what it does", "steps": [{"name": "step-1", "type": "claude", "task": "...", "model": "sonnet", "dependsOn": [], "stepType": "standard"}]}},
    {"tool": "run_workflow", "input": {"name": "existing-workflow-name"}}
  ]
}

Push Requests:
- When agents finish work on a repo, users can submit "push requests" for review
- You'll see pending push requests in the fleet context below
- Use "review_push_request" to approve (merges the branch) or reject them
- Review the summary and changed files before approving
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
- IMPORTANT: When agents work on a repo, ALWAYS include in the task description: "When done, git add all new/changed files and commit with a descriptive message." Otherwise their changes won't be committed and will be invisible to other agents or merge operations.
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
  type: 'text' | 'tool_use' | 'tool_result' | 'done' | 'error';
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

    // Escape for single-quote shell embedding
    const escapedPrompt = prompt.replace(/'/g, `'\\''`);
    const cmd = `${nvmInit} && claude --print --dangerously-skip-permissions --output-format json '${escapedPrompt}'`;

    // Use PTY so the orchestrator terminal can render live output
    const ptyProc = pty.spawn('/bin/sh', ['-c', cmd], {
      name: 'xterm-256color',
      cols: 58,
      rows: 20,
      env: { ...process.env, HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
    });

    let output = '';

    ptyProc.onData((data: string) => {
      // Store raw PTY chunks for xterm.js rendering
      insertPtyChunk(ORCHESTRATOR_ID, Buffer.from(data).toString('base64'));
      // Collect plain text for JSON parsing
      output += stripAnsi(data);
    });

    ptyProc.onExit(({ exitCode }) => {
      if (exitCode !== 0) {
        safeReject(new Error(`claude CLI exited with code ${exitCode}: ${output.slice(0, 200)}`));
        return;
      }
      try {
        // The output may contain the JSON wrapped in misc text — extract it
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

async function executeAction(action: OrchestratorAction): Promise<unknown> {
  switch (action.tool) {
    case 'spawn_agent': {
      const { task, type, name: agentName, repo, model } = action.input as {
        task: string; type: AgentType; name: string; repo?: string; model?: string;
      };
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
      await spawnAgent({ agentId: id, task, type: type || 'claude', name: agentName, repo, model });
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
          const result = mergeWorktreeBranch(agent.repo, pr.branch, pr.base_branch);
          if (!result.success) return { error: `Merge failed: ${result.message}` };
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
    default:
      return { error: `Unknown tool: ${action.tool}` };
  }
}

export async function* runOrchestrator(
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): AsyncGenerator<OrchestratorEvent> {
  // Build current fleet context
  const agents = getAllAgents();

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

  const fullPrompt = `${SYSTEM_PROMPT}

Current fleet status:
  Active agents: ${stats.active}
  Total agents: ${stats.total}
  Pending tasks: ${stats.pending_tasks}
  Pending push requests: ${stats.pending_prs}

Agent fleet (with output for finished agents):
${agentSummary}

Push requests awaiting review:
${prContext}

${recentHistory ? `Recent conversation:\n${recentHistory}\n` : ''}User: ${userMessage}`;

  let parsed: OrchestratorResponse;

  try {
    const cliResult = await runClaudeCLI(fullPrompt);

    // Record orchestrator token usage
    if (cliResult.usage) {
      recordTokenUsage({
        agent_id: null,
        source: 'orchestrator',
        input_tokens: cliResult.usage.input_tokens,
        output_tokens: cliResult.usage.output_tokens,
        cache_read_tokens: cliResult.usage.cache_read_tokens,
        cache_write_tokens: cliResult.usage.cache_write_tokens,
        cost_usd: cliResult.cost_usd || 0,
        model: cliResult.model || null,
      });
    }

    // Extract JSON — claude might wrap in markdown code blocks
    const rawOutput = cliResult.text;
    const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/) || rawOutput.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : rawOutput;
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

  // Emit the reply text
  if (parsed.reply) {
    yield { type: 'text', content: parsed.reply };
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
