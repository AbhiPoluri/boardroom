'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Settings, Zap, GitPullRequest, Bot, DollarSign, Activity, Clock } from 'lucide-react';
import { SubNav } from '@/components/SubNav';
import type { Agent, PushRequest } from '@/types';

// ─── types ───────────────────────────────────────────────────────────────────

interface TokenEntry {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cost_usd: number;
  model?: string;
}

interface WorkflowRun {
  id: string;
  workflow_id?: string;
  status: string;
  started_at: number;
  finished_at?: number;
  error?: string;
}

// ─── widget definitions ──────────────────────────────────────────────────────

const WIDGET_DEFS = [
  { id: 'fleet-overview', label: 'fleet overview' },
  { id: 'cost-breakdown', label: 'cost breakdown' },
  { id: 'activity-feed', label: 'activity feed' },
  { id: 'agent-performance', label: 'agent performance' },
  { id: 'pipeline-health', label: 'pipeline health' },
  { id: 'recent-prs', label: 'recent PRs' },
] as const;

type WidgetId = (typeof WIDGET_DEFS)[number]['id'];

const STORAGE_KEY = 'boardroom:dashboard-widgets';
const ALL_IDS: WidgetId[] = WIDGET_DEFS.map(w => w.id);

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function timeAgo(ts: number): string {
  const now = Date.now();
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const delta = Math.floor((now - ms) / 1000);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function duration(start: number, end?: number): string {
  const s = start < 1e12 ? start * 1000 : start;
  const e = end ? (end < 1e12 ? end * 1000 : end) : Date.now();
  const delta = Math.floor((e - s) / 1000);
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ${delta % 60}s`;
  return `${Math.floor(delta / 3600)}h ${Math.floor((delta % 3600) / 60)}m`;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-[var(--br-bg-hover)] rounded ${className}`} />;
}

const STATUS_COLORS: Record<string, string> = {
  running: 'text-emerald-400',
  spawning: 'text-blue-400',
  done: 'text-zinc-400',
  error: 'text-red-400',
  killed: 'text-amber-400',
  idle: 'text-amber-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  pending: 'text-amber-400',
  approved: 'text-emerald-400',
  rejected: 'text-red-400',
};

const STATUS_BG: Record<string, string> = {
  running: 'bg-emerald-500',
  spawning: 'bg-blue-500',
  done: 'bg-zinc-500',
  error: 'bg-red-500',
  killed: 'bg-amber-500',
  idle: 'bg-amber-500',
};

// ─── card shell ──────────────────────────────────────────────────────────────

