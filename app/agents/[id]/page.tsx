'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogViewer } from '@/components/LogViewer';
import { PtyTerminal } from '@/components/PtyTerminal';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GitPanel } from '@/components/GitPanel';
import type { Agent, Log } from '@/types';

interface AgentPageProps {
  params: Promise<{ id: string }>;
}

export default function AgentPage({ params }: AgentPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [initialLogs, setInitialLogs] = useState<Log[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msgFeedback, setMsgFeedback] = useState('');
  const [hasPty, setHasPty] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(true);
  const [tokens, setTokens] = useState<{ input_tokens: number; output_tokens: number; cost_usd: number } | null>(null);
  const [agentSummary, setAgentSummary] = useState<string | null>(null);

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError('Agent not found');
          return;
        }
        throw new Error('Failed to fetch');
      }
      const data = await res.json();
      setAgent(data.agent);
      setHasPty(data.hasPty || false);
      if (initialLogs.length === 0) {
        setInitialLogs(data.logs || []);
      }
      if (data.tokens) setTokens(data.tokens);
      setError('');
    } catch {
      setError('Failed to load agent');
    } finally {
      setLoading(false);
    }
  }, [id, initialLogs.length]);

  // Fetch summary when agent is done/error and has no logs
  useEffect(() => {
    if (!agent) return;
    const isTerminal = ['done', 'error', 'killed'].includes(agent.status);
    if (!isTerminal || initialLogs.length > 0 || agentSummary !== null) return;
    fetch(`/api/summaries`)
      .then(r => r.json())
      .then(data => {
        const match = (data.summaries || []).find((s: { agent_id: string; summary?: string }) => s.agent_id === id);
        if (match?.summary) setAgentSummary(match.summary);
        else setAgentSummary('');
      })
      .catch(() => setAgentSummary(''));
  }, [agent, id, initialLogs.length, agentSummary]);

  useEffect(() => {
    fetchAgent();
    // Poll agent status every 3s
    const interval = setInterval(() => {
      fetch(`/api/agents/${id}`)
        .then(r => r.json())
        .then(data => {
          if (data.agent) setAgent(data.agent);
          if (data.hasPty) setHasPty(true);
          if (data.tokens) setTokens(data.tokens);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [id, fetchAgent]);

  const handleKill = async () => {
    if (!confirm('Kill this agent?')) return;
    try {
      await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      await fetchAgent();
    } catch {
      setError('Failed to kill agent');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setSending(true);
    setMsgFeedback('');

    try {
      const res = await fetch(`/api/agents/${id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');

      setMessage('');
      setMsgFeedback(data.delivered ? 'sent to agent stdin' : 'logged (agent not running)');
      setTimeout(() => setMsgFeedback(''), 3000);
    } catch (err) {
      setMsgFeedback(`error: ${err instanceof Error ? err.message : 'failed to send'}`);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-zinc-600 font-mono text-sm animate-pulse">loading...</div>
      </div>
    );
  }

  if (error && !agent) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 font-mono text-sm mb-4">{error}</div>
          <Link href="/">
            <Button variant="ghost" className="font-mono text-zinc-400 hover:text-zinc-100">
              back to dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!agent) return null;

  const isActive = ['running', 'spawning'].includes(agent.status);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto pl-20 pr-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-zinc-600 hover:text-zinc-400 font-mono text-sm transition-colors">
              ← boardroom
            </Link>
            <span className="text-zinc-700">/</span>
            <span className="font-mono text-sm text-zinc-300">{agent.name}</span>
            <StatusBadge status={agent.status} />
          </div>
          <div className="flex gap-2">
            <Link href={`/agents/${id}/replay`}>
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-xs border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                replay
              </Button>
            </Link>
            {agent.repo && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  localStorage.setItem('boardroom:workspace-repo', agent.repo!);
                  router.push('/workspace');
                }}
                className="font-mono text-xs border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                open in workspace
              </Button>
            )}
            {isActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleKill}
                className="font-mono text-xs border-red-900 text-red-400 hover:bg-red-950 hover:text-red-300"
              >
                kill agent
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Agent info — collapsible */}
      <div className="border-b border-zinc-800 bg-zinc-900/30">
        <button
          onClick={() => setInfoExpanded(e => !e)}
          className="w-full max-w-7xl mx-auto px-6 py-2.5 flex items-center justify-between text-left hover:bg-zinc-800/20 transition-colors"
        >
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
            <span className={`transition-transform ${infoExpanded ? 'rotate-90' : ''}`}>▶</span>
            <span className="uppercase tracking-wider">Task</span>
            {!infoExpanded && (
              <span className="text-zinc-600 truncate max-w-md">— {agent.task}</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-zinc-600">
            <span>{agent.type}</span>
            <span>pid {agent.pid || '—'}</span>
          </div>
        </button>
        {infoExpanded && (
          <div className="max-w-7xl mx-auto px-6 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs font-mono mb-3">
              <div>
                <div className="text-zinc-600 mb-0.5 uppercase tracking-wider">Type</div>
                <div className="text-zinc-300">{agent.type}</div>
              </div>
              <div>
                <div className="text-zinc-600 mb-0.5 uppercase tracking-wider">PID</div>
                <div className="text-zinc-300">{agent.pid || '—'}</div>
              </div>
              <div>
                <div className="text-zinc-600 mb-0.5 uppercase tracking-wider">Worktree</div>
                <div className="text-zinc-300 truncate max-w-xs" title={agent.worktree_path || '—'}>
                  {agent.worktree_path ? agent.worktree_path.replace(/^\/Users\/[^/]+/, '~') : '—'}
                </div>
              </div>
              <div>
                <div className="text-zinc-600 mb-0.5 uppercase tracking-wider">Started</div>
                <div className="text-zinc-300">{new Date(agent.created_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-zinc-600 mb-0.5 uppercase tracking-wider">Tokens</div>
                {tokens && (tokens.input_tokens > 0 || tokens.output_tokens > 0) ? (
                  <div className="text-blue-400">
                    {(tokens.input_tokens + tokens.output_tokens).toLocaleString()}
                  </div>
                ) : (
                  <div className="text-zinc-500">—</div>
                )}
              </div>
            </div>
            <div className="text-zinc-200 text-sm font-mono bg-zinc-950 px-3 py-2 rounded border border-zinc-800">
              {agent.task}
            </div>
          </div>
        )}
      </div>

      {/* Git panel */}
      <GitPanel agentId={id} isActive={isActive} />

      {/* Terminal / Log viewer */}
      <div className="flex-1 overflow-hidden" style={{ minHeight: '400px', maxHeight: 'calc(100vh - 280px)' }}>
        {agent.type === 'claude' && hasPty ? (
          <PtyTerminal agentId={id} isActive={isActive} />
        ) : (
          <LogViewer
            agentId={id}
            initialLogs={initialLogs}
            agentStatus={agent.status}
            summary={agentSummary}
            agentTask={agent.task}
          />
        )}
      </div>

      {/* Message input */}
      <div className="border-t border-zinc-800 bg-zinc-950 px-6 py-4">
        <form onSubmit={handleSendMessage} className="flex gap-3 max-w-7xl mx-auto">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="send message to agent stdin..."
            className="font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-800 flex-1"
            disabled={sending}
          />
          <Button
            type="submit"
            disabled={sending || !message.trim()}
            className="font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700"
          >
            {sending ? 'sending...' : 'send'}
          </Button>
        </form>
        {msgFeedback && (
          <p className={`text-xs font-mono mt-1.5 max-w-7xl mx-auto ${msgFeedback.startsWith('error') ? 'text-red-400' : 'text-emerald-400'}`}>
            {msgFeedback}
          </p>
        )}
      </div>
    </div>
  );
}
