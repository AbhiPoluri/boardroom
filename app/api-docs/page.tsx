'use client';

import { useState } from 'react';
import {
  Play, Copy, Check, ChevronDown, ChevronRight,
  Bot, Workflow, Clock, Terminal, Send, GitBranch,
  Database, Bell, Radio, Shield, Settings, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';

interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  description: string;
  body?: Record<string, { type: string; required?: boolean; description: string }>;
  query?: Record<string, { type: string; description: string }>;
  example?: Record<string, unknown>;
  response?: string;
}

interface EndpointGroup {
  name: string;
  icon: React.ReactNode;
  base: string;
  endpoints: Endpoint[];
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  POST: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  PUT: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  DELETE: 'bg-red-500/15 text-red-400 border-red-500/25',
  PATCH: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
};

const API_GROUPS: EndpointGroup[] = [
  {
    name: 'agents',
    icon: <Bot className="w-4 h-4" />,
    base: '/api/agents',
    endpoints: [
      {
        method: 'GET',
        path: '/api/agents',
        description: 'List all agents with stats and token usage',
        response: '{ agents: Agent[], stats: { active, pending_tasks, logs_today }, tokens: Record<agentId, TokenUsage> }',
      },
      {
        method: 'POST',
        path: '/api/agents',
        description: 'Spawn a new agent',
        body: {
          task: { type: 'string', required: true, description: 'Task for the agent to execute' },
          type: { type: '"claude" | "codex" | "custom" | "test"', description: 'Agent type (default: claude)' },
          name: { type: 'string', description: 'Agent name (auto-generated if omitted)' },
          repo: { type: 'string', description: 'Repository path to work in' },
          useGitIsolation: { type: 'boolean', description: 'Create git worktree branch (default: false)' },
          model: { type: '"haiku" | "sonnet" | "opus"', description: 'Model to use (default: sonnet)' },
          depends_on: { type: 'string[]', description: 'Agent IDs this agent depends on' },
        },
        example: { task: 'Fix the login bug in auth.ts', type: 'claude', model: 'sonnet' },
        response: '{ agent: { id, name, type, status, task, repo, created_at } }',
      },
      {
        method: 'PUT',
        path: '/api/agents',
        description: 'Import an existing directory as an agent',
        body: {
          path: { type: 'string', required: true, description: 'Path to the directory to import' },
          name: { type: 'string', description: 'Agent name' },
          task: { type: 'string', description: 'Task to run (spawns agent if provided)' },
          type: { type: 'string', description: 'Agent type' },
          model: { type: 'string', description: 'Model to use' },
        },
        example: { path: '/Users/me/my-project', task: 'Review the codebase', name: 'reviewer' },
        response: '{ agent: { id, name, type, status, task, repo, worktree_path, gitBranch }, imported: true }',
      },
      {
        method: 'GET',
        path: '/api/agents/:id',
        description: 'Get agent details, logs, and token usage',
        response: '{ agent: Agent, logs: Log[], hasPty: boolean, tokens: TokenUsage }',
      },
      {
        method: 'PATCH',
        path: '/api/agents/:id',
        description: 'Resume an agent with a new task',
        body: {
          task: { type: 'string', required: true, description: 'New task for the agent' },
        },
        example: { task: 'Now refactor the tests' },
        response: '{ ok: true, pid: number }',
      },
      {
        method: 'DELETE',
        path: '/api/agents/:id',
        description: 'Kill an agent (add ?purge=1 to delete from DB)',
        query: { purge: { type: '0 | 1', description: 'Also delete from database' } },
        response: '{ ok: true }',
      },
      {
        method: 'POST',
        path: '/api/agents/:id/message',
        description: 'Send a message to a running agent\'s stdin/PTY',
        body: {
          message: { type: 'string', required: true, description: 'Message to send' },
        },
        example: { message: 'Focus on the API routes first' },
        response: '{ ok: true }',
      },
    ],
  },
  {
    name: 'git',
    icon: <GitBranch className="w-4 h-4" />,
    base: '/api/agents/:id/git',
    endpoints: [
      {
        method: 'GET',
        path: '/api/agents/:id/git',
        description: 'Get git info for an agent (branch, commits, changed files)',
        query: { diff: { type: '0 | 1', description: 'Include full diff output' } },
        response: '{ git: { isGit, branch, baseBranch, aheadBy, changedFiles, recentCommits }, diff? }',
      },
      {
        method: 'POST',
        path: '/api/agents/:id/git',
        description: 'Perform git operations (merge, cherry-pick, patch)',
        body: {
          action: { type: '"merge" | "cherry-pick" | "patch"', required: true, description: 'Git action to perform' },
          baseBranch: { type: 'string', description: 'Target branch (default: main)' },
          commits: { type: 'string[]', description: 'Commit hashes for cherry-pick' },
        },
        example: { action: 'merge', baseBranch: 'main' },
        response: '{ success: true, message: "Merged branch..." }',
      },
      {
        method: 'GET',
        path: '/api/branches',
        description: 'List all agent branches with git info',
        query: {
          agentId: { type: 'string', description: 'Filter to one agent' },
          diff: { type: '0 | 1', description: 'Include diffs' },
        },
        response: '{ branches: [{ agentId, agentName, agentStatus, repo, worktreePath, branch, aheadBy, changedFiles }] }',
      },
      {
        method: 'GET',
        path: '/api/push-requests',
        description: 'List push requests (merge proposals from agents)',
        query: {
          status: { type: '"pending" | "approved" | "rejected"', description: 'Filter by status' },
          id: { type: 'string', description: 'Get single PR by ID' },
          count: { type: '1', description: 'Return count only' },
          diff: { type: '1', description: 'Include diff with single PR' },
        },
        response: '{ requests: PushRequest[] } | { count: number }',
      },
      {
        method: 'POST',
        path: '/api/push-requests',
        description: 'Create a push request from an agent\'s worktree',
        body: {
          agent_id: { type: 'string', required: true, description: 'Agent ID' },
          summary: { type: 'string', description: 'PR summary' },
        },
        example: { agent_id: 'abc-123', summary: 'Fixed login bug and added tests' },
        response: '{ id, status: "pending", branch, baseBranch }',
      },
      {
        method: 'PATCH',
        path: '/api/push-requests',
        description: 'Approve or reject a push request',
        body: {
          id: { type: 'string', required: true, description: 'Push request ID' },
          action: { type: '"approve" | "reject"', required: true, description: 'Action to take' },
          comment: { type: 'string', description: 'Reviewer comment' },
        },
        example: { id: 'pr-123', action: 'approve', comment: 'LGTM' },
        response: '{ id, status: "approved" | "rejected" }',
      },
    ],
  },
  {
    name: 'workflows',
    icon: <Workflow className="w-4 h-4" />,
    base: '/api/workflows',
    endpoints: [
      {
        method: 'GET',
        path: '/api/workflows',
        description: 'List all saved workflows',
        response: '{ workflows: [{ id, name, description, steps, schedule, cron_enabled, layout }] }',
      },
      {
        method: 'GET',
        path: '/api/workflows?runs=1',
        description: 'List all active workflow runs',
        query: { runs: { type: '1', description: 'List runs instead of definitions' } },
        response: '{ runs: [{ runId, workflowName, status, agents: [{ stepName, agentId, status }] }] }',
      },
      {
        method: 'GET',
        path: '/api/workflows?runId=:id',
        description: 'Get status of a specific workflow run',
        query: { runId: { type: 'string', description: 'Workflow run ID' } },
        response: '{ run: { workflowName, status, agents } }',
      },
      {
        method: 'POST',
        path: '/api/workflows',
        description: 'Create a new workflow',
        body: {
          name: { type: 'string', required: true, description: 'Workflow name' },
          description: { type: 'string', description: 'Description' },
          steps: { type: 'WorkflowStep[]', required: true, description: 'Steps with name, type, task, dependsOn, position' },
          schedule: { type: 'string', description: 'Cron expression for scheduled runs' },
          cron_enabled: { type: 'boolean', description: 'Enable/disable scheduled execution' },
        },
        example: {
          name: 'review-and-test',
          steps: [
            { name: 'review', type: 'claude', model: 'sonnet', task: 'Review the PR', parallel: false },
            { name: 'test', type: 'claude', model: 'haiku', task: 'Run tests', dependsOn: ['review'] },
          ],
        },
        response: '{ workflow: { id, name, description, steps, schedule } }',
      },
      {
        method: 'POST',
        path: '/api/workflows (run)',
        description: 'Execute a workflow — spawns agents for each step',
        body: {
          action: { type: '"run"', required: true, description: 'Must be "run"' },
          name: { type: 'string', description: 'Workflow name' },
          steps: { type: 'WorkflowStep[]', required: true, description: 'Steps to execute' },
          repo: { type: 'string', description: 'Repository path for all agents' },
        },
        example: {
          action: 'run',
          name: 'deploy',
          steps: [
            { name: 'lint', type: 'claude', model: 'haiku', task: 'Run linting', parallel: false },
            { name: 'deploy', type: 'claude', model: 'sonnet', task: 'Deploy to prod', parallel: false },
          ],
        },
        response: '{ ok: true, runId, agents: [{ stepName, agentId, status }] }',
      },
      {
        method: 'PUT',
        path: '/api/workflows',
        description: 'Update an existing workflow',
        body: {
          id: { type: 'string', required: true, description: 'Workflow ID' },
          name: { type: 'string', required: true, description: 'Workflow name' },
          description: { type: 'string', description: 'Description' },
          steps: { type: 'WorkflowStep[]', required: true, description: 'Updated steps' },
          schedule: { type: 'string', description: 'Cron expression' },
          cron_enabled: { type: 'boolean', description: 'Enable/disable schedule' },
        },
        response: '{ workflow: { id, name, description, steps } }',
      },
      {
        method: 'DELETE',
        path: '/api/workflows',
        description: 'Delete a workflow',
        body: { id: { type: 'string', required: true, description: 'Workflow ID to delete' } },
        response: '{ ok: true }',
      },
      {
        method: 'GET',
        path: '/api/workflows/history',
        description: 'Get workflow run history',
        response: '{ runs: [{ id, workflow_id, status, started_at, finished_at, agent_ids, error }] }',
      },
    ],
  },
  {
    name: 'cron',
    icon: <Clock className="w-4 h-4" />,
    base: '/api/cron',
    endpoints: [
      {
        method: 'GET',
        path: '/api/cron',
        description: 'List all cron jobs',
        response: '{ jobs: CronJob[] }',
      },
      {
        method: 'POST',
        path: '/api/cron',
        description: 'Create a new cron job',
        body: {
          name: { type: 'string', required: true, description: 'Job name' },
          schedule: { type: 'string', required: true, description: 'Cron expression (e.g. "*/5 * * * *")' },
          task: { type: 'string', required: true, description: 'Task for the agent to execute each run' },
          agent_type: { type: 'string', description: 'Agent type (default: claude)' },
          model: { type: 'string', description: 'Model to use' },
          repo: { type: 'string', description: 'Repository path' },
        },
        example: { name: 'nightly-tests', schedule: '0 2 * * *', task: 'Run the full test suite', model: 'haiku' },
        response: '{ job: CronJob }',
      },
      {
        method: 'POST',
        path: '/api/cron (toggle)',
        description: 'Toggle a cron job on/off',
        body: {
          action: { type: '"toggle"', required: true, description: 'Must be "toggle"' },
          id: { type: 'string', required: true, description: 'Job ID' },
        },
        example: { action: 'toggle', id: 'abc123' },
        response: '{ job: CronJob }',
      },
      {
        method: 'POST',
        path: '/api/cron (run)',
        description: 'Manually trigger a cron job immediately',
        body: {
          action: { type: '"run"', required: true, description: 'Must be "run"' },
          id: { type: 'string', required: true, description: 'Job ID' },
        },
        example: { action: 'run', id: 'abc123' },
        response: '{ agent: Agent }',
      },
      {
        method: 'PUT',
        path: '/api/cron',
        description: 'Update a cron job',
        body: { id: { type: 'string', required: true, description: 'Job ID' } },
        response: '{ job: CronJob }',
      },
      {
        method: 'DELETE',
        path: '/api/cron',
        description: 'Delete a cron job',
        body: { id: { type: 'string', required: true, description: 'Job ID' } },
        response: '{ ok: true }',
      },
    ],
  },
  {
    name: 'data',
    icon: <Database className="w-4 h-4" />,
    base: '/api/tasks, /api/memory, /api/search, /api/summaries, /api/tokens',
    endpoints: [
      {
        method: 'GET',
        path: '/api/tasks',
        description: 'List all tasks',
        response: '{ tasks: [{ id, description, status, agent_id, created_at, result }] }',
      },
      {
        method: 'POST',
        path: '/api/tasks',
        description: 'Create a new task',
        body: {
          description: { type: 'string', required: true, description: 'Task description' },
        },
        example: { description: 'Review the auth module' },
        response: '{ task: { id, description, status: "pending", agent_id: null, created_at, result: null } }',
      },
      {
        method: 'GET',
        path: '/api/memory',
        description: 'Get stored memory entries',
        query: {
          key: { type: 'string', description: 'Get specific key' },
          category: { type: 'string', description: 'Filter by category' },
        },
        response: '{ key, value } | { memories: Memory[] } | { preferences, outcomes, context }',
      },
      {
        method: 'POST',
        path: '/api/memory',
        description: 'Store a memory entry',
        body: {
          key: { type: 'string', required: true, description: 'Memory key' },
          value: { type: 'any', required: true, description: 'Value to store' },
          category: { type: 'string', description: 'Category (default: general)' },
        },
        example: { key: 'deploy-target', value: 'staging', category: 'preferences' },
        response: '{ ok: true }',
      },
      {
        method: 'DELETE',
        path: '/api/memory',
        description: 'Delete a memory entry',
        body: { key: { type: 'string', required: true, description: 'Memory key to delete' } },
        response: '{ ok: true }',
      },
      {
        method: 'GET',
        path: '/api/search',
        description: 'Full-text search across all agent logs',
        query: {
          q: { type: 'string', description: 'Search query (min 2 chars)' },
          limit: { type: 'number', description: 'Max results (default: 100)' },
        },
        response: '{ results: LogEntry[], query: string }',
      },
      {
        method: 'GET',
        path: '/api/summaries',
        description: 'Get AI-generated summaries for all completed agents',
        response: '{ summaries: [{ agent_id, summary, files_changed, commits, created_at }] }',
      },
      {
        method: 'GET',
        path: '/api/tokens',
        description: 'Token usage analytics with cost and cache stats',
        query: { since: { type: 'number', description: 'Filter from timestamp' } },
        response: '{ session, agents, modelBreakdown, cache: { read_tokens, write_tokens, hit_rate, savings_usd }, velocity }',
      },
    ],
  },
  {
    name: 'skills',
    icon: <Settings className="w-4 h-4" />,
    base: '/api/agent-configs',
    endpoints: [
      {
        method: 'GET',
        path: '/api/agent-configs',
        description: 'List all saved skills (agent configurations)',
        response: '{ configs: [{ slug, name, type, model, description, prompt }] }',
      },
      {
        method: 'GET',
        path: '/api/agent-configs?slug=:slug',
        description: 'Get a single skill by slug',
        query: { slug: { type: 'string', description: 'Skill slug (filename without .md)' } },
        response: '{ config: { slug, name, type, model, description, prompt } }',
      },
      {
        method: 'GET',
        path: '/api/agent-configs?export=:slug',
        description: 'Download a skill as a raw .md file',
        query: { export: { type: 'string', description: 'Skill slug to export' } },
        response: 'text/markdown file download (agents/slug.md)',
      },
      {
        method: 'POST',
        path: '/api/agent-configs',
        description: 'Create or update a skill',
        body: {
          name: { type: 'string', required: true, description: 'Skill name' },
          prompt: { type: 'string', required: true, description: 'Default task/prompt' },
          type: { type: 'string', description: 'Agent type (default: claude)' },
          model: { type: 'string', description: 'Model override' },
          description: { type: 'string', description: 'What this skill does' },
        },
        example: { name: 'code-reviewer', prompt: 'Review the PR for quality issues', type: 'claude', model: 'sonnet', description: 'Reviews PRs for bugs and style' },
        response: '{ config: { slug, name, type, model, description, prompt } }',
      },
      {
        method: 'POST',
        path: '/api/agent-configs (duplicate)',
        description: 'Duplicate an existing skill',
        body: {
          action: { type: '"duplicate"', required: true, description: 'Must be "duplicate"' },
          slug: { type: 'string', required: true, description: 'Slug of skill to clone' },
        },
        example: { action: 'duplicate', slug: 'code-reviewer' },
        response: '{ config: { slug: "code-reviewer-copy", name, type, model, description, prompt } }',
      },
      {
        method: 'DELETE',
        path: '/api/agent-configs',
        description: 'Delete a skill',
        body: { slug: { type: 'string', required: true, description: 'Skill slug to delete' } },
        response: '{ ok: true }',
      },
    ],
  },
  {
    name: 'system',
    icon: <Shield className="w-4 h-4" />,
    base: '/api/notifications, /api/reset',
    endpoints: [
      {
        method: 'GET',
        path: '/api/notifications',
        description: 'List notifications',
        query: { unread: { type: '1', description: 'Filter to unread only' } },
        response: '{ notifications: Notification[], unread: number }',
      },
      {
        method: 'POST',
        path: '/api/notifications',
        description: 'Mark notifications as read',
        body: {
          action: { type: '"read" | "read_all"', required: true, description: 'Mark one or all as read' },
          id: { type: 'string', description: 'Notification ID (required for "read")' },
        },
        example: { action: 'read_all' },
        response: '{ notifications: Notification[], unread: number }',
      },
      {
        method: 'GET',
        path: '/api/orchestrator-logs',
        description: 'Get orchestrator chat logs',
        query: {
          stats: { type: 'any', description: 'Return stats summary' },
          limit: { type: 'number', description: 'Max entries (default: 200)' },
          since: { type: 'number', description: 'Filter from timestamp' },
        },
        response: '{ logs: LogEntry[] }',
      },
      {
        method: 'POST',
        path: '/api/reset',
        description: 'Full system reset — kills all agents, clears all data',
        response: '{ success: true }',
      },
    ],
  },
  {
    name: 'bus',
    icon: <Radio className="w-4 h-4" />,
    base: '/api/bus',
    endpoints: [
      {
        method: 'GET',
        path: '/api/bus',
        description: 'List channels or get messages from a channel',
        query: {
          channel: { type: 'string', description: 'Channel name (omit to list all channels)' },
          since: { type: 'number', description: 'Messages after this unix timestamp' },
        },
        response: '{ channels: string[] } | { messages: BusMessage[] }',
      },
      {
        method: 'POST',
        path: '/api/bus',
        description: 'Publish a message to the message bus',
        body: {
          from: { type: 'string', required: true, description: 'Sender identifier' },
          channel: { type: 'string', required: true, description: 'Channel name' },
          content: { type: 'string | object', required: true, description: 'Message content' },
          to: { type: 'string', description: 'Target recipient (optional)' },
        },
        example: { from: 'deploy-agent', channel: 'deploys', content: 'Staging deploy complete' },
        response: '{ ok: true }',
      },
    ],
  },
  {
    name: 'streaming',
    icon: <Zap className="w-4 h-4" />,
    base: '/api/stream',
    endpoints: [
      {
        method: 'GET',
        path: '/api/stream/:id',
        description: 'SSE stream of agent logs (real-time)',
        response: 'text/event-stream — events: { type: "initial", logs } | { type: "log", log } | { type: "status", status }',
      },
      {
        method: 'GET',
        path: '/api/stream/pty/:id',
        description: 'SSE stream of raw PTY output (for terminal rendering)',
        query: { after: { type: 'number', description: 'Resume from chunk ID' } },
        response: 'text/event-stream — events: { type: "initial", chunks } | { type: "chunks", chunks }',
      },
      {
        method: 'POST',
        path: '/api/chat',
        description: 'Send a message to the orchestrator (SSE stream)',
        body: {
          message: { type: 'string', required: true, description: 'Message to send' },
          history: { type: 'Message[]', description: 'Conversation history' },
        },
        example: { message: 'Spawn 3 agents to review the codebase', history: [] },
        response: 'text/event-stream',
      },
    ],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1 rounded text-zinc-600 hover:text-zinc-400 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function EndpointCard({ ep, baseUrl }: { ep: Endpoint; baseUrl: string }) {
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [bodyInput, setBodyInput] = useState(ep.example ? JSON.stringify(ep.example, null, 2) : '');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const cleanPath = ep.path.replace(/ \(.*\)$/, '');
  const curlBody = ep.example ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(ep.example)}'` : '';
  const curlCmd = `curl -X ${ep.method} ${baseUrl}${cleanPath}${curlBody}`;

  const runTest = async () => {
    setLoading(true);
    setResponse('');
    try {
      const opts: RequestInit = { method: ep.method };
      if (bodyInput && ['POST', 'PUT', 'PATCH'].includes(ep.method)) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = bodyInput;
      }
      const res = await fetch(cleanPath, opts);
      const text = await res.text();
      try { setResponse(JSON.stringify(JSON.parse(text), null, 2)); }
      catch { setResponse(text); }
    } catch (err) {
      setResponse(`Error: ${err}`);
    } finally { setLoading(false); }
  };

  return (
    <div className="border border-zinc-800/60 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-900/50 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-zinc-600 shrink-0" /> : <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />}
        <Badge variant="outline" className={`text-[10px] font-mono w-14 justify-center shrink-0 ${METHOD_COLORS[ep.method]}`}>
          {ep.method}
        </Badge>
        <code className="text-xs font-mono text-zinc-300 shrink-0">{ep.path}</code>
        <span className="text-[11px] font-mono text-zinc-600 text-right flex-1 truncate">{ep.description}</span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800/40 px-4 py-3 bg-zinc-950/30 space-y-3">
          {ep.body && (
            <div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">body</span>
              <div className="mt-1.5 space-y-1">
                {Object.entries(ep.body).map(([key, val]) => (
                  <div key={key} className="flex items-start gap-2 text-xs">
                    <code className="font-mono text-zinc-200 min-w-[120px]">{key}</code>
                    <Badge variant="outline" className="text-[9px] font-mono shrink-0">{val.type}</Badge>
                    {val.required && <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/25 shrink-0">required</Badge>}
                    <span className="text-zinc-500 font-mono">{val.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ep.query && (
            <div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">query params</span>
              <div className="mt-1.5 space-y-1">
                {Object.entries(ep.query).map(([key, val]) => (
                  <div key={key} className="flex items-start gap-2 text-xs">
                    <code className="font-mono text-zinc-200 min-w-[120px]">{key}</code>
                    <Badge variant="outline" className="text-[9px] font-mono shrink-0">{val.type}</Badge>
                    <span className="text-zinc-500 font-mono">{val.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ep.response && (
            <div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">response</span>
              <code className="block mt-1 text-[11px] font-mono text-zinc-400 bg-zinc-900/50 px-2.5 py-1.5 rounded break-all">{ep.response}</code>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">curl</span>
              <CopyButton text={curlCmd} />
            </div>
            <pre className="mt-1 text-[11px] font-mono text-zinc-400 bg-zinc-900/50 px-2.5 py-2 rounded overflow-x-auto whitespace-pre-wrap">{curlCmd}</pre>
          </div>

          <Separator className="bg-zinc-800/50" />
          <div>
            <button
              onClick={() => setTesting(!testing)}
              className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 hover:text-zinc-300 uppercase tracking-wider"
            >
              <Send className="w-3 h-3" />
              {testing ? 'hide' : 'try it'}
            </button>
            {testing && (
              <div className="mt-2 space-y-2">
                {['POST', 'PUT', 'PATCH'].includes(ep.method) && (
                  <Textarea
                    value={bodyInput}
                    onChange={(e) => setBodyInput(e.target.value)}
                    placeholder="Request body (JSON)"
                    className="font-mono text-[11px] bg-zinc-900/50 border-zinc-800 text-zinc-300 min-h-[80px]"
                  />
                )}
                <div className="flex items-center gap-2">
                  <Button onClick={runTest} disabled={loading} size="sm" className="text-[11px] font-mono h-7 px-3 bg-blue-600 hover:bg-blue-500">
                    <Play className="w-3 h-3 mr-1" /> {loading ? 'sending...' : 'send'}
                  </Button>
                </div>
                {response && (
                  <div className="relative">
                    <div className="absolute top-1.5 right-1.5"><CopyButton text={response} /></div>
                    <pre className="text-[11px] font-mono text-emerald-300/80 bg-zinc-900/50 px-3 py-2 rounded max-h-[300px] overflow-auto whitespace-pre-wrap">{response}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:7391');
  const [expandedGroup, setExpandedGroup] = useState<string | null>('agents');

  const totalEndpoints = API_GROUPS.reduce((sum, g) => sum + g.endpoints.length, 0);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-sm text-zinc-100">api reference</h1>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-[11px] font-mono text-zinc-500">{totalEndpoints} endpoints</span>
          <span className="text-[11px] font-mono text-zinc-600">{API_GROUPS.length} groups</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-zinc-600">base url</span>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="font-mono text-xs h-7 w-56 bg-zinc-950/50 border-zinc-800 text-zinc-300"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Quick start */}
          <Card className="bg-zinc-900/40 border-zinc-800">
            <CardContent className="py-3 px-4">
              <h2 className="text-xs font-mono text-zinc-400 mb-2">quick start</h2>
              <div className="space-y-1.5">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border-emerald-500/25 shrink-0 mt-0.5">spawn</Badge>
                  <pre className="text-[11px] font-mono text-zinc-400 overflow-x-auto">curl -X POST {baseUrl}/api/agents -H &quot;Content-Type: application/json&quot; -d &apos;{`{"task":"Fix the login bug","type":"claude"}`}&apos;</pre>
                </div>
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-[9px] font-mono bg-blue-500/10 text-blue-400 border-blue-500/25 shrink-0 mt-0.5">workflow</Badge>
                  <pre className="text-[11px] font-mono text-zinc-400 overflow-x-auto">curl -X POST {baseUrl}/api/workflows -H &quot;Content-Type: application/json&quot; -d &apos;{`{"action":"run","name":"test","steps":[{"name":"lint","type":"claude","task":"Run linting"}]}`}&apos;</pre>
                </div>
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-[9px] font-mono bg-amber-500/10 text-amber-400 border-amber-500/25 shrink-0 mt-0.5">cron</Badge>
                  <pre className="text-[11px] font-mono text-zinc-400 overflow-x-auto">curl -X POST {baseUrl}/api/cron -H &quot;Content-Type: application/json&quot; -d &apos;{`{"name":"nightly","schedule":"0 2 * * *","task":"Run tests"}`}&apos;</pre>
                </div>
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-[9px] font-mono bg-purple-500/10 text-purple-400 border-purple-500/25 shrink-0 mt-0.5">search</Badge>
                  <pre className="text-[11px] font-mono text-zinc-400 overflow-x-auto">curl {baseUrl}/api/search?q=error&amp;limit=50</pre>
                </div>
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-[9px] font-mono bg-red-500/10 text-red-400 border-red-500/25 shrink-0 mt-0.5">kill</Badge>
                  <pre className="text-[11px] font-mono text-zinc-400 overflow-x-auto">curl -X DELETE {baseUrl}/api/agents/AGENT_ID</pre>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Endpoint groups */}
          {API_GROUPS.map((group) => (
            <div key={group.name}>
              <button
                onClick={() => setExpandedGroup(expandedGroup === group.name ? null : group.name)}
                className="flex items-center gap-2 mb-2 group"
              >
                {expandedGroup === group.name ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                <span className="text-zinc-500">{group.icon}</span>
                <span className="font-mono text-sm text-zinc-200">{group.name}</span>
                <Badge variant="outline" className="text-[9px] font-mono">{group.endpoints.length}</Badge>
                <code className="text-[10px] font-mono text-zinc-600 ml-1">{group.base}</code>
              </button>

              {expandedGroup === group.name && (
                <div className="space-y-1.5 ml-5">
                  {group.endpoints.map((ep, i) => (
                    <EndpointCard key={i} ep={ep} baseUrl={baseUrl} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
