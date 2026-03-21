'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Settings } from 'lucide-react';
import { SubNav } from '@/components/SubNav';
import type { Agent, PushRequest } from '@/types';

// ─── widget definitions ───────────────────────────────────────────────────────

const WIDGET_DEFS = [
  { id: 'active-agents', label: 'active agents' },
  { id: 'session-cost', label: 'session cost' },
  { id: 'recent-prs', label: 'recent PRs' },
  { id: 'token-velocity', label: 'token velocity' },
  { id: 'agent-timeline', label: 'agent timeline' },
  { id: 'workflow-runs', label: 'workflow runs' },
] as const;

type WidgetId = (typeof WIDGET_DEFS)[number]['id'];

const STORAGE_KEY = 'boardroom:dashboard-widgets';
const ALL_IDS: WidgetId[] = WIDGET_DEFS.map(w => w.id);

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtTime(ts: number): string {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusDot(status: string): string {
  switch (status) {
    case 'running':
    case 'spawning': return 'bg-emerald-400 animate-pulse';
    case 'idle': return 'bg-amber-400';
    case 'done': return 'bg-zinc-500';
    case 'error': return 'bg-red-400';
    default: return 'bg-zinc-700';
  }
}

// ─── card shell ───────────────────────────────────────────────────────────────

function WidgetCard({
  title,
  onRefresh,
  children,
}: {
  title: string;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col min-h-[200px]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 flex-shrink-0">
        <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">{title}</span>
        {onRefresh && (
          <button onClick={onRefresh} className="text-zinc-600 hover:text-zinc-400 transition-colors" title="Refresh">
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto px-4 py-3">{children}</div>
    </div>
  );
}

// ─── individual widgets ───────────────────────────────────────────────────────

function ActiveAgentsWidget() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    setLoading(true);
    fetch('/api/agents')
      .then(r => r.json())
      .then(d => setAgents((d.agents || []).filter((a: Agent) => ['running', 'spawning'].includes(a.status))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 5000); return () => clearInterval(iv); }, [fetch_]);

  return (
    <WidgetCard title="active agents" onRefresh={fetch_}>
      {loading ? (
        <p className="font-mono text-xs text-zinc-600 animate-pulse">loading...</p>
      ) : agents.length === 0 ? (
        <p className="font-mono text-xs text-zinc-600">no active agents</p>
      ) : (
        <div className="space-y-1.5">
          <p className="font-mono text-2xl text-emerald-400 mb-2">{agents.length}</p>
          {agents.map(a => (
            <div key={a.id} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(a.status)}`} />
              <span className="font-mono text-xs text-zinc-300 truncate">{a.name}</span>
              <span className="font-mono text-[10px] text-zinc-600 ml-auto flex-shrink-0">{a.type}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function SessionCostWidget() {
  const [data, setData] = useState<{ cost_usd: number; input_tokens: number; output_tokens: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    setLoading(true);
    fetch('/api/tokens')
      .then(r => r.json())
      .then(d => setData(d.session || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 10000); return () => clearInterval(iv); }, [fetch_]);

  const total = data ? data.input_tokens + data.output_tokens : 0;
  const inputPct = total > 0 ? (data!.input_tokens / total) * 100 : 50;

  return (
    <WidgetCard title="session cost" onRefresh={fetch_}>
      {loading ? (
        <p className="font-mono text-xs text-zinc-600 animate-pulse">loading...</p>
      ) : !data ? (
        <p className="font-mono text-xs text-zinc-600">no data</p>
      ) : (
        <div className="space-y-3">
          <p className="font-mono text-2xl text-green-400">${data.cost_usd.toFixed(4)}</p>
          <div className="space-y-1">
            <div className="flex justify-between font-mono text-[10px] text-zinc-500">
              <span>input {fmtTokens(data.input_tokens)}</span>
              <span>output {fmtTokens(data.output_tokens)}</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-l-full"
                style={{ width: `${inputPct}%` }}
              />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-zinc-600">
              <span className="text-blue-400">input</span>
              <span className="text-purple-400">output</span>
            </div>
          </div>
          <p className="font-mono text-[10px] text-zinc-600">total {fmtTokens(total)} tokens</p>
        </div>
      )}
    </WidgetCard>
  );
}

function RecentPRsWidget() {
  const [prs, setPrs] = useState<PushRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    setLoading(true);
    fetch('/api/push-requests')
      .then(r => r.json())
      .then(d => setPrs((d.pushRequests || d || []).slice(0, 5)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const badgeColor = (s: string) => s === 'approved' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-800'
    : s === 'rejected' ? 'text-red-400 bg-red-500/10 border-red-800'
    : 'text-amber-400 bg-amber-500/10 border-amber-800';

  return (
    <WidgetCard title="recent PRs" onRefresh={fetch_}>
      {loading ? (
        <p className="font-mono text-xs text-zinc-600 animate-pulse">loading...</p>
      ) : prs.length === 0 ? (
        <p className="font-mono text-xs text-zinc-600">no push requests</p>
      ) : (
        <div className="space-y-2">
          {prs.map(pr => (
            <div key={pr.id} className="flex items-start gap-2">
              <span className={`flex-shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded border ${badgeColor(pr.status)}`}>
                {pr.status}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-zinc-300 truncate">{pr.agent_name}</p>
                <p className="font-mono text-[10px] text-zinc-600 truncate">{pr.branch}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function TokenVelocityWidget() {
  const [velocity, setVelocity] = useState<{ tokens: number; window: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    setLoading(true);
    fetch('/api/tokens')
      .then(r => r.json())
      .then(d => setVelocity(d.velocity || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 15000); return () => clearInterval(iv); }, [fetch_]);

  const windows = [
    { label: '1h', key: '1h' },
    { label: '6h', key: '6h' },
    { label: '24h', key: '24h' },
  ];

  return (
    <WidgetCard title="token velocity" onRefresh={fetch_}>
      {loading ? (
        <p className="font-mono text-xs text-zinc-600 animate-pulse">loading...</p>
      ) : (
        <div className="space-y-3">
          {windows.map(w => {
            const entry = velocity.find(v => v.window === w.key);
            const tokens = entry?.tokens ?? 0;
            return (
              <div key={w.key} className="flex items-center justify-between">
                <span className="font-mono text-xs text-zinc-500">{w.label}</span>
                <span className={`font-mono text-sm ${tokens > 0 ? 'text-blue-400' : 'text-zinc-700'}`}>
                  {fmtTokens(tokens)}
                </span>
              </div>
            );
          })}
          {velocity.length === 0 && (
            <p className="font-mono text-xs text-zinc-600">no velocity data</p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

function AgentTimelineWidget() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    setLoading(true);
    fetch('/api/agents')
      .then(r => r.json())
      .then(d => {
        const sorted = [...(d.agents || [])].sort((a: Agent, b: Agent) => b.created_at - a.created_at).slice(0, 10);
        setAgents(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 8000); return () => clearInterval(iv); }, [fetch_]);

  return (
    <WidgetCard title="agent timeline" onRefresh={fetch_}>
      {loading ? (
        <p className="font-mono text-xs text-zinc-600 animate-pulse">loading...</p>
      ) : agents.length === 0 ? (
        <p className="font-mono text-xs text-zinc-600">no agents</p>
      ) : (
        <div className="space-y-1.5">
          {agents.map(a => (
            <div key={a.id} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(a.status)}`} />
              <span className="font-mono text-xs text-zinc-300 truncate flex-1">{a.name}</span>
              <span className="font-mono text-[10px] text-zinc-600 flex-shrink-0">{fmtTime(a.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function WorkflowRunsWidget() {
  const [runs, setRuns] = useState<{ id: string; workflow_name: string; status: string; started_at: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    setLoading(true);
    fetch('/api/workflows/history')
      .then(r => r.json())
      .then(d => setRuns((d.runs || d || []).slice(0, 5)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const statusColor = (s: string) =>
    s === 'completed' ? 'text-emerald-400' : s === 'failed' ? 'text-red-400' : s === 'running' ? 'text-blue-400' : 'text-zinc-500';

  return (
    <WidgetCard title="workflow runs" onRefresh={fetch_}>
      {loading ? (
        <p className="font-mono text-xs text-zinc-600 animate-pulse">loading...</p>
      ) : runs.length === 0 ? (
        <p className="font-mono text-xs text-zinc-600">no workflow runs</p>
      ) : (
        <div className="space-y-2">
          {runs.map(r => (
            <div key={r.id} className="flex items-center gap-2">
              <span className={`font-mono text-[10px] flex-shrink-0 ${statusColor(r.status)}`}>{r.status}</span>
              <span className="font-mono text-xs text-zinc-300 truncate flex-1">{r.workflow_name}</span>
              <span className="font-mono text-[10px] text-zinc-600 flex-shrink-0">{fmtTime(r.started_at)}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

// ─── widget renderer ──────────────────────────────────────────────────────────

function renderWidget(id: WidgetId) {
  switch (id) {
    case 'active-agents': return <ActiveAgentsWidget />;
    case 'session-cost': return <SessionCostWidget />;
    case 'recent-prs': return <RecentPRsWidget />;
    case 'token-velocity': return <TokenVelocityWidget />;
    case 'agent-timeline': return <AgentTimelineWidget />;
    case 'workflow-runs': return <WorkflowRunsWidget />;
  }
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [enabled, setEnabled] = useState<WidgetId[]>(ALL_IDS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Restore from localStorage after mount (SSR-safe)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as WidgetId[];
        if (Array.isArray(parsed)) setEnabled(parsed);
      } catch {}
    }
    setMounted(true);
  }, []);

  const toggle = (id: WidgetId) => {
    setEnabled(prev => {
      const next = prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  if (!mounted) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <p className="font-mono text-xs text-zinc-600 animate-pulse">loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <SubNav tabs={[{ label: 'overview', href: '/dashboard', active: true }, { label: 'costs', href: '/costs', active: false }]} />
          <h1 className="font-mono text-sm text-zinc-100">dashboard</h1>
        </div>
        <button
          onClick={() => setSettingsOpen(s => !s)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono transition-colors ${
            settingsOpen ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          widgets
        </button>
      </header>

      {/* Settings panel */}
      {settingsOpen && (
        <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">show widgets:</span>
            {WIDGET_DEFS.map(w => (
              <label key={w.id} className="flex items-center gap-1.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={enabled.includes(w.id)}
                  onChange={() => toggle(w.id)}
                  className="accent-emerald-500 w-3 h-3"
                />
                <span className="font-mono text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">
                  {w.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Widget grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {enabled.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Settings className="w-8 h-8 text-zinc-800 mb-3" />
            <p className="font-mono text-sm text-zinc-600">no widgets enabled</p>
            <p className="font-mono text-xs text-zinc-700 mt-1">open the widgets panel above to add some</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {enabled.map(id => (
              <div key={id}>{renderWidget(id)}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