function WidgetCard({
  title,
  icon: Icon,
  onRefresh,
  children,
  className = '',
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  onRefresh?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-[var(--br-bg-card)] border border-[var(--br-border)] rounded-lg flex flex-col min-h-[220px] ${className}`}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--br-border)] flex-shrink-0">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-3.5 h-3.5 text-[var(--br-text-muted)]" />}
          <span className="font-mono text-[11px] text-[var(--br-text-secondary)] uppercase tracking-wider">{title}</span>
        </div>
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

// ─── stat pill ───────────────────────────────────────────────────────────────

function StatPill({ label, value, color = 'text-zinc-100' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-2 bg-[var(--br-bg-hover)]/50 rounded-md flex-1 min-w-0 transition-colors duration-300">
      <span className={`font-mono text-lg leading-tight transition-colors duration-300 ${color}`}>{value}</span>
      <span className="font-mono text-[9px] text-[var(--br-text-muted)] uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ─── mini bar chart ──────────────────────────────────────────────────────────

function MiniBar({ value, max, color = 'bg-blue-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1.5 bg-[var(--br-bg-hover)] rounded-full overflow-hidden flex-1">
      <div className={`h-full rounded-full transition-all duration-500 ease-out ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── fleet overview ──────────────────────────────────────────────────────────

function FleetOverviewWidget() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(d => setAgents(d.agents || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 5000); return () => clearInterval(iv); }, [fetch_]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { running: 0, done: 0, error: 0, killed: 0, spawning: 0, idle: 0 };
    agents.forEach(a => { c[a.status] = (c[a.status] || 0) + 1; });
    return c;
  }, [agents]);

  const total = agents.length;
  const active = counts.running + counts.spawning;
  const types = useMemo(() => {
    const t: Record<string, number> = {};
    agents.forEach(a => { t[a.type] = (t[a.type] || 0) + 1; });
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  }, [agents]);

  // Status distribution bar
  const segments = [
    { key: 'running', color: 'bg-emerald-500', count: counts.running },
    { key: 'spawning', color: 'bg-blue-500', count: counts.spawning },
    { key: 'done', color: 'bg-zinc-500', count: counts.done },
    { key: 'error', color: 'bg-red-500', count: counts.error },
    { key: 'killed', color: 'bg-amber-500', count: counts.killed },
  ].filter(s => s.count > 0);

  return (
    <WidgetCard title="fleet overview" icon={Bot} onRefresh={fetch_}>
      {loading ? (
        <div className="space-y-3">
          <div className="flex gap-2"><Skeleton className="h-14 flex-1" /><Skeleton className="h-14 flex-1" /><Skeleton className="h-14 flex-1" /></div>
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Top stats */}
          <div className="flex gap-2">
            <StatPill label="total" value={total} />
            <StatPill label="active" value={active} color={active > 0 ? 'text-emerald-400' : 'text-zinc-500'} />
            <StatPill label="errors" value={counts.error} color={counts.error > 0 ? 'text-red-400' : 'text-zinc-500'} />
          </div>

          {/* Status distribution bar */}
          {total > 0 && (
            <div className="space-y-1.5">
              <div className="h-2.5 bg-[var(--br-bg-hover)] rounded-full overflow-hidden flex">
                {segments.map(s => (
                  <div
                    key={s.key}
                    className={`h-full ${s.color} transition-all`}
                    style={{ width: `${(s.count / total) * 100}%` }}
                    title={`${s.key}: ${s.count}`}
                  />
                ))}
              </div>
              <div className="flex gap-3 flex-wrap">
                {segments.map(s => (
                  <div key={s.key} className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${s.color}`} />
                    <span className="font-mono text-[9px] text-zinc-500">{s.key} {s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agent type breakdown */}
          {types.length > 0 && (
            <div className="space-y-1">
              <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">by type</span>
              {types.map(([type, count]) => (
                <div key={type} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-zinc-400 w-16 truncate">{type}</span>
                  <MiniBar value={count} max={total} color="bg-blue-500" />
                  <span className="font-mono text-[10px] text-zinc-500 w-6 text-right">{count}</span>
                </div>
              ))}
            </div>
          )}

          {total === 0 && <p className="font-mono text-xs text-zinc-600 text-center py-4">no agents spawned yet</p>}
        </div>
      )}
    </WidgetCard>
  );
}

// ─── cost breakdown ──────────────────────────────────────────────────────────

function CostBreakdownWidget() {
  const [tokens, setTokens] = useState<Record<string, TokenEntry>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    Promise.all([
      fetch('/api/tokens').then(r => r.json()),
      fetch('/api/agents').then(r => r.json()),
    ])
      .then(([tokData, agData]) => {
        setTokens(tokData.tokens || {});
        setAgents(agData.agents || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 10000); return () => clearInterval(iv); }, [fetch_]);

  const { totalCost, totalInput, totalOutput, totalCache, topSpenders } = useMemo(() => {
    let cost = 0, input = 0, output = 0, cache = 0;
    const perAgent: { name: string; cost: number; tokens: number }[] = [];

    Object.entries(tokens).forEach(([agentId, t]) => {
      cost += t.cost_usd;
      input += t.input_tokens;
      output += t.output_tokens;
      cache += t.cache_read_tokens || 0;
      const agent = agents.find(a => a.id === agentId);
      perAgent.push({
        name: agent?.name || agentId.slice(0, 8),
        cost: t.cost_usd,
        tokens: t.input_tokens + t.output_tokens,
      });
    });

    perAgent.sort((a, b) => b.cost - a.cost);
    return { totalCost: cost, totalInput: input, totalOutput: output, totalCache: cache, topSpenders: perAgent.slice(0, 5) };
  }, [tokens, agents]);

  const total = totalInput + totalOutput;
  const cacheRatio = totalInput > 0 ? ((totalCache / totalInput) * 100).toFixed(0) : '0';

  return (
    <WidgetCard title="cost breakdown" icon={DollarSign} onRefresh={fetch_}>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-24" />
          <div className="flex gap-2"><Skeleton className="h-12 flex-1" /><Skeleton className="h-12 flex-1" /><Skeleton className="h-12 flex-1" /></div>
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Total cost */}
          <div>
            <p className="font-mono text-3xl text-green-400 leading-tight">{fmtCost(totalCost)}</p>
            <p className="font-mono text-[10px] text-zinc-600 mt-0.5">{fmtTokens(total)} tokens total</p>
          </div>

          {/* Token split */}
          <div className="flex gap-2">
            <StatPill label="input" value={fmtTokens(totalInput)} color="text-blue-400" />
            <StatPill label="output" value={fmtTokens(totalOutput)} color="text-purple-400" />
            <StatPill label="cache hit" value={`${cacheRatio}%`} color={Number(cacheRatio) > 50 ? 'text-emerald-400' : 'text-amber-400'} />
          </div>

          {/* I/O bar */}
          {total > 0 && (
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden flex">
              <div className="h-full bg-blue-500" style={{ width: `${(totalInput / total) * 100}%` }} />
              <div className="h-full bg-purple-500" style={{ width: `${(totalOutput / total) * 100}%` }} />
            </div>
          )}

          {/* Top spenders */}
          {topSpenders.length > 0 && (
            <div className="space-y-1">
              <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">top spenders</span>
              {topSpenders.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-zinc-400 flex-1 truncate">{s.name}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{fmtTokens(s.tokens)}</span>
                  <span className="font-mono text-[10px] text-green-400 w-14 text-right">{fmtCost(s.cost)}</span>
                </div>
              ))}
            </div>
          )}

          {total === 0 && <p className="font-mono text-xs text-zinc-600 text-center py-2">no token usage yet</p>}
        </div>
      )}
    </WidgetCard>
  );
}

// ─── activity feed ───────────────────────────────────────────────────────────

interface FeedItem {
  id: string;
  type: 'agent' | 'pr' | 'workflow';
  title: string;
  subtitle: string;
  status: string;
  time: number;
}

function ActivityFeedWidget() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    Promise.all([
      fetch('/api/agents').then(r => r.json()).catch(() => ({ agents: [] })),
      fetch('/api/push-requests').then(r => r.json()).catch(() => ({ requests: [], pushRequests: [] })),
      fetch('/api/workflows/history').then(r => r.json()).catch(() => ({ runs: [] })),
    ]).then(([agData, prData, wfData]) => {
      const feed: FeedItem[] = [];

      (agData.agents || []).forEach((a: Agent) => {
        feed.push({
          id: `a-${a.id}`,
          type: 'agent',
          title: a.name,
          subtitle: `${a.type} ${a.repo ? '@ ' + a.repo.split('/').pop() : ''}`.trim(),
          status: a.status,
          time: a.updated_at || a.created_at,
        });
      });

      (prData.requests || prData.pushRequests || []).forEach((pr: PushRequest) => {
        feed.push({
          id: `pr-${pr.id}`,
          type: 'pr',
          title: pr.agent_name || pr.branch,
          subtitle: pr.branch,
          status: pr.status,
          time: pr.reviewed_at || pr.created_at,
        });
      });

      (wfData.runs || []).forEach((r: WorkflowRun) => {
        feed.push({
          id: `wf-${r.id}`,
          type: 'workflow',
          title: r.id.slice(0, 8),
          subtitle: r.error || r.status,
          status: r.status,
          time: r.finished_at || r.started_at,
        });
      });

      feed.sort((a, b) => b.time - a.time);
      setItems(feed.slice(0, 15));
    })
    .catch(() => {})
    .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 8000); return () => clearInterval(iv); }, [fetch_]);

  const typeIcon = (type: string) => {
    switch (type) {
      case 'agent': return <Bot className="w-3 h-3" />;
      case 'pr': return <GitPullRequest className="w-3 h-3" />;
      case 'workflow': return <Zap className="w-3 h-3" />;
      default: return <Activity className="w-3 h-3" />;
    }
  };

  return (
    <WidgetCard title="activity feed" icon={Activity} onRefresh={fetch_}>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-2"><Skeleton className="h-4 w-4 rounded" /><Skeleton className="h-4 flex-1" /></div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="font-mono text-xs text-zinc-600 text-center py-4">no activity yet</p>
      ) : (
        <div className="space-y-1">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2 py-1 group">
              <span className={`flex-shrink-0 ${STATUS_COLORS[item.status] || 'text-zinc-500'}`}>
                {typeIcon(item.type)}
              </span>
              <span className="font-mono text-xs text-zinc-300 truncate flex-1">{item.title}</span>
              <span className={`font-mono text-[9px] flex-shrink-0 ${STATUS_COLORS[item.status] || 'text-zinc-600'}`}>
                {item.status}
              </span>
              <span className="font-mono text-[9px] text-zinc-600 flex-shrink-0 w-14 text-right">{timeAgo(item.time)}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

// ─── agent performance ───────────────────────────────────────────────────────

function AgentPerformanceWidget() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tokens, setTokens] = useState<Record<string, TokenEntry>>({});
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    Promise.all([
      fetch('/api/agents').then(r => r.json()),
      fetch('/api/tokens').then(r => r.json()),
    ])
      .then(([agData, tokData]) => {
        setAgents(agData.agents || []);
        setTokens(tokData.tokens || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 10000); return () => clearInterval(iv); }, [fetch_]);

  const ranked = useMemo(() => {
    return agents
      .map(a => {
        const t = tokens[a.id];
        return {
          ...a,
          totalTokens: t ? t.input_tokens + t.output_tokens : 0,
          cost: t?.cost_usd || 0,
          duration: duration(a.created_at, a.status === 'running' ? undefined : a.updated_at),
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 8);
  }, [agents, tokens]);

  const maxTokens = ranked.length > 0 ? ranked[0].totalTokens : 1;

  // Success rate
  const finished = agents.filter(a => ['done', 'error', 'killed'].includes(a.status));
  const successRate = finished.length > 0
    ? Math.round((finished.filter(a => a.status === 'done').length / finished.length) * 100)
    : 0;

  return (
    <WidgetCard title="agent performance" icon={Zap} onRefresh={fetch_}>
      {loading ? (
        <div className="space-y-2">
          <div className="flex gap-2"><Skeleton className="h-12 flex-1" /><Skeleton className="h-12 flex-1" /></div>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex gap-2">
            <StatPill
              label="success rate"
              value={`${successRate}%`}
              color={successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-amber-400' : 'text-red-400'}
            />
            <StatPill label="finished" value={finished.length} />
          </div>

          {/* Token leaderboard */}
          {ranked.length > 0 ? (
            <div className="space-y-1.5">
              <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">by token usage</span>
              {ranked.map(a => (
                <div key={a.id} className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_BG[a.status] || 'bg-zinc-600'}`} />
                    <span className="font-mono text-[10px] text-zinc-300 truncate flex-1">{a.name}</span>
                    <span className="font-mono text-[9px] text-zinc-500 flex-shrink-0">{a.duration}</span>
                    <span className="font-mono text-[9px] text-zinc-400 flex-shrink-0 w-12 text-right">{fmtTokens(a.totalTokens)}</span>
                  </div>
                  <div className="ml-3.5">
                    <MiniBar value={a.totalTokens} max={maxTokens} color={a.status === 'error' ? 'bg-red-500' : 'bg-blue-500'} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-xs text-zinc-600 text-center py-2">no agent data</p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

// ─── pipeline health ─────────────────────────────────────────────────────────

function PipelineHealthWidget() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    fetch('/api/workflows/history')
      .then(r => r.json())
      .then(d => setRuns(d.runs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 15000); return () => clearInterval(iv); }, [fetch_]);

  const { completed, failed, running: runningCount, avgDuration } = useMemo(() => {
    let comp = 0, fail = 0, run = 0, totalDur = 0, durCount = 0;
    runs.forEach(r => {
      if (r.status === 'completed' || r.status === 'done') comp++;
      else if (r.status === 'failed' || r.status === 'error') fail++;
      else if (r.status === 'running') run++;
      if (r.finished_at && r.started_at) {
        const s = r.started_at < 1e12 ? r.started_at * 1000 : r.started_at;
        const e = r.finished_at < 1e12 ? r.finished_at * 1000 : r.finished_at;
        totalDur += (e - s) / 1000;
        durCount++;
      }
    });
    const avg = durCount > 0 ? Math.round(totalDur / durCount) : 0;
    return { completed: comp, failed: fail, running: run, avgDuration: avg };
  }, [runs]);

  const successRate = (completed + failed) > 0
    ? Math.round((completed / (completed + failed)) * 100)
    : 0;

  // Recent run dots (last 20)
  const recentDots = runs.slice(0, 20);

  return (
    <WidgetCard title="pipeline health" icon={Activity} onRefresh={fetch_}>
      {loading ? (
        <div className="space-y-3">
          <div className="flex gap-2"><Skeleton className="h-12 flex-1" /><Skeleton className="h-12 flex-1" /><Skeleton className="h-12 flex-1" /></div>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            <StatPill
              label="success"
              value={`${successRate}%`}
              color={successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-amber-400' : 'text-red-400'}
            />
            <StatPill label="runs" value={runs.length} />
            <StatPill label="avg time" value={avgDuration > 60 ? `${Math.round(avgDuration / 60)}m` : `${avgDuration}s`} color="text-blue-400" />
          </div>

          {/* Run history dots */}
          {recentDots.length > 0 && (
            <div className="space-y-1.5">
              <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">recent runs</span>
              <div className="flex gap-1 flex-wrap">
                {recentDots.map((r, i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-sm ${
                      (r.status === 'completed' || r.status === 'done') ? 'bg-emerald-500/80' :
                      (r.status === 'failed' || r.status === 'error') ? 'bg-red-500/80' :
                      r.status === 'running' ? 'bg-blue-500/80 animate-pulse' :
                      'bg-zinc-700'
                    }`}
                    title={`${r.status} ${timeAgo(r.started_at)}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recent runs list */}
          {runs.length > 0 ? (
            <div className="space-y-1">
              <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">latest</span>
              {runs.slice(0, 5).map(r => (
                <div key={r.id} className="flex items-center gap-2">
                  <span className={`font-mono text-[9px] flex-shrink-0 ${STATUS_COLORS[r.status] || 'text-zinc-500'}`}>
                    {r.status}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400 truncate flex-1">
                    {r.id.slice(0, 8)}
                  </span>
                  {r.finished_at && r.started_at && (
                    <span className="font-mono text-[9px] text-zinc-600 flex-shrink-0">
                      {duration(r.started_at, r.finished_at)}
                    </span>
                  )}
                  <span className="font-mono text-[9px] text-zinc-600 flex-shrink-0">{timeAgo(r.started_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-xs text-zinc-600 text-center py-2">no workflow runs</p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

// ─── recent PRs ──────────────────────────────────────────────────────────────

function RecentPRsWidget() {
  const [prs, setPrs] = useState<PushRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(() => {
    fetch('/api/push-requests')
      .then(r => r.json())
      .then(d => setPrs((d.requests || d.pushRequests || []).slice(0, 8)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 15000); return () => clearInterval(iv); }, [fetch_]);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0 };
    prs.forEach(pr => { if (pr.status in c) c[pr.status as keyof typeof c]++; });
    return c;
  }, [prs]);

  const badgeStyle = (s: string) =>
    s === 'approved' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    : s === 'rejected' ? 'text-red-400 bg-red-500/10 border-red-500/20'
    : 'text-amber-400 bg-amber-500/10 border-amber-500/20';

  return (
    <WidgetCard title="recent PRs" icon={GitPullRequest} onRefresh={fetch_}>
      {loading ? (
        <div className="space-y-2">
          <div className="flex gap-2"><Skeleton className="h-12 flex-1" /><Skeleton className="h-12 flex-1" /><Skeleton className="h-12 flex-1" /></div>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            <StatPill label="pending" value={counts.pending} color={counts.pending > 0 ? 'text-amber-400' : 'text-zinc-500'} />
            <StatPill label="approved" value={counts.approved} color="text-emerald-400" />
            <StatPill label="rejected" value={counts.rejected} color={counts.rejected > 0 ? 'text-red-400' : 'text-zinc-500'} />
          </div>

          {prs.length > 0 ? (
            <div className="space-y-2">
              {prs.map(pr => (
                <div key={pr.id} className="flex items-start gap-2">
                  <span className={`flex-shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded border ${badgeStyle(pr.status)}`}>
                    {pr.status}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-zinc-300 truncate">{pr.agent_name}</p>
                    <p className="font-mono text-[10px] text-zinc-600 truncate">{pr.branch}</p>
                  </div>
                  <span className="font-mono text-[9px] text-zinc-600 flex-shrink-0">{timeAgo(pr.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-xs text-zinc-600 text-center py-2">no push requests</p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

// ─── widget renderer ─────────────────────────────────────────────────────────

function renderWidget(id: WidgetId) {
  switch (id) {
    case 'fleet-overview': return <FleetOverviewWidget />;
    case 'cost-breakdown': return <CostBreakdownWidget />;
    case 'activity-feed': return <ActivityFeedWidget />;
    case 'agent-performance': return <AgentPerformanceWidget />;
    case 'pipeline-health': return <PipelineHealthWidget />;
    case 'recent-prs': return <RecentPRsWidget />;
  }
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [enabled, setEnabled] = useState<WidgetId[]>(ALL_IDS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as WidgetId[];
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(id => ALL_IDS.includes(id));
          if (valid.length > 0) {
            setEnabled(valid);
          } else {
            // Old IDs from previous widget set — reset to all
            localStorage.setItem(STORAGE_KEY, JSON.stringify(ALL_IDS));
          }
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
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
      <div className="flex-1 overflow-y-auto p-6 bg-zinc-950">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[220px] rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950 text-zinc-100">
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

      <div className="flex-1 overflow-y-auto p-6">
        {enabled.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Settings className="w-8 h-8 text-zinc-800 mb-3" />
            <p className="font-mono text-sm text-zinc-600">no widgets enabled</p>
            <p className="font-mono text-xs text-zinc-700 mt-1">open the widgets panel above to add some</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ALL_IDS.filter(id => enabled.includes(id)).map(id => (
              <div key={id}>{renderWidget(id)}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
