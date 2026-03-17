'use client';

interface CostEntry {
  agent_id: string;
  agent_name?: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface CostChartProps {
  entries: CostEntry[];
}

export function CostChart({ entries }: CostChartProps) {
  if (entries.length === 0) {
    return <div className="p-4 text-xs font-mono text-zinc-600">no token usage data</div>;
  }

  const maxCost = Math.max(...entries.map(e => e.cost_usd), 0.001);
  const totalCost = entries.reduce((sum, e) => sum + e.cost_usd, 0);
  const totalInput = entries.reduce((sum, e) => sum + e.input_tokens, 0);
  const totalOutput = entries.reduce((sum, e) => sum + e.output_tokens, 0);

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950">
          <div className="text-[10px] font-mono text-zinc-600">total cost</div>
          <div className="text-lg font-mono font-bold text-emerald-400">${totalCost.toFixed(4)}</div>
        </div>
        <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950">
          <div className="text-[10px] font-mono text-zinc-600">input tokens</div>
          <div className="text-lg font-mono font-bold text-blue-400">{(totalInput / 1000).toFixed(1)}k</div>
        </div>
        <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950">
          <div className="text-[10px] font-mono text-zinc-600">output tokens</div>
          <div className="text-lg font-mono font-bold text-purple-400">{(totalOutput / 1000).toFixed(1)}k</div>
        </div>
      </div>

      {/* Per-agent bars */}
      <div className="space-y-1.5">
        {entries.sort((a, b) => b.cost_usd - a.cost_usd).map((entry) => (
          <div key={entry.agent_id} className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-zinc-400 w-28 truncate text-right">{entry.agent_name || entry.agent_id.slice(0, 8)}</span>
            <div className="flex-1 h-5 bg-zinc-900 rounded overflow-hidden relative">
              <div
                className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 rounded transition-all duration-500"
                style={{ width: `${Math.max((entry.cost_usd / maxCost) * 100, 2)}%` }}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] text-zinc-400">
                ${entry.cost_usd.toFixed(4)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
