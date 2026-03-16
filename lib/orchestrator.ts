import { spawn } from 'child_process';
import { getAllAgents, getActiveAgentsCount, getPendingTasksCount, createAgent, getLogsForAgent, recordTokenUsage } from '@/lib/db';
import { spawnAgent, resumeAgent } from '@/lib/spawner';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import type { AgentType } from '@/types';
import { cleanLogLine } from './strip-tui';

// JSON protocol for tool calling via claude --print (no API key required — uses CLI subscription)
const SYSTEM_PROMPT = `You are the Boardroom orchestrator — a senior engineering manager that coordinates a fleet of AI coding agents.

When the user gives you a task, plan ALL steps required and execute them in one shot. Do not stop halfway.

Available agent types:
- "claude": Uses Claude Code CLI — for coding, analysis, research, file operations
- "test": Quick shell command — for fast/simple checks

You MUST respond with ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "reply": "your message to the user",
  "actions": [
    {"tool": "spawn_agent", "input": {"task": "...", "type": "claude", "name": "short-name", "model": "sonnet"}},
    {"tool": "resume_agent", "input": {"id": "agent-id-or-8char-prefix", "task": "new task description"}},
    {"tool": "kill_agent", "input": {"id": "agent-id-or-prefix"}}
  ]
}

NOTE: Agent output is already included in the fleet context below for done/error agents (last 30 stdout lines). You do NOT need to fetch it — just read it from context and act on it directly.

Rules for actions:
- Include ALL actions required to complete the full task in one response — never do partial work
- For multi-step tasks: include every spawn/resume needed up front, agents run in parallel unless you note they're sequential
- PREFER resume_agent over spawn_agent when a done/error/killed agent has the same repo/context
- Give agents detailed, self-contained task descriptions — they have no other context beyond what you write
- "name" should be 1-3 words, kebab-case
- For coding tasks always use type "claude"
- "model" is optional: "haiku" for simple/fast tasks, "sonnet" for coding (default), "opus" for complex reasoning. Omit to use the default model.

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
  return new Promise((resolve, reject) => {
    const home = process.env.HOME || os.homedir();
    const nvmInit = `export NVM_DIR="${home}/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"`;

    // Escape for single-quote shell embedding
    const escapedPrompt = prompt.replace(/'/g, `'\\''`);
    const cmd = `${nvmInit} && claude --print --dangerously-skip-permissions --output-format json '${escapedPrompt}'`;

    const child = spawn('/bin/sh', ['-c', cmd], {
      env: { ...process.env, HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Close stdin immediately — claude hangs waiting for input otherwise
    child.stdin?.end();

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        const text = parsed.result ?? parsed.content ?? stdout;
        const usage = parsed.usage ? {
          input_tokens: parsed.usage.input_tokens || 0,
          output_tokens: parsed.usage.output_tokens || 0,
          cache_read_tokens: parsed.usage.cache_read_input_tokens || 0,
          cache_write_tokens: parsed.usage.cache_creation_input_tokens || 0,
        } : undefined;
        const model = parsed.modelUsage ? Object.keys(parsed.modelUsage)[0] : undefined;
        resolve({ text, usage, cost_usd: parsed.total_cost_usd, model });
      } catch {
        resolve({ text: stdout });
      }
    });

    child.on('error', reject);

    // 3 minute timeout — orchestrator may plan many steps
    let settled = false;
    const originalResolve = resolve;
    const originalReject = reject;
    resolve = ((val: CLIResult) => { if (!settled) { settled = true; originalResolve(val); } }) as typeof resolve;
    reject = ((err: Error) => { if (!settled) { settled = true; originalReject(err); } }) as typeof reject;

    setTimeout(() => {
      if (!settled) {
        try { child.kill('SIGKILL'); } catch {}
        reject(new Error('claude CLI timed out after 180s'));
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

  const stats = {
    active: getActiveAgentsCount(),
    pending_tasks: getPendingTasksCount(),
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

Agent fleet (with output for finished agents):
${agentSummary}

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
