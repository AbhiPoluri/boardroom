'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Agent, Log } from '@/types';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtTime(ts: number): string {
  return new Date(ts < 1e12 ? ts * 1000 : ts).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'running':
    case 'spawning': return 'bg-emerald-400 animate-pulse';
    case 'idle': return 'bg-amber-400';
    case 'done': return 'bg-zinc-400';
    case 'error': return 'bg-red-400';
    default: return 'bg-zinc-700';
  }
}

// ─── types ────────────────────────────────────────────────────────────────────

interface AgentDetail {
  agent: Agent;
  logs: Log[];
  tokens?: { input_tokens: number; output_tokens: number; cost_usd: number };
  git?: { branch?: string; changed_files?: string[] };
}

// ─── agent column ─────────────────────────────────────────────────────────────

function AgentColumn({
  data,
  otherData,
  side,
}: {
  data: AgentDetail | null;
  otherData: AgentDetail | null;
  side: 'left' | 'right';
}) {
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-20">
        <p className="font-mono text-xs text-zinc-600">no agent selected</p>
      </div>
    );
  }

  const { agent, logs, tokens, git } = data;
  const lastLogs = logs.slice(-10);

  // Cost diff highlight
  const costDiffers = otherData?.tokens && tokens &&
    Math.abs(tokens.cost_usd - otherData.tokens.cost_usd) > 0.001;

  const _ = side; // suppress unused warning

  return (
    <div className="space-y-4 min-w-0">
      {/* Identity */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(agent.status)}`} />
          <h2 className="font-mono text-sm text-zinc-100 truncate">{agent.name}</h2>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
          <span className="text-zinc-600">type</span>
          <span className="text-zinc-300">{agent.type}</span>
          <span className="text-zinc-600">status</span>
          <span className={
            agent.status === 'running' || agent.status === 'spawning' ? 'text-emerald-400' :
            agent.status === 'error' ? 'text-red-400' :
            agent.status === 'done' ? 'text-zinc-400' : 'text-amber-400'
          }>{agent.status}</span>
          <span className="text-zinc-600">created</span>
          <span className="text-zinc-400">{fmtTime(agent.created_at)}</span>
          {agent.repo && (
            <>
              <span className="text-zinc-600">repo</span>
              <span className="text-zinc-400 truncate">{agent.repo.split('/').pop()}</span>
            </>
          )}
        </div>
      </div>

      {/* Task */}
      {agent.task && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
          <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">task</p>
          <p className="font-mono text-xs text-zinc-300 leading-relaxed line-clamp-4">{agent.task}</p>
        </div>
      )}

      {/* Cost + tokens */}
      {tokens && (
        <div className={`bg-zinc-900 border rounded-lg px-4 py-3 ${costDiffers ? 'border-amber-800/60' : 'border-zinc-800'}`}>
          <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-2">cost & tokens</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
            <span className="text-zinc-600">cost</span>
            <span className={`${costDiffers ? 'text-amber-400' : 'text-green-400'}`}>{fmtCost(tokens.cost_usd)}</span>
            <span className="text-zinc-600">input</span>
            <span className="text-zinc-400">{fmtTokens(tokens.input_tokens)}</span>
            <span className="text-zinc-600">output</span>
            <span className="text-zinc-400">{fmtTokens(tokens.output_tokens)}</span>
          </div>
        </div>
      )}

      {/* Branch + files */}
      {git?.branch && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
          <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">branch</p>
          <p className="font-mono text-xs text-zinc-300 mb-2">{git.branch}</p>
          {git.changed_files && git.changed_files.length > 0 && (
            <>
              <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-1">
                changed files ({git.changed_files.length})
              </p>
              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                {git.changed_files.map(f => (
                  <p key={f} className="font-mono text-[10px] text-zinc-500 truncate">{f}</p>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Last logs */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
        <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-2">
          last logs {lastLogs.length > 0 && `(${lastLogs.length})`}
        </p>
        {lastLogs.length === 0 ? (
          <p className="font-mono text-xs text-zinc-700">no logs</p>
        ) : (
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {lastLogs.map(l => (
              <p key={l.id} className={`font-mono text-[10px] leading-relaxed ${
                l.stream === 'stderr' ? 'text-red-400/80' : 'text-zinc-500'
              }`}>
                {l.content}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── inner component (uses useSearchParams) ───────────────────────────────────

function CompareInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const paramA = searchParams.get('a') ?? '';
  const paramB = searchParams.get('b') ?? '';

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedA, setSelectedA] = useState(paramA);
  const [selectedB, setSelectedB] = useState(paramB);
  const [dataA, setDataA] = useState<AgentDetail | null>(null);
  const [dataB, setDataB] = useState<AgentDetail | null>(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);

  // Load agent list
  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(d => setAgents(d.agents || []))
      .catch(() => {});
  }, []);

  const fetchAgent = useCallback(async (id: string): Promise<AgentDetail | null> => {
    if (!id) return null;
    try {
      const res = await fetch(`/api/agents/${id}`);
      if (!res.ok) return null;
      const d = await res.json();
      return {
        agent: d.agent,
        logs: d.logs || [],
        tokens: d.tokens,
        git: d.git,
      };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!selectedA) { setDataA(null); return; }
    setLoadingA(true);
    fetchAgent(selectedA).then(d => { setDataA(d); setLoadingA(false); });
  }, [selectedA, fetchAgent]);

  useEffect(() => {
    if (!selectedB) { setDataB(null); return; }
    setLoadingB(true);
    fetchAgent(selectedB).then(d => { setDataB(d); setLoadingB(false); });
  }, [selectedB, fetchAgent]);

  const updateURL = (a: string, b: string) => {
    const params = new URLSearchParams();
    if (a) params.set('a', a);
    if (b) params.set('b', b);
    router.replace(`/compare${params.size > 0 ? `?${params}` : ''}`);
  };

  const handleSelectA = (id: string) => { setSelectedA(id); updateURL(id, selectedB); };
  const handleSelectB = (id: string) => { setSelectedB(id); updateURL(selectedA, id); };

  const selectClass = 'bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-300 focus:outline-none focus:border-zinc-500 min-w-0 flex-1';

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-900/40 flex-wrap">
        <h1 className="font-mono text-sm text-zinc-100 flex-shrink-0">compare agents</h1>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <select value={selectedA} onChange={e => handleSelectA(e.target.value)} className={selectClass}>
            <option value="">-- agent A --</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.status})</option>
            ))}
          </select>
          <span className="font-mono text-xs text-zinc-600 flex-shrink-0">vs</span>
          <select value={selectedB} onChange={e => handleSelectB(e.target.value)} className={selectClass}>
            <option value="">-- agent B --</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.status})</option>
            ))}
          </select>
        </div>
      </header>

      {/* Two-column body */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-800 h-full">
          <div className="p-5 overflow-y-auto">
            {loadingA ? (
              <p className="font-mono text-xs text-zinc-600 animate-pulse">loading...</p>
            ) : (
              <AgentColumn data={dataA} otherData={dataB} side="left" />
            )}
          </div>
          <div className="p-5 overflow-y-auto">
            {loadingB ? (
              <p className="font-mono text-xs text-zinc-600 animate-pulse">loading...</p>
            ) : (
              <AgentColumn data={dataB} otherData={dataA} side="right" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── page export ──────────────────────────────────────────────────────────────

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <p className="font-mono text-xs text-zinc-600 animate-pulse">loading...</p>
      </div>
    }>
      <CompareInner />
    </Suspense>
  );
}
