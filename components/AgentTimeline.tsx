'use client';

import React, { useMemo } from 'react';
import type { Agent } from '@/types';

interface Props {
  agents: Agent[];
}

const statusColor: Record<string, string> = {
  running: '#10b981',
  spawning: '#10b981',
  idle: '#eab308',
  done: '#3b82f6',
  error: '#ef4444',
  killed: '#6b7280',
};

function fmtDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function AgentTimeline({ agents }: Props) {
  // Compute bars: each agent gets a horizontal bar showing its duration.
  // Instead of absolute timeline (which gets unreadable with large gaps),
  // show each agent as a proportional bar relative to the longest-running agent.
  const { sorted, maxDuration } = useMemo(() => {
    if (!agents.length) return { sorted: [], maxDuration: 1 };
    const now = Date.now();
    const s = [...agents].sort((a, b) => a.created_at - b.created_at);
    const durations = s.map(a => {
      const isActive = a.status === 'running' || a.status === 'spawning';
      const end = isActive ? now : (a.updated_at > a.created_at ? a.updated_at : a.created_at + 500);
      return end - a.created_at;
    });
    return { sorted: s, maxDuration: Math.max(...durations, 1000) };
  }, [agents]);

  if (!agents.length) {
    return (
      <div className="text-center text-zinc-600 font-mono text-xs py-8">
        no agents yet
      </div>
    );
  }

  // Time axis ticks based on max duration
  const tickCount = Math.min(Math.max(Math.ceil(maxDuration / 1000), 1), 6);
  const tickInterval = maxDuration / tickCount;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => ({
    pct: (i / tickCount) * 100,
    label: fmtDuration(i * tickInterval),
  }));

  const LABEL_WIDTH = 140;

  return (
    <div className="py-4 px-3 select-none">
      {/* Column headers */}
      <div className="flex items-center mb-3 text-[10px] font-mono text-zinc-600" style={{ gap: 8 }}>
        <div style={{ width: LABEL_WIDTH }} className="text-right pr-2">agent</div>
        <div className="flex-1">duration</div>
        <div style={{ width: 70 }} className="text-right">started</div>
        <div style={{ width: 48 }} className="text-right">time</div>
      </div>

      {/* Time axis */}
      <div style={{ paddingLeft: LABEL_WIDTH + 8, paddingRight: 126 }}>
        <div className="relative h-4 mb-1">
          {ticks.map(({ pct, label }, i) => (
            <div
              key={i}
              className="absolute text-[10px] font-mono text-zinc-700"
              style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Agent rows */}
      <div className="space-y-1">
        {sorted.map((agent) => {
          const now = Date.now();
          const isActive = agent.status === 'running' || agent.status === 'spawning';
          const endTime = isActive
            ? now
            : agent.updated_at > agent.created_at
            ? agent.updated_at
            : agent.created_at + 500;
          const duration = endTime - agent.created_at;
          const widthPct = Math.max((duration / maxDuration) * 100, 1);
          const color = statusColor[agent.status] ?? '#6b7280';

          return (
            <div key={agent.id} className="flex items-center group" style={{ gap: 8 }}>
              {/* Agent name */}
              <div className="flex-shrink-0 text-right pr-2" style={{ width: LABEL_WIDTH }}>
                <span className="text-xs font-mono text-zinc-400 truncate block group-hover:text-zinc-200 transition-colors">
                  {agent.name}
                </span>
              </div>

              {/* Bar track */}
              <div className="flex-1 relative rounded" style={{ height: 26, backgroundColor: 'rgba(24,24,27,0.5)' }}>
                {/* Grid lines */}
                {ticks.slice(1, -1).map(({ pct }, i) => (
                  <div key={i} className="absolute top-0 bottom-0 w-px bg-zinc-800/40" style={{ left: `${pct}%` }} />
                ))}

                {/* Bar (always starts at 0 since each bar is relative) */}
                <div
                  className={`absolute top-1 bottom-1 rounded-r transition-all ${isActive ? 'animate-pulse' : ''}`}
                  style={{
                    left: 0,
                    width: `${widthPct}%`,
                    backgroundColor: color + '28',
                    borderLeft: `3px solid ${color}`,
                    borderRight: isActive ? 'none' : `1px solid ${color}50`,
                    minWidth: 6,
                  }}
                >
                  {widthPct > 12 && (
                    <span
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-mono whitespace-nowrap"
                      style={{ color }}
                    >
                      {fmtDuration(duration)}
                    </span>
                  )}
                </div>
              </div>

              {/* Start time */}
              <div className="flex-shrink-0 text-right text-[10px] font-mono text-zinc-600" style={{ width: 70 }}>
                {fmtTime(agent.created_at)}
              </div>

              {/* Duration label */}
              <div className="flex-shrink-0 text-right text-[10px] font-mono whitespace-nowrap" style={{ color, width: 48 }}>
                {fmtDuration(duration)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-5 mt-4" style={{ paddingLeft: LABEL_WIDTH + 8 }}>
        {([
          ['running', 'active'],
          ['done', 'done'],
          ['idle', 'idle'],
          ['error', 'error'],
          ['killed', 'killed'],
        ] as [string, string][]).map(([status, label]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: (statusColor[status] ?? '#6b7280') + '50', border: `1px solid ${statusColor[status] ?? '#6b7280'}80` }}
            />
            <span className="text-[10px] font-mono text-zinc-600">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AgentTimeline;
