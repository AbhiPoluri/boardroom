'use client';

import { useState, useEffect } from 'react';
import { Zap, TrendingUp, Lightbulb, DollarSign } from 'lucide-react';
import { CostChart } from '@/components/CostChart';

interface TokenEntry {
  agent_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface SessionTokens {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

interface ModelBreakdown {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
}

interface CacheInfo {
  read_tokens: number;
  write_tokens: number;
  hit_rate: number;
  savings_usd: number;
}

const TIME_FILTERS = [
  { label: '1h', value: 60 * 60 * 1000 },
  { label: '6h', value: 6 * 60 * 60 * 1000 },
  { label: '24h', value: 24 * 60 * 60 * 1000 },
  { label: 'all', value: 0 },
] as const;

const MODEL_COLORS: Record<string, string> = {
  sonnet: '#3b82f6',
  haiku: '#10b981',
  opus: '#a855f7',
};

function normalizeModelName(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('haiku')) return 'haiku';
  if (lower.includes('sonnet')) return 'sonnet';
  return model;
}

export default function CostsPage() {
  const [session, setSession] = useState<SessionTokens>({ input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 });
  const [perAgent, setPerAgent] = useState<TokenEntry[]>([]);
  const [agents, setAgents] = useState<Record<string, string>>({});
  const [modelBreakdown, setModelBreakdown] = useState<ModelBreakdown[]>([]);
  const [cache, setCache] = useState<CacheInfo>({ read_tokens: 0, write_tokens: 0, hit_rate: 0, savings_usd: 0 });
  const [timeFilter, setTimeFilter] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    const sinceParam = timeFilter > 0 ? `?since=${Date.now() - timeFilter}` : '';
    Promise.all([
      fetch(`/api/tokens${sinceParam}`).then(r => r.json()),
      fetch('/api/agents').then(r => r.json()),
    ]).then(([tokenData, agentData]) => {
      if (tokenData.session) setSession(tokenData.session);
      if (tokenData.modelBreakdown) setModelBreakdown(tokenData.modelBreakdown);
      if (tokenData.cache) setCache(tokenData.cache);

      // Build agent name map
      const nameMap: Record<string, string> = {};
      const agentList = agentData.agents || [];
      agentList.forEach((a: any) => { nameMap[a.id] = a.name; });
      setAgents(nameMap);

      // Build per-agent token entries from filtered token API (not unfiltered agent data)
      const tokens = tokenData.agents || {};
      const entries: TokenEntry[] = Object.entries(tokens).map(([id, t]: [string, any]) => ({
        agent_id: id,
        input_tokens: t.input_tokens || 0,
        output_tokens: t.output_tokens || 0,
        cost_usd: t.cost_usd || 0,
      }));
      setPerAgent(entries);
      setLoading(false);
    }).catch(() => { setError('Failed to load cost data'); setLoading(false); });
  }, [timeFilter]);

  const enriched = perAgent.map(e => {
    let name = agents[e.agent_id];
    if (!name) {
      const match = Object.entries(agents).find(([id]) =>
        id.startsWith(e.agent_id) || e.agent_id.startsWith(id) ||
        id.slice(0, 8) === e.agent_id.slice(0, 8)
      );
      name = match?.[1] || e.agent_id.slice(0, 8);
    }
    return { ...e, agent_name: name };
  });

  const totalModelCost = modelBreakdown.reduce((s, m) => s + m.cost_usd, 0);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <h1 className="font-mono text-sm text-zinc-100">cost dashboard</h1>
        <div className="flex items-center gap-4">
          {/* Time filter */}
          <div className="flex items-center gap-1">
            {TIME_FILTERS.map(tf => (
              <button
                key={tf.label}
                onClick={() => setTimeFilter(tf.value)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  timeFilter === tf.value
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-zinc-600" />
            <span className="text-xs font-mono text-zinc-600">session</span>
            <span className="text-sm font-mono font-bold text-emerald-400">${session.cost_usd.toFixed(4)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-zinc-600" />
            <span className="text-xs font-mono text-zinc-600">tokens</span>
            <span className="text-sm font-mono font-bold text-blue-400">
              {session.total_tokens > 1000000 ? `${(session.total_tokens/1000000).toFixed(1)}M` : session.total_tokens > 1000 ? `${(session.total_tokens/1000).toFixed(1)}k` : session.total_tokens}
            </span>
          </div>
          {perAgent.filter(e => e.input_tokens + e.output_tokens > 0).length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-zinc-600">agents</span>
              <span className="text-sm font-mono font-bold text-amber-400">
                {perAgent.filter(e => e.input_tokens + e.output_tokens > 0).length}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-xs font-mono text-zinc-600 animate-pulse text-center">loading cost data...</div>
        ) : session.total_tokens === 0 && perAgent.length === 0 && !error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <DollarSign className="w-10 h-10 text-zinc-800 mb-4" />
            <h3 className="font-mono text-sm text-zinc-500 mb-1">no cost data yet</h3>
            <p className="font-mono text-xs text-zinc-700">costs appear when agents run</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {error && (
              <div className="mb-4 px-4 py-3 bg-red-950/30 border border-red-900 rounded-lg text-sm text-red-400 font-mono">
                {error}
              </div>
            )}
            {/* Model Breakdown */}
            {modelBreakdown.length > 0 && (
              <div>
                <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider mb-3">cost by model</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  {modelBreakdown.map(m => {
                    const displayName = normalizeModelName(m.model);
                    const color = MODEL_COLORS[displayName] || '#6b7280';
                    return (
                    <div key={m.model} className="p-3 rounded-lg border border-zinc-800 bg-zinc-950">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-[10px] font-mono text-zinc-500">{displayName}</span>
                      </div>
                      <div className="text-lg font-mono font-bold mt-1" style={{ color }}>
                        ${m.cost_usd.toFixed(4)}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-600 mt-0.5">
                        {((m.input_tokens + m.output_tokens) / 1000).toFixed(1)}k tokens
                      </div>
                    </div>
                    );
                  })}
                </div>
                {/* Model proportion bar */}
                {totalModelCost > 0 && (
                  <div>
                    <div className="h-5 rounded-full overflow-hidden bg-zinc-900 flex">
                      {modelBreakdown.map(m => {
                        const dn = normalizeModelName(m.model);
                        return (
                        <div
                          key={m.model}
                          className="h-full transition-all"
                          style={{
                            width: `${Math.max((m.cost_usd / totalModelCost) * 100, 1)}%`,
                            backgroundColor: MODEL_COLORS[dn] || '#6b7280',
                          }}
                          title={`${dn}: $${m.cost_usd.toFixed(4)}`}
                        />
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                      {modelBreakdown.map(m => {
                        const dn = normalizeModelName(m.model);
                        return (
                        <span key={m.model} className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: MODEL_COLORS[dn] || '#6b7280' }} />
                          {dn} ({totalModelCost > 0 ? ((m.cost_usd / totalModelCost) * 100).toFixed(0) : 0}%)
                        </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cache Savings */}
            {(cache.read_tokens > 0 || cache.write_tokens > 0) && (
              <div>
                <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider mb-3">cache performance</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950">
                    <div className="text-[10px] font-mono text-zinc-600">cache hit rate</div>
                    <div className="text-lg font-mono font-bold text-amber-400">
                      {(cache.hit_rate * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950">
                    <div className="text-[10px] font-mono text-zinc-600">cache savings</div>
                    <div className="text-lg font-mono font-bold text-emerald-400">
                      ${cache.savings_usd.toFixed(4)}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950">
                    <div className="text-[10px] font-mono text-zinc-600">cached tokens</div>
                    <div className="text-lg font-mono font-bold text-cyan-400">
                      {cache.read_tokens > 1000 ? `${(cache.read_tokens / 1000).toFixed(1)}k` : cache.read_tokens}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-700 mt-0.5">
                      {cache.write_tokens > 1000 ? `${(cache.write_tokens / 1000).toFixed(1)}k` : cache.write_tokens} written
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider mb-3">per-agent breakdown</h2>
              <CostChart entries={enriched} />
            </div>

            {/* Optimization Suggestions */}
            {(() => {
              const suggestions: Array<{ text: string; savings: string }> = [];

              // High-token sonnet agents
              enriched.forEach(e => {
                const totalTok = e.input_tokens + e.output_tokens;
                const agentModel = modelBreakdown.find(m => normalizeModelName(m.model) === 'sonnet');
                if (totalTok > 50000 && agentModel) {
                  suggestions.push({
                    text: `${e.agent_name} used ${(totalTok / 1000).toFixed(0)}k tokens on sonnet — consider using haiku for simple tasks`,
                    savings: '~60% on those tasks',
                  });
                }
              });

              // Duplicate repos (agents working on same repo)
              const agentList = Object.values(agents);
              if (agentList.length === 0 && enriched.length >= 2) {
                // No repo info available — skip repo-overlap check
              }

              // Low cache hit rate
              if ((cache.read_tokens + cache.write_tokens) > 0 && cache.hit_rate < 0.2) {
                suggestions.push({
                  text: `Low cache hit rate (${(cache.hit_rate * 100).toFixed(1)}%) — running similar tasks sequentially improves caching`,
                  savings: 'up to 10% on repeated context',
                });
              }

              // High session cost
              if (session.cost_usd > 5) {
                suggestions.push({
                  text: `Session cost: $${session.cost_usd.toFixed(2)} — use haiku for research and sonnet for coding to reduce by ~40%`,
                  savings: `~$${(session.cost_usd * 0.4).toFixed(2)}`,
                });
              }

              if (suggestions.length === 0) return null;

              return (
                <div>
                  <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider mb-3">optimization suggestions</h2>
                  <div className="space-y-2">
                    {suggestions.map((s, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                        <Lightbulb className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-[11px] text-zinc-300 leading-relaxed">{s.text}</p>
                          <p className="font-mono text-[10px] text-amber-400/70 mt-1">estimated savings: {s.savings}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Token split */}
            {session.total_tokens > 0 && (
            <div>
              <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider mb-3">token distribution</h2>
              <div className="h-6 rounded-full overflow-hidden bg-zinc-900 flex">
                {session.total_tokens > 0 && (
                  <>
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${(session.input_tokens / session.total_tokens) * 100}%` }}
                      title={`Input: ${session.input_tokens}`}
                    />
                    <div
                      className="h-full bg-purple-500 transition-all"
                      style={{ width: `${(session.output_tokens / session.total_tokens) * 100}%` }}
                      title={`Output: ${session.output_tokens}`}
                    />
                  </>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2">
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
                  <span className="w-2 h-2 rounded-full bg-blue-500" /> input
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
                  <span className="w-2 h-2 rounded-full bg-purple-500" /> output
                </span>
              </div>
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
