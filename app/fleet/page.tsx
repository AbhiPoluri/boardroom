'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

function formatNum(n: number, decimals = false): string {
  if (decimals) return n.toFixed(4);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

function AnimatedNumber({ value, prefix = '', suffix = '', decimals = false }: { value: number; prefix?: string; suffix?: string; decimals?: boolean }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const duration = 600;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <>{prefix}{formatNum(display, decimals)}{suffix}</>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-[var(--br-bg-hover)] rounded ${className}`} />;
}
import { AgentGrid } from '@/components/AgentGrid';
import { SpawnModal } from '@/components/SpawnModal';
import { OnboardingTour } from '@/components/OnboardingTour';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import {
  GitBranch, Network,
  ChevronDown, ChevronRight,
  Folder, BarChart3, Terminal as TerminalIcon, Plus,
} from 'lucide-react';
import Link from 'next/link';
import { SubNav } from '@/components/SubNav';
import { NotificationBell } from '@/components/NotificationBell';
import { MergePanel } from '@/components/MergePanel';
import { DependencyGraph } from '@/components/DependencyGraph';
import AgentTimeline from '@/components/AgentTimeline';
import { Sparkline } from '@/components/Sparkline';
import { useProjects } from '@/lib/use-projects';
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

  // First-run redirect: check if Claude CLI is installed; redirect to /setup if not
  useEffect(() => {
    if (sessionStorage.getItem('boardroom:setup-checked')) return;
    sessionStorage.setItem('boardroom:setup-checked', '1');
    fetch('/api/setup-check')
      .then(r => r.json())
      .then((data: Record<string, { installed: boolean }>) => {
        if (!data.claude?.installed) {
          window.location.href = '/setup';
        }
      })
      .catch(() => {});
  }, []);
  const [tokens, setTokens] = useState<TokenStats>({ input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 });
  const [agentTokens, setAgentTokens] = useState<Record<string, { input_tokens: number; output_tokens: number; cost_usd: number }>>({});
  const [velocity, setVelocity] = useState<number[]>([]);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showMerge, setShowMerge] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showDepGraph, setShowDepGraph] = useState(false);

  // Batch selection state
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [killing, setKilling] = useState(false);

  // Filtering / sorting / grouping state
  const [filter, setFilter] = useState<'all' | 'active' | 'done' | 'error' | 'idle'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [repoFilter, setRepoFilter] = useState<string>('all');
  const [groupMode, setGroupMode] = useState<'flat' | 'repo' | 'status'>('flat');
  const [filterPresets, setFilterPresets] = useState<Record<string, { filter: string; sortBy: string; searchQuery: string }>>({});
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [showAllProjects, setShowAllProjects] = useState(false);
  const { active: activeProject } = useProjects();
  const activeProjectId = activeProject?.id;

  const fetchAgents = useCallback(async () => {
    try {
      const url = showAllProjects
        ? '/api/agents?project=all'
        : activeProjectId
        ? `/api/agents?project=${encodeURIComponent(activeProjectId)}`
        : '/api/agents';
      const res = await fetch(url);
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
  }, [activeProjectId, showAllProjects]);

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

  const intervalMsRef = useRef(8000);
  useEffect(() => {
    fetchAgents();
    // Poll faster when agents are active, slower when idle.
    // Using setTimeout recursion so each tick reads the current intervalMsRef.current,
    // allowing the interval to adapt without restarting the effect.
    let timeoutId: ReturnType<typeof setTimeout>;
    const tick = () => {
      fetchAgents();
      timeoutId = setTimeout(tick, intervalMsRef.current);
    };
    timeoutId = setTimeout(tick, intervalMsRef.current);
    return () => clearTimeout(timeoutId);
  }, [fetchAgents]);

  // Keep intervalMsRef in sync with active agent count without touching the effect deps.
  useEffect(() => {
    intervalMsRef.current = stats.active > 0 ? 3000 : 8000;
  }, [stats.active]);

  // Listen for spawn shortcut dispatched by AppShell (Cmd+Shift+N)
  useEffect(() => {
    const handler = () => setSpawnOpen(true);
    window.addEventListener('boardroom:spawn', handler);
    return () => window.removeEventListener('boardroom:spawn', handler);
  }, []);

  // Detect agent status transitions to 'done' for toast notifications
  const prevAgentStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const prev = prevAgentStatusRef.current;
    for (const agent of agents) {
      const prevStatus = prev[agent.id];
      if (prevStatus && (prevStatus === 'running' || prevStatus === 'spawning') && agent.status === 'done') {
        toast.success(`agent "${agent.name}" finished`);
      }
      if (prevStatus && (prevStatus === 'running' || prevStatus === 'spawning') && agent.status === 'error') {
        toast.error(`agent "${agent.name}" errored`);
      }
    }
    // Rebuild the map
    const next: Record<string, string> = {};
    for (const agent of agents) next[agent.id] = agent.status;
    prevAgentStatusRef.current = next;
  }, [agents]);

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
    const spawned = await res.json();
    const agentName = data.name || spawned?.agent?.name || 'agent';
    toast.success(`spawned ${agentName}`);
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

  const handleKillSelected = async () => {
    if (selectedAgentIds.size === 0) return;
    setKilling(true);
    await Promise.all(Array.from(selectedAgentIds).map(id => fetch(`/api/agents/${id}`, { method: 'DELETE' })));
    setSelectedAgentIds(new Set());
    setKilling(false);
    await fetchAgents();
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

  // Uptime tracking
  const pageLoadTime = useRef(Date.now());
  const [uptime, setUptime] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setUptime(Math.floor((Date.now() - pageLoadTime.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  function formatUptime(s: number): string {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  // Unique repos for the repo filter dropdown
  const uniqueRepos = Array.from(new Set(agents.filter(a => a.repo).map(a => a.repo as string))).sort();

  // Filtered + sorted agents
  const filteredAgents = agents
    .filter(a =>
      filter === 'all' ||
      a.status === filter ||
      (filter === 'active' && ['running', 'spawning'].includes(a.status))
    )
    .filter(a =>
      repoFilter === 'all' || a.repo === repoFilter
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
    selectedAgentIds,
    onToggleSelect: (id: string) => {
      setSelectedAgentIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    },
  };

  const renderAgentGrid = (list: Agent[]) => (
    <AgentGrid agents={list} {...agentCardProps} />
  );

  // Agents with depends_on set
  const depsAgents = agents.filter(a => (a as any).depends_on?.length > 0);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
        {/* Editorial header — eyebrow, serif italic-accent title, subtitle, action cluster */}
        <header
          className="flex-shrink-0 flex items-end justify-between gap-6"
          style={{
            padding: '36px 36px 20px',
            borderBottom: '1px solid var(--border-faint)',
          }}
        >
          <div className="flex flex-col gap-2 min-w-0">
            <span className="brr-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>agents at work</span>
              {hasActive && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)', textTransform: 'none', letterSpacing: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor', boxShadow: '0 0 0 3px rgba(232,145,81,0.18)' }} />
                  live
                </span>
              )}
            </span>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontWeight: 400,
                fontSize: 36,
                lineHeight: 1.1,
                letterSpacing: '-0.014em',
                color: 'var(--fg)',
              }}
            >
              fleet <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>monitor.</em>
            </h1>
            <p
              style={{
                margin: '4px 0 0',
                font: '400 13px/1.55 var(--font-mono)',
                color: 'var(--fg-secondary)',
                maxWidth: '64ch',
              }}
            >
              every spawned agent — status, cost, tokens, last log line. click in for live output.
            </p>
            {/* Live stat strip */}
            <div
              className="flex flex-wrap items-center gap-3 mt-2"
              style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--fg-muted)' }}
            >
              <span>
                <span style={{ color: 'var(--fg)', marginRight: 3 }}>{stats.active}</span> running
              </span>
              <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--fg-faint)' }} />
              <span>
                <span style={{ color: 'var(--fg)', marginRight: 3 }}>{stats.pending_tasks}</span> queued
              </span>
              {tokens.cost_usd > 0 && (
                <>
                  <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--fg-faint)' }} />
                  <span>
                    <span style={{ color: 'var(--accent)', marginRight: 3 }}>
                      <AnimatedNumber value={tokens.cost_usd} prefix="$" decimals />
                    </span>
                    spent
                  </span>
                </>
              )}
              {tokens.total_tokens > 0 && (
                <>
                  <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--fg-faint)' }} />
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--fg)' }}>
                      <AnimatedNumber value={tokens.total_tokens} suffix="" />
                    </span>
                    tokens
                    {velocity.length > 0 && (
                      <Sparkline data={velocity} width={60} height={14} color="var(--accent)" animate={hasActive} />
                    )}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <NotificationBell />
            <button
              type="button"
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
              className="brr-btn brr-btn--ghost"
              title="Reset session"
            >
              reset
            </button>
            <button
              type="button"
              onClick={() => setSpawnOpen(true)}
              className="brr-btn brr-btn--primary"
            >
              <Plus className="w-3 h-3" strokeWidth={1.75} /> spawn
              <span style={{ marginLeft: 4, font: '500 9px var(--font-mono)', color: 'var(--bg)', opacity: 0.7, letterSpacing: '0.08em' }}>⌘K</span>
            </button>
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
            <h2 className="font-mono text-xs text-[var(--br-text-muted)] uppercase tracking-wider flex items-center gap-2">
              agents
              <span className="text-[var(--br-text-muted)]">
                ({filteredAgents.length !== agents.length
                  ? `${filteredAgents.length}/`
                  : ''}{agents.length})
              </span>
              {!showAllProjects && activeProject && (
                <span
                  style={{
                    textTransform: 'none', letterSpacing: 0,
                    color: 'var(--accent)', font: '500 10px/1 var(--font-mono)',
                    padding: '2px 6px', borderRadius: 999,
                    background: 'var(--accent-soft)', border: '1px solid var(--accent-line)',
                  }}
                >
                  scoped to {activeProject.name}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAllProjects(s => !s)}
                title="Toggle agents across all projects"
                style={{
                  font: '500 10px/1 var(--font-mono)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: showAllProjects ? 'var(--accent)' : 'var(--fg-muted)',
                  background: showAllProjects ? 'var(--accent-soft)' : 'transparent',
                  border: '1px solid ' + (showAllProjects ? 'var(--accent-line)' : 'var(--border)'),
                  padding: '4px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {showAllProjects ? 'all projects' : 'this project'}
              </button>
              <button onClick={fetchAgents} className="text-xs font-mono text-[var(--br-text-muted)] hover:text-[var(--br-text-secondary)] transition-colors">
                refresh
              </button>
            </div>
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
                    ? 'bg-[var(--br-accent)] text-white'
                    : 'bg-[var(--br-bg-hover)] text-[var(--br-text-secondary)] hover:bg-[var(--br-bg-hover)]'
                }`}
              >
                {f}{f !== 'all' && ` (${countForFilter(f)})`}
              </button>
            ))}
            {uniqueRepos.length > 0 && (
              <select
                value={repoFilter}
                onChange={e => setRepoFilter(e.target.value)}
                className="bg-[var(--br-bg-secondary)] border border-[var(--br-border)] rounded-full px-2 py-1 text-xs font-mono text-[var(--br-text-secondary)] focus:outline-none focus:border-[var(--br-text-muted)]"
                title="Filter by repo"
              >
                <option value="all">all repos</option>
                {uniqueRepos.map(r => (
                  <option key={r} value={r}>{r.split('/').pop() || r}</option>
                ))}
              </select>
            )}
            <Link
              href="/compare"
              className="font-mono text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors underline underline-offset-2"
            >
              compare
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="search agents..."
                className="bg-[var(--br-bg-secondary)] border border-[var(--br-border)] rounded-lg px-3 py-1 text-xs font-mono text-[var(--br-text-primary)] placeholder-[var(--br-text-muted)] w-48 focus:outline-none focus:border-[var(--br-text-muted)]"
              />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="bg-[var(--br-bg-secondary)] border border-[var(--br-border)] rounded-lg px-2 py-1 text-xs font-mono text-[var(--br-text-secondary)] focus:outline-none"
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
              {showPresetInput ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={presetName}
                    onChange={e => setPresetName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && presetName.trim()) {
                        const presets = { ...filterPresets };
                        presets[presetName.trim()] = { filter, sortBy, searchQuery };
                        setFilterPresets(presets);
                        localStorage.setItem('boardroom:filterPresets', JSON.stringify(presets));
                        setPresetName('');
                        setShowPresetInput(false);
                      } else if (e.key === 'Escape') {
                        setPresetName('');
                        setShowPresetInput(false);
                      }
                    }}
                    placeholder="preset name..."
                    className="bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs font-mono text-zinc-300 placeholder-zinc-600 w-28 focus:outline-none focus:border-zinc-400"
                  />
                  <button
                    onClick={() => {
                      if (presetName.trim()) {
                        const presets = { ...filterPresets };
                        presets[presetName.trim()] = { filter, sortBy, searchQuery };
                        setFilterPresets(presets);
                        localStorage.setItem('boardroom:filterPresets', JSON.stringify(presets));
                      }
                      setPresetName('');
                      setShowPresetInput(false);
                    }}
                    className="px-1.5 py-1 rounded text-xs font-mono bg-emerald-700 text-white hover:bg-emerald-600 transition-colors"
                  >
                    save
                  </button>
                  <button
                    onClick={() => { setPresetName(''); setShowPresetInput(false); }}
                    className="px-1.5 py-1 rounded text-xs font-mono bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowPresetInput(true)}
                  className="px-2 py-1 rounded-lg text-xs font-mono bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
                  title="Save current filters as preset"
                >
                  {Object.keys(filterPresets).length > 0 ? '★' : '☆'}
                </button>
              )}
            </div>
          </div>

          {/* Dependency graph — shown inline below filter bar when any agent has deps */}
          {depsAgents.length > 0 && (
            <div className="mb-3 border border-[var(--br-border)] rounded-lg overflow-hidden">
              <button
                onClick={() => setShowDepGraph(d => !d)}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-[var(--br-bg-secondary)]/40 hover:bg-[var(--br-bg-secondary)] transition-colors text-left"
              >
                {showDepGraph ? <ChevronDown className="w-3 h-3 text-[var(--br-text-muted)]" /> : <ChevronRight className="w-3 h-3 text-[var(--br-text-muted)]" />}
                <span className="font-mono text-[10px] text-[var(--br-text-muted)]">show deps ({depsAgents.length})</span>
              </button>
              {showDepGraph && (
                <div className="px-3 py-2 font-mono text-[10px] space-y-0.5 bg-[var(--br-bg-primary)]/40">
                  {depsAgents.map(a => (
                    ((a as any).depends_on as string[]).map((depId: string) => {
                      const depAgent = agents.find(x => x.id === depId);
                      const depName = depAgent?.name ?? depId.slice(0, 8);
                      return (
                        <div key={`${depId}->${a.id}`} className="flex items-center gap-1.5 text-[var(--br-text-secondary)]">
                          <span className="text-[var(--br-text-secondary)]">{depName}</span>
                          <span className="text-[var(--br-text-muted)]">→</span>
                          <span className="text-[var(--br-text-primary)]">{a.name}</span>
                          {depAgent && (
                            <span className={`ml-1 text-[9px] ${
                              depAgent.status === 'done' ? 'text-emerald-600' :
                              depAgent.status === 'running' ? 'text-emerald-400' :
                              depAgent.status === 'error' ? 'text-red-400' : 'text-[var(--br-text-muted)]'
                            }`}>({depAgent.status})</span>
                          )}
                        </div>
                      );
                    })
                  ))}
                </div>
              )}
            </div>
          )}

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[220px] rounded-xl" />
              ))}
            </div>
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

      {/* Batch action floating bar */}
      {selectedAgentIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 bg-zinc-900 border-t border-zinc-700 rounded-lg shadow-2xl">
          <span className="font-mono text-[11px] text-zinc-400">{selectedAgentIds.size} selected</span>
          <button
            onClick={handleKillSelected}
            disabled={killing}
            className="px-3 py-1 rounded text-[11px] font-mono bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition-colors"
          >
            {killing ? 'killing...' : `kill selected (${selectedAgentIds.size})`}
          </button>
          <button
            onClick={() => setSelectedAgentIds(new Set())}
            className="px-3 py-1 rounded text-[11px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            clear selection
          </button>
        </div>
      )}

      {/* Status bar */}
      <div className="flex-shrink-0 h-6 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between px-3 text-[9px] font-mono text-zinc-600">
        <span>
          <span className={stats.active > 0 ? 'text-emerald-400' : ''}>{stats.active} active</span>
          <span className="mx-1.5 text-zinc-800">·</span>
          <span className={stats.pending_tasks > 0 ? 'text-amber-400' : ''}>{stats.pending_tasks} pending</span>
        </span>
        <span className={tokens.cost_usd > 0 ? 'text-green-400' : 'text-zinc-700'}>
          ${tokens.cost_usd.toFixed(4)}
        </span>
        <span>
          <span className={tokens.total_tokens > 0 ? 'text-blue-400' : 'text-zinc-700'}>{formatTokens(tokens.total_tokens)} tok</span>
          <span className="mx-1.5 text-zinc-800">·</span>
          <span>up {formatUptime(uptime)}</span>
        </span>
      </div>

      <OnboardingTour />
      <SpawnModal open={spawnOpen} onClose={() => setSpawnOpen(false)} onSpawn={handleSpawn} onImport={handleImport} existingAgents={agents.map(a => ({ id: a.id, name: a.name, status: a.status, created_at: a.created_at }))} />
    </div>
  );
}
