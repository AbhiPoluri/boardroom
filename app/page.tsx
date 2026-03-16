'use client';

import { useState, useEffect, useCallback } from 'react';
import { AgentGrid } from '@/components/AgentGrid';
import { SpawnModal } from '@/components/SpawnModal';
import { Button } from '@/components/ui/button';
import type { Agent, AgentType } from '@/types';

interface Stats {
  active: number;
  pending_tasks: number;
  logs_today: number;
}

interface TokenStats {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<Stats>({ active: 0, pending_tasks: 0, logs_today: 0 });
  const [tokens, setTokens] = useState<TokenStats>({ input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 });
  const [agentTokens, setAgentTokens] = useState<Record<string, { input_tokens: number; output_tokens: number; cost_usd: number }>>({});
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setAgents(data.agents || []);
      setStats(data.stats || { active: 0, pending_tasks: 0, logs_today: 0 });
      if (data.tokens) setAgentTokens(data.tokens);
      setError('');
    } catch {
      setError('Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll token usage
  useEffect(() => {
    const fetchTokens = () => {
      fetch('/api/tokens')
        .then(r => r.json())
        .then(data => { if (data.session) setTokens(data.session); })
        .catch(() => {});
    };
    fetchTokens();
    const interval = setInterval(fetchTokens, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 2000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  const handleSpawn = async (data: { task: string; type: AgentType; repo?: string; name?: string }) => {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to spawn agent');
    }
    await fetchAgents();
  };

  const handleKill = async (id: string) => {
    try {
      await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      await fetchAgents();
    } catch {
      setError('Failed to kill agent');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/agents/${id}?purge=1`, { method: 'DELETE' });
      await fetchAgents();
    } catch {
      setError('Failed to delete agent');
    }
  };

  const handleResume = async (id: string, task: string) => {
    try {
      await fetch(`/api/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });
      await fetchAgents();
    } catch {
      setError('Failed to resume agent');
    }
  };

  const hasActive = stats.active > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm flex-shrink-0">
        <div className="pl-20 pr-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-lg font-semibold text-zinc-100 tracking-tight">
              boardroom
            </h1>
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                hasActive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-700'
              }`}
              title={hasActive ? `${stats.active} agent(s) running` : 'no active agents'}
            />
          </div>

          {/* Inline stats */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-zinc-600">active</span>
              <span className={`text-sm font-mono font-bold ${stats.active > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {stats.active}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-zinc-600">pending</span>
              <span className={`text-sm font-mono font-bold ${stats.pending_tasks > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>
                {stats.pending_tasks}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-zinc-600">logs</span>
              <span className="text-sm font-mono font-bold text-zinc-500">
                {stats.logs_today.toLocaleString()}
              </span>
            </div>
            {tokens.total_tokens > 0 && (
              <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-6">
                <span className="text-xs font-mono text-zinc-600">tokens</span>
                <span className="text-sm font-mono font-bold text-blue-400">
                  {formatTokens(tokens.total_tokens)}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={async () => {
                if (!confirm('Reset session? This kills all agents, clears chat, and wipes all data.')) return;
                await fetch('/api/reset', { method: 'POST' });
                await fetch('/api/chat', { method: 'DELETE' });
                setAgents([]);
                setStats({ active: 0, pending_tasks: 0, logs_today: 0 });
                setTokens({ input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 });
                setAgentTokens({});
                window.location.reload();
              }}
              size="sm"
              variant="ghost"
              className="font-mono text-zinc-600 hover:text-red-400 text-xs"
            >
              reset
            </Button>
            <Button
              onClick={() => setSpawnOpen(true)}
              size="sm"
              className="font-mono bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
            >
              + spawn
            </Button>
          </div>
        </div>
      </header>

      {/* Agent fleet panel */}
      <div className="flex-1 overflow-y-auto p-6 min-w-0">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-950/30 border border-red-900 rounded-lg text-sm text-red-400 font-mono">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider">
              agents <span className="text-zinc-700">({agents.length})</span>
            </h2>
            <button onClick={fetchAgents} className="text-xs font-mono text-zinc-700 hover:text-zinc-400 transition-colors">
              refresh
            </button>
          </div>
          {loading ? (
            <div className="text-center py-16 text-zinc-700 font-mono text-sm animate-pulse">loading...</div>
          ) : (
            <AgentGrid agents={agents} onKill={handleKill} onDelete={handleDelete} onSpawn={() => setSpawnOpen(true)} onResume={handleResume} agentTokens={agentTokens} />
          )}
      </div>

      <SpawnModal open={spawnOpen} onClose={() => setSpawnOpen(false)} onSpawn={handleSpawn} />
    </div>
  );
}
