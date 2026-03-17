'use client';

import { useState } from 'react';
import {
  Play, Copy, Check, ChevronDown, ChevronRight,
  Bot, Workflow, Clock, Terminal, Send,
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
        response: '{ agents: Agent[], stats: { active, pending_tasks, logs_today }, tokens }',
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
          model: { type: '"haiku" | "sonnet" | "opus"', description: 'Model to use (default: sonnet)' },
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
      },
      {
        method: 'GET',
        path: '/api/agents/:id',
        description: 'Get agent details, logs, and token usage',
        response: '{ agent, logs, hasPty, tokens }',
      },
      {
        method: 'PATCH',
        path: '/api/agents/:id',
        description: 'Resume an agent with a new task',
        body: {
          task: { type: 'string', required: true, description: 'New task for the agent' },
        },
        example: { task: 'Now refactor the tests' },
      },
      {
        method: 'DELETE',
        path: '/api/agents/:id',
        description: 'Kill an agent (add ?purge=1 to delete from DB)',
        query: { purge: { type: '0 | 1', description: 'Also delete from database' } },
      },
      {
        method: 'POST',
        path: '/api/agents/:id/message',
        description: 'Send a message to a running agent',
        body: {
          message: { type: 'string', required: true, description: 'Message to send' },
        },
        example: { message: 'Focus on the API routes first' },
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
        response: '{ workflows: [{ id, name, description, steps }] }',
      },
      {
        method: 'GET',
        path: '/api/workflows?runId=:id',
        description: 'Get run status by run ID',
        query: { runId: { type: 'string', description: 'Workflow run ID' } },
        response: '{ run: { workflowName, status, agents: [{ stepName, agentId, status }] } }',
      },
      {
        method: 'GET',
        path: '/api/workflows?runs=1',
        description: 'List all workflow runs',
        response: '{ runs: [{ runId, workflowName, status, agents }] }',
      },
      {
        method: 'POST',
        path: '/api/workflows',
        description: 'Create a new workflow',
        body: {
          name: { type: 'string', required: true, description: 'Workflow name' },
          description: { type: 'string', description: 'Description' },
          steps: { type: 'WorkflowStep[]', required: true, description: 'Array of step definitions' },
        },
        example: {
          name: 'review-and-test',
          description: 'Code review then run tests',
          steps: [
            { name: 'review', type: 'claude', model: 'sonnet', task: 'Review the PR changes', parallel: false },
            { name: 'test', type: 'claude', model: 'haiku', task: 'Run the test suite', parallel: false },
          ],
        },
      },
      {
        method: 'POST',
        path: '/api/workflows (run)',
        description: 'Execute a workflow (spawns agents for each step)',
        body: {
          action: { type: '"run"', required: true, description: 'Must be "run"' },
          name: { type: 'string', description: 'Workflow name' },
          steps: { type: 'WorkflowStep[]', required: true, description: 'Steps to execute' },
          repo: { type: 'string', description: 'Repository path' },
        },
        example: {
          action: 'run',
          name: 'deploy-pipeline',
          steps: [
            { name: 'lint', type: 'claude', model: 'haiku', task: 'Run linting', parallel: false },
            { name: 'test', type: 'claude', model: 'haiku', task: 'Run tests', parallel: true },
            { name: 'deploy', type: 'claude', model: 'sonnet', task: 'Deploy to production', parallel: false },
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
        },
      },
      {
        method: 'DELETE',
        path: '/api/workflows',
        description: 'Delete a workflow',
        body: {
          id: { type: 'string', required: true, description: 'Workflow ID to delete' },
        },
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
        example: {
          name: 'nightly-tests',
          schedule: '0 2 * * *',
          task: 'Run the full test suite and report failures',
          agent_type: 'claude',
          model: 'haiku',
        },
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
      },
      {
        method: 'POST',
        path: '/api/cron (run)',
        description: 'Manually trigger a cron job',
        body: {
          action: { type: '"run"', required: true, description: 'Must be "run"' },
          id: { type: 'string', required: true, description: 'Job ID' },
        },
        example: { action: 'run', id: 'abc123' },
      },
      {
        method: 'PUT',
        path: '/api/cron',
        description: 'Update a cron job',
        body: {
          id: { type: 'string', required: true, description: 'Job ID' },
        },
      },
      {
        method: 'DELETE',
        path: '/api/cron',
        description: 'Delete a cron job',
        body: {
          id: { type: 'string', required: true, description: 'Job ID' },
        },
      },
    ],
  },
  {
    name: 'orchestrator',
    icon: <Terminal className="w-4 h-4" />,
    base: '/api/chat',
    endpoints: [
      {
        method: 'POST',
        path: '/api/chat',
        description: 'Send a message to the orchestrator (SSE stream)',
        body: {
          message: { type: 'string', required: true, description: 'Message to send' },
          history: { type: 'Message[]', description: 'Conversation history' },
        },
        example: { message: 'Spawn 3 agents to review the codebase', history: [] },
        response: 'SSE stream with text/event-stream content type',
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
      const opts: RequestInit = { method: ep.method.replace('PATCH', 'PATCH') };
      if (bodyInput && ['POST', 'PUT', 'PATCH'].includes(ep.method)) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = bodyInput;
      }
      const res = await fetch(cleanPath, opts);
      const text = await res.text();
      try {
        setResponse(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResponse(text);
      }
    } catch (err) {
      setResponse(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-zinc-800/60 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-900/50 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-zinc-600" /> : <ChevronRight className="w-3 h-3 text-zinc-600" />}
        <Badge variant="outline" className={`text-[10px] font-mono w-14 justify-center ${METHOD_COLORS[ep.method]}`}>
          {ep.method}
        </Badge>
        <code className="text-xs font-mono text-zinc-300 flex-1 text-left">{ep.path}</code>
        <span className="text-[11px] font-mono text-zinc-600 text-right">{ep.description}</span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800/40 px-4 py-3 bg-zinc-950/30 space-y-3">
          {/* Body params */}
          {ep.body && (
            <div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">body parameters</span>
              <div className="mt-1.5 space-y-1">
                {Object.entries(ep.body).map(([key, val]) => (
                  <div key={key} className="flex items-start gap-2 text-xs">
                    <code className="font-mono text-zinc-200 min-w-[100px]">{key}</code>
                    <Badge variant="outline" className="text-[9px] font-mono shrink-0">{val.type}</Badge>
                    {val.required && <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/25 shrink-0">required</Badge>}
                    <span className="text-zinc-500 font-mono">{val.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Response */}
          {ep.response && (
            <div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">response</span>
              <code className="block mt-1 text-[11px] font-mono text-zinc-400 bg-zinc-900/50 px-2.5 py-1.5 rounded">{ep.response}</code>
            </div>
          )}

          {/* Curl */}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">curl</span>
              <CopyButton text={curlCmd} />
            </div>
            <pre className="mt-1 text-[11px] font-mono text-zinc-400 bg-zinc-900/50 px-2.5 py-2 rounded overflow-x-auto whitespace-pre-wrap">{curlCmd}</pre>
          </div>

          {/* Try it */}
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
                    <div className="absolute top-1.5 right-1.5">
                      <CopyButton text={response} />
                    </div>
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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-sm text-zinc-100">api reference</h1>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-[11px] font-mono text-zinc-500">
            {API_GROUPS.reduce((sum, g) => sum + g.endpoints.length, 0)} endpoints
          </span>
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
                  <Badge variant="outline" className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border-emerald-500/25 shrink-0 mt-0.5">spawn agent</Badge>
                  <pre className="text-[11px] font-mono text-zinc-400 overflow-x-auto">curl -X POST {baseUrl}/api/agents -H &quot;Content-Type: application/json&quot; -d &apos;{`{"task":"Fix the login bug","type":"claude"}`}&apos;</pre>
                </div>
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-[9px] font-mono bg-blue-500/10 text-blue-400 border-blue-500/25 shrink-0 mt-0.5">run workflow</Badge>
                  <pre className="text-[11px] font-mono text-zinc-400 overflow-x-auto">curl -X POST {baseUrl}/api/workflows -H &quot;Content-Type: application/json&quot; -d &apos;{`{"action":"run","name":"test","steps":[{"name":"lint","type":"claude","task":"Run linting"}]}`}&apos;</pre>
                </div>
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-[9px] font-mono bg-amber-500/10 text-amber-400 border-amber-500/25 shrink-0 mt-0.5">create cron</Badge>
                  <pre className="text-[11px] font-mono text-zinc-400 overflow-x-auto">curl -X POST {baseUrl}/api/cron -H &quot;Content-Type: application/json&quot; -d &apos;{`{"name":"nightly","schedule":"0 2 * * *","task":"Run tests"}`}&apos;</pre>
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
