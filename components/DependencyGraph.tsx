'use client';

import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

const statusLabel: Record<string, string> = {
  running: 'running',
  spawning: 'spawning',
  idle: 'idle',
  done: 'done',
  error: 'error',
  killed: 'killed',
};

export function DependencyGraph({ agents }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [arrows, setArrows] = useState<Array<{ from: { x: number; y: number }; to: { x: number; y: number }; color: string }>>([]);

  // Parse depends_on from agents
  const dependencyMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const agent of agents) {
      const depsField = agent.depends_on;
      if (depsField && typeof depsField === 'string') {
        map.set(agent.id, depsField.split(',').filter(Boolean));
      }
    }
    return map;
  }, [agents]);

  const hasDependencies = dependencyMap.size > 0;

  const layers = useMemo(() => {
    if (!agents.length) return [];
    const sorted = [...agents].sort((a, b) => a.created_at - b.created_at);
    const groups: Agent[][] = [];
    let current: Agent[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].created_at - sorted[i - 1].created_at < 5000) {
        current.push(sorted[i]);
      } else {
        groups.push(current);
        current = [sorted[i]];
      }
    }
    groups.push(current);
    return groups;
  }, [agents]);

  // Calculate arrow positions after render
  useEffect(() => {
    if (!hasDependencies || !containerRef.current) return;

    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const newArrows: typeof arrows = [];

      for (const [agentId, deps] of dependencyMap) {
        const toNode = nodeRefs.current.get(agentId);
        if (!toNode) continue;
        const toRect = toNode.getBoundingClientRect();

        for (const depId of deps) {
          const fromNode = nodeRefs.current.get(depId);
          if (!fromNode) continue;
          const fromRect = fromNode.getBoundingClientRect();

          const fromAgent = agents.find(a => a.id === depId);
          const color = fromAgent ? (statusColor[fromAgent.status] || '#6b7280') : '#6b7280';

          newArrows.push({
            from: {
              x: fromRect.right - containerRect.left,
              y: fromRect.top + fromRect.height / 2 - containerRect.top,
            },
            to: {
              x: toRect.left - containerRect.left,
              y: toRect.top + toRect.height / 2 - containerRect.top,
            },
            color,
          });
        }
      }

      setArrows(newArrows);
    }, 100);

    return () => clearTimeout(timer);
  }, [agents, dependencyMap, hasDependencies]);

  if (!agents.length) {
    return (
      <div className="text-center text-zinc-600 font-mono text-xs py-8">
        no agents spawned yet
      </div>
    );
  }

  return (
    <div className="py-4 px-3 overflow-x-auto relative" ref={containerRef}>
      {/* Dependency arrows SVG overlay */}
      {arrows.length > 0 && (
        <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          <defs>
            <marker id="dep-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6" fill="#f59e0b" />
            </marker>
          </defs>
          {arrows.map((arrow, i) => {
            const midX = (arrow.from.x + arrow.to.x) / 2;
            return (
              <path
                key={i}
                d={`M${arrow.from.x},${arrow.from.y} C${midX},${arrow.from.y} ${midX},${arrow.to.y} ${arrow.to.x},${arrow.to.y}`}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                markerEnd="url(#dep-arrow)"
                opacity={0.6}
              />
            );
          })}
        </svg>
      )}

      <div className="flex items-start gap-0 min-w-max">
        {layers.map((layer, li) => (
          <React.Fragment key={li}>
            {/* Arrow connector between layers */}
            {li > 0 && (
              <div className="flex items-center self-center flex-shrink-0 px-1" style={{ marginTop: '20px' }}>
                <div className="w-6 h-px bg-zinc-700" />
                <div
                  className="flex-shrink-0"
                  style={{
                    width: 0,
                    height: 0,
                    borderTop: '5px solid transparent',
                    borderBottom: '5px solid transparent',
                    borderLeft: '6px solid #52525b',
                  }}
                />
              </div>
            )}

            {/* Layer column */}
            <div className="flex flex-col items-center gap-2 flex-shrink-0">
              {/* Batch label */}
              <div className="text-[10px] font-mono text-zinc-600 mb-0.5 h-4">
                {li === 0 ? 'initial' : `batch ${li + 1}`}
              </div>

              {/* Agent nodes */}
              <div className="flex flex-col gap-2">
                {layer.map((agent, ai) => {
                  const color = statusColor[agent.status] ?? '#6b7280';
                  const isActive = agent.status === 'running' || agent.status === 'spawning';
                  const isError = agent.status === 'error' || agent.status === 'killed';
                  const hasDeps = dependencyMap.has(agent.id);
                  const isDep = Array.from(dependencyMap.values()).some(deps => deps.includes(agent.id));
                  const isNotLast = ai < layer.length - 1;

                  return (
                    <div key={agent.id} className="relative flex flex-col items-center">
                      <button
                        ref={el => { if (el) nodeRefs.current.set(agent.id, el); }}
                        onClick={() => router.push(`/agents/${agent.id}`)}
                        className={[
                          'relative flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border transition-all text-left min-w-[168px]',
                          'hover:scale-[1.02] active:scale-[0.99]',
                          isActive
                            ? 'border-emerald-500/40 bg-emerald-500/5 shadow-[0_0_14px_rgba(16,185,129,0.1)]'
                            : isError
                            ? 'border-red-500/30 bg-red-500/5'
                            : hasDeps || isDep
                            ? 'border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50'
                            : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
                        ].join(' ')}
                      >
                        {isActive && (
                          <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        )}

                        {/* Dependency indicator */}
                        {hasDeps && (
                          <span className="absolute -top-1 -left-1 w-3 h-3 rounded-full bg-amber-500 flex items-center justify-center">
                            <svg width="7" height="7" viewBox="0 0 7 7"><path d="M1 3.5h5M3.5 1v5" stroke="#000" strokeWidth="1.2" /></svg>
                          </span>
                        )}

                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />

                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-mono text-zinc-200 truncate leading-tight">
                            {agent.name}
                          </span>
                          <span
                            className="text-[10px] font-mono truncate leading-tight mt-0.5"
                            style={{ color }}
                          >
                            {statusLabel[agent.status] ?? agent.status}
                          </span>
                        </div>
                      </button>

                      {isNotLast && (
                        <div className="w-px h-2 bg-zinc-700 flex-shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default DependencyGraph;
