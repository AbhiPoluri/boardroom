'use client';

import { useState, useEffect, useCallback } from 'react';
import { AgentGrid } from '@/components/AgentGrid';
import { SpawnModal } from '@/components/SpawnModal';
import { Button } from '@/components/ui/button';
import {
  GitBranch, Network,
  ChevronDown, ChevronRight,
  Folder, BarChart3, Terminal as TerminalIcon,
} from 'lucide-react';
import { NotificationBell } from '@/components/NotificationBell';
import { MergePanel } from '@/components/MergePanel';
import { DependencyGraph } from '@/components/DependencyGraph';
import AgentTimeline from '@/components/AgentTimeline';
import { Sparkline } from '@/components/Sparkline';
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
  const [velocity, setVelocity] = useState<number[]>([]);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showMerge, setShowMerge] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  // Filtering / sorting / grouping state
  const [filter, setFilter] = useState<'all' | 'active' | 'done' | 'error' | 'idle'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupMode, setGroupMode] = useState<'flat' | 'repo' | 'status'>('flat');
  const [filterPresets, setFilterPresets] = useState<Record<string, { filter: string; sortBy: string; searchQuery: string }>>({});

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
        .then(data => {
          if (data.session) setTokens(data.session);
          if (data.velocity) setVelocity(data.velocity.map((v: any) => v.tokens));
        })
        .catch(() => {});
    };
    fetchTokens();
    const interval = setInterval(fetchTokens, 15000);
    return () => clearInterval(interval);
  }, []);

  // Restore localStorage preferences after mount (SSR-safe)
  useEffect(() => {
    const saved = localStorage.getItem('boardroom:groupMode');
    if (saved) setGroupMode(saved as 'flat' | 'repo' | 'status');
    const presets = localStorage.getItem('boardroom:filterPresets');
    if (presets) { try { setFilterPresets(JSON.parse(presets)); } catch {} }
  }, []);

  useEffect(() => {
    fetchAgents();
    // Poll faster when agents are active, slower when idle
    const interval = setInterval(fetchAgents, stats.active > 0 ? 3000 : 8000);
    return () => clearInterval(interval);
  }, [fetchAgents, stats.active]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSpawnOpen(true);
      }
      if (e.key === 'Escape') {
        setSpawnOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSpawn = async (data: { task: string; type: AgentType; repo?: string; useGitIsolation?: boolean; name?: string; model?: string; depends_on?: string[] }) => {
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

  const handleImport = async (data: { path: string; name?: string; task?: string; type?: AgentType; model?: string }) => {
    const res = await fetch('/api/agents', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to import');
    }
    await fetchAgents();
  };

  const hasActive = stats.active > 0;

  // Filtered + sorted agents
  const filteredAgents = agents
    .filter(a =>
      filter === 'all' ||
      a.status === filter ||
      (filter === 'active' && ['running', 'spawning'].includes(a.status))
    )
    .filter(a =>
      !searchQuery ||
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.task ?? '').toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'oldest') return a.created_at - b.created_at;
      return b.created_at - a.created_at;
    });

  const countForFilter = (f: typeof filter) =>
    agents.filter(a =>
      f === 'active' ? ['running', 'spawning'].includes(a.status) : a.status === f
    ).length;

  // Agent card renderer — shared between grouped and flat views
  const agentCardProps = {
    onKill: handleKill,
    onDelete: handleDelete,
    onSpawn: () => setSpawnOpen(true),
    onResume: handleResume,
    agentTokens,
    allAgents: agents,
  };

  const renderAgentGrid = (list: Agent[]) => (
    <AgentGrid agents={list} {...agentCardProps} />
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950 text-zinc-100">
        {/* Header */}
        <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-sm text-zinc-100">agent fleet</h1>
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                hasActive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-700'
              }`}
              title={hasActive ? 'Agents active' : 'No active agents'}
              role="status"
            />
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className={stats.active > 0 ? 'text-emerald-400' : 'text-zinc-600'}>
                {stats.active} active
              </span>
              <span className={stats.pending_tasks > 0 ? 'text-amber-400' : 'text-zinc-600'}>
                {stats.pending_tasks} pending
              </span>
              {tokens.cost_usd > 0 && (
                <span className="text-green-400">${tokens.cost_usd.toFixed(4)}</span>
              )}
              {tokens.total_tokens > 0 && (
                <span className="text-blue-400 flex items-center gap-1.5">
                  {formatTokens(tokens.total_tokens)} tok
                  {velocity.length > 0 && <Sparkline data={velocity} width={60} height={16} color="#60a5fa" />}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
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
              className="font-mono text-zinc-600 hover:text-red-400 text-[11px] px-1.5"
              title="Reset session"
            >
              reset
            </Button>
            <div className="flex items-center gap-1">
              <Button
                onClick={() => setSpawnOpen(true)}
                size="sm"
                className="font-mono bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] px-2"
              >
                + spawn
              </Button>
              <span className="text-[9px] font-mono text-zinc-700">&#8984;K</span>
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

          {/* Agents header */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider">
              agents{' '}
              <span className="text-zinc-700">
                ({filteredAgents.length !== agents.length
                  ? `${filteredAgents.length}/`
                  : ''}{agents.length})
              </span>
            </h2>
            <button onClick={fetchAgents} className="text-xs font-mono text-zinc-700 hover:text-zinc-400 transition-colors">
              refresh
            </button>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {(['all', 'active', 'done', 'error', 'idle'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`px-3 py-1 rounded-full text-xs font-mono transition-colors ${
                  filter === f
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {f}{f !== 'all' && ` (${countForFilter(f)})`}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="search agents..."
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1 text-xs font-mono text-zinc-300 placeholder-zinc-600 w-48 focus:outline-none focus:border-zinc-500"
              />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs font-mono text-zinc-400 focus:outline-none"
              >
                <option value="newest">newest first</option>
                <option value="oldest">oldest first</option>
                <option value="name">by name</option>
              </select>
              <button
                onClick={() => {
                  const modes: Array<'flat' | 'repo' | 'status'> = ['flat', 'repo', 'status'];
                  const nextMode = modes[(modes.indexOf(groupMode) + 1) % modes.length];
                  setGroupMode(nextMode);
                  localStorage.setItem('boardroom:groupMode', nextMode);
                }}
                className={`px-2 py-1 rounded-lg text-xs font-mono transition-colors ${
                  groupMode === 'flat'
                    ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    : groupMode === 'repo'
                    ? 'bg-purple-600 text-white'
                    : 'bg-amber-600 text-white'
                }`}
              >
                {groupMode === 'flat' ? 'flat' : groupMode === 'repo' ? 'by repo' : 'by status'}
              </button>
              <button
                onClick={() => {
                  const name = prompt('Save filter preset as:');
                  if (name?.trim()) {
                    const presets = { ...filterPresets };
                    presets[name.trim()] = { filter, sortBy, searchQuery };
                    setFilterPresets(presets);
                    localStorage.setItem('boardroom:filterPresets', JSON.stringify(presets));
                  }
                }}
                className="px-2 py-1 rounded-lg text-xs font-mono bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
                title="Save current filters as preset"
              >
                {Object.keys(filterPresets).length > 0 ? '★' : '☆'}
              </button>
            </div>
          </div>

          {/* Saved presets */}
          {Object.keys(filterPresets).length > 0 && (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[10px] font-mono text-zinc-700">presets:</span>
              {Object.entries(filterPresets).map(([name, preset]) => (
                <span
                  key={name}
                  className="flex items-center gap-1 rounded-full bg-purple-900/60 border border-purple-800 text-purple-300 hover:border-purple-700 transition-colors"
                >
                  <button
                    onClick={() => {
                      setFilter(preset.filter as any);
                      setSortBy(preset.sortBy as any);
                      setSearchQuery(preset.searchQuery);
                    }}
                    className="px-2 py-1 text-xs font-mono"
                  >
                    {name}
                  </button>
                  <button
                    onClick={() => {
                      const updated = { ...filterPresets };
                      delete updated[name];
                      setFilterPresets(updated);
                      localStorage.setItem('boardroom:filterPresets', JSON.stringify(updated));
                    }}
                    className="pr-1.5 text-purple-500 hover:text-purple-200 transition-colors text-xs leading-none"
                    title={`Delete preset "${name}"`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {loading ? (
            <div className="text-center py-16 text-zinc-700 font-mono text-sm animate-pulse">loading...</div>
          ) : filteredAgents.length === 0 && agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <TerminalIcon className="w-10 h-10 text-zinc-800 mb-4" />
              <h3 className="font-mono text-sm text-zinc-500 mb-1">no agents running</h3>
              <p className="font-mono text-xs text-zinc-700">spawn your first agent to get started</p>
            </div>
          ) : groupMode === 'flat' ? (
            renderAgentGrid(filteredAgents)
          ) : groupMode === 'repo' ? (
            Object.entries(
              filteredAgents.reduce((acc, a) => {
                const key = a.repo || a.worktree_path?.split('/').slice(0, -1).pop() || 'ungrouped';
                (acc[key] = acc[key] || []).push(a);
                return acc;
              }, {} as Record<string, Agent[]>)
            ).map(([group, groupAgents]) => (
              <div key={group}>
                <div className="text-xs font-mono text-zinc-500 mb-2 mt-4 flex items-center gap-2">
                  <Folder className="w-3 h-3" />
                  {group}
                  <span className="text-zinc-600">({groupAgents.length})</span>
                </div>
                {renderAgentGrid(groupAgents)}
              </div>
            ))
          ) : (
            /* Group by status */
            (['running', 'idle', 'done', 'error'] as const).map((status) => {
              const statusAgents = filteredAgents.filter(a =>
                status === 'running' ? ['running', 'spawning'].includes(a.status) : a.status === status
              );
              return statusAgents.length > 0 ? (
                <div key={status}>
                  <div className="text-xs font-mono text-zinc-500 mb-2 mt-4 flex items-center gap-2 cursor-pointer group">
                    <span className={`w-2 h-2 rounded-full ${
                      status === 'running' ? 'bg-emerald-400' :
                      status === 'idle' ? 'bg-amber-400' :
                      status === 'done' ? 'bg-zinc-500' :
                      'bg-red-400'
                    }`} />
                    {status}
                    <span className="text-zinc-600">({statusAgents.length})</span>
                  </div>
                  {renderAgentGrid(statusAgents)}
                </div>
              ) : null;
            })
          )}

          {/* Collapsible panels */}
          {agents.length > 0 && (
            <div className="mt-6 space-y-2">
              {/* Dependency Graph */}
              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowGraph(g => !g)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-zinc-900/50 hover:bg-zinc-900 transition-colors text-left"
                >
                  {showGraph ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                  <Network className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="font-mono text-xs text-zinc-400">execution graph</span>
                </button>
                {showGraph && <DependencyGraph agents={agents} />}
              </div>

              {/* Merge Panel */}
              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowMerge(m => !m)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-zinc-900/50 hover:bg-zinc-900 transition-colors text-left"
                >
                  {showMerge ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                  <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="font-mono text-xs text-zinc-400">branches & merge</span>
                </button>
                {showMerge && <MergePanel agents={agents} />}
              </div>

              {/* Agent Timeline */}
              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowTimeline(t => !t)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-zinc-900/50 hover:bg-zinc-900 transition-colors text-left"
                >
                  {showTimeline ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                  <BarChart3 className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="font-mono text-xs text-zinc-400">agent timeline</span>
                </button>
                {showTimeline && <AgentTimeline agents={agents} />}
              </div>

            </div>
          )}
        </div>

      <SpawnModal open={spawnOpen} onClose={() => setSpawnOpen(false)} onSpawn={handleSpawn} onImport={handleImport} existingAgents={agents.map(a => ({ id: a.id, name: a.name }))} />
    </div>
  );
}
