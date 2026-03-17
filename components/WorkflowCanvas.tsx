'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { AgentType } from '@/types';

interface WorkflowStep {
  name: string;
  type: AgentType;
  model?: string;
  task: string;
  dependsOn?: string[];
  parallel?: boolean;
  position?: { x: number; y: number };
}

interface CanvasProps {
  steps: WorkflowStep[];
  onChange: (steps: WorkflowStep[]) => void;
  isRunning?: boolean;
  runAgents?: Array<{ stepName: string; agentId: string; status: string }>;
}

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  claude: { bg: '#1e3a5f20', border: '#3b82f640', text: '#60a5fa', dot: '#60a5fa' },
  codex: { bg: '#5c3d1e20', border: '#f59e0b40', text: '#fbbf24', dot: '#fbbf24' },
  custom: { bg: '#4c1d9520', border: '#a855f740', text: '#c084fc', dot: '#c084fc' },
  test: { bg: '#14532d20', border: '#10b98140', text: '#34d399', dot: '#34d399' },
};

const NODE_W = 200;
const NODE_H = 120;
const H_GAP = 240;
const V_GAP = 150;
const HANDLE_R = 6;

function autoLayout(steps: WorkflowStep[]): WorkflowStep[] {
  if (steps.length === 0) return steps;

  // Build adjacency: which steps does each step depend on?
  const nameToIdx = new Map<string, number>();
  steps.forEach((s, i) => nameToIdx.set(s.name, i));

  // Topological layers
  const inDegree = steps.map(() => 0);
  const adj: number[][] = steps.map(() => []);
  steps.forEach((s, i) => {
    (s.dependsOn || []).forEach(dep => {
      const j = nameToIdx.get(dep);
      if (j !== undefined) {
        adj[j].push(i);
        inDegree[i]++;
      }
    });
  });

  const layers: number[][] = [];
  const placed = new Set<number>();
  let queue = steps.map((_, i) => i).filter(i => inDegree[i] === 0);
  if (queue.length === 0) queue = [0]; // fallback

  while (queue.length > 0) {
    layers.push([...queue]);
    queue.forEach(i => placed.add(i));
    const next: number[] = [];
    for (const i of queue) {
      for (const j of adj[i]) {
        inDegree[j]--;
        if (inDegree[j] === 0 && !placed.has(j)) next.push(j);
      }
    }
    queue = next;
  }
  // Place any remaining unplaced nodes
  steps.forEach((_, i) => {
    if (!placed.has(i)) {
      layers.push([i]);
      placed.add(i);
    }
  });

  const result = steps.map(s => ({ ...s }));
  const startX = 60;
  const startY = 60;
  layers.forEach((layer, li) => {
    const totalHeight = layer.length * NODE_H + (layer.length - 1) * (V_GAP - NODE_H);
    const offsetY = startY + Math.max(0, (NODE_H - totalHeight) / 2);
    layer.forEach((idx, vi) => {
      if (!result[idx].position) {
        result[idx].position = {
          x: startX + li * H_GAP,
          y: offsetY + vi * V_GAP,
        };
      }
    });
  });

  return result;
}

export default function WorkflowCanvas({ steps, onChange, isRunning, runAgents }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [connecting, setConnecting] = useState<{ fromIdx: number; mouse: { x: number; y: number } } | null>(null);

  // Auto-layout on first render or when steps lack positions
  useEffect(() => {
    const needsLayout = steps.some(s => !s.position);
    if (needsLayout && steps.length > 0) {
      onChange(autoLayout(steps));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getRunStatus = useCallback((stepName: string) => {
    if (!runAgents) return null;
    return runAgents.find(a => a.stepName === stepName) || null;
  }, [runAgents]);

  // Node drag handlers
  const handleNodeMouseDown = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const step = steps[idx];
    if (!step.position) return;
    setDragIdx(idx);
    setDragOffset({
      x: e.clientX - step.position.x - pan.x,
      y: e.clientY - step.position.y - pan.y,
    });
  }, [steps, pan]);

  useEffect(() => {
    if (dragIdx === null) return;
    const handleMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.x - pan.x;
      const newY = e.clientY - dragOffset.y - pan.y;
      onChange(steps.map((s, i) => i === dragIdx ? { ...s, position: { x: newX, y: newY } } : s));
    };
    const handleUp = () => setDragIdx(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragIdx, dragOffset, pan, steps, onChange]);

  // Pan handlers
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current || e.target === svgRef.current) {
      setSelectedIdx(null);
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  }, [pan]);

  useEffect(() => {
    if (!isPanning) return;
    const handleMove = (e: MouseEvent) => {
      setPan({
        x: panStart.current.panX + (e.clientX - panStart.current.x),
        y: panStart.current.panY + (e.clientY - panStart.current.y),
      });
    };
    const handleUp = () => setIsPanning(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isPanning]);

  // Connection drag
  const handleHandleMouseDown = useCallback((idx: number, side: 'out', e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConnecting({
      fromIdx: idx,
      mouse: { x: e.clientX - rect.left - pan.x, y: e.clientY - rect.top - pan.y },
    });
  }, [pan]);

  useEffect(() => {
    if (!connecting) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const handleMove = (e: MouseEvent) => {
      setConnecting(prev => prev ? {
        ...prev,
        mouse: { x: e.clientX - rect.left - pan.x, y: e.clientY - rect.top - pan.y },
      } : null);
    };
    const handleUp = (e: MouseEvent) => {
      // Check if we dropped on a node's input handle
      const mx = e.clientX - rect.left - pan.x;
      const my = e.clientY - rect.top - pan.y;
      for (let i = 0; i < steps.length; i++) {
        if (i === connecting.fromIdx) continue;
        const pos = steps[i].position;
        if (!pos) continue;
        const hx = pos.x;
        const hy = pos.y + NODE_H / 2;
        if (Math.abs(mx - hx) < 16 && Math.abs(my - hy) < 16) {
          // Add dependency
          const deps = steps[i].dependsOn || [];
          const fromName = steps[connecting.fromIdx].name;
          if (!deps.includes(fromName)) {
            onChange(steps.map((s, si) => si === i ? { ...s, dependsOn: [...deps, fromName] } : s));
          }
          break;
        }
      }
      setConnecting(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [connecting, steps, pan, onChange]);

  const addNode = useCallback(() => {
    const maxX = steps.reduce((mx, s) => Math.max(mx, (s.position?.x || 0)), 0);
    const newStep: WorkflowStep = {
      name: `step-${steps.length + 1}`,
      type: 'claude',
      model: 'sonnet',
      task: '',
      position: { x: maxX + H_GAP, y: 60 },
    };
    onChange([...steps, newStep]);
  }, [steps, onChange]);

  const removeNode = useCallback((idx: number) => {
    const removedName = steps[idx].name;
    // Remove this node and clean up dependencies referencing it
    const next = steps.filter((_, i) => i !== idx).map(s => ({
      ...s,
      dependsOn: s.dependsOn?.filter(d => d !== removedName),
    }));
    onChange(next);
    setSelectedIdx(null);
  }, [steps, onChange]);

  const updateStep = useCallback((idx: number, field: string, value: unknown) => {
    onChange(steps.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }, [steps, onChange]);

  // Compute canvas size
  const canvasSize = useMemo(() => {
    let maxX = 800, maxY = 500;
    steps.forEach(s => {
      if (s.position) {
        maxX = Math.max(maxX, s.position.x + NODE_W + 100);
        maxY = Math.max(maxY, s.position.y + NODE_H + 100);
      }
    });
    return { width: maxX, height: maxY };
  }, [steps]);

  // Build connections from dependsOn
  const connections = useMemo(() => {
    const nameToIdx = new Map<string, number>();
    steps.forEach((s, i) => nameToIdx.set(s.name, i));
    const conns: Array<{ from: number; to: number }> = [];
    steps.forEach((s, i) => {
      (s.dependsOn || []).forEach(dep => {
        const j = nameToIdx.get(dep);
        if (j !== undefined) conns.push({ from: j, to: i });
      });
    });
    return conns;
  }, [steps]);

  const getConnectionColor = useCallback((fromIdx: number, toIdx: number) => {
    if (!isRunning || !runAgents) return '#52525b';
    const fromStatus = getRunStatus(steps[fromIdx].name);
    const toStatus = getRunStatus(steps[toIdx].name);
    if (fromStatus?.status === 'done' && toStatus?.status === 'done') return '#10b981';
    if (fromStatus?.status === 'running' || toStatus?.status === 'running') return '#3b82f6';
    return '#52525b';
  }, [isRunning, runAgents, steps, getRunStatus]);

  const selectedStep = selectedIdx !== null ? steps[selectedIdx] : null;

  return (
    <div className="flex flex-col">
      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative overflow-auto border border-zinc-800 rounded-xl cursor-grab active:cursor-grabbing"
        style={{
          minHeight: 400,
          maxHeight: 500,
          backgroundImage: 'radial-gradient(circle, #27272a 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onMouseDown={handleCanvasMouseDown}
      >
        <div
          style={{
            width: canvasSize.width,
            height: canvasSize.height,
            position: 'relative',
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        >
          {/* SVG layer for connections */}
          <svg
            ref={svgRef}
            className="absolute inset-0 pointer-events-none"
            style={{ width: canvasSize.width, height: canvasSize.height, overflow: 'visible' }}
          >
            <defs>
              <marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8" fill="#52525b" />
              </marker>
              <marker id="canvas-arrow-green" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8" fill="#10b981" />
              </marker>
              <marker id="canvas-arrow-blue" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8" fill="#3b82f6" />
              </marker>
            </defs>

            {connections.map((conn, ci) => {
              const fromPos = steps[conn.from].position;
              const toPos = steps[conn.to].position;
              if (!fromPos || !toPos) return null;

              const x1 = fromPos.x + NODE_W;
              const y1 = fromPos.y + NODE_H / 2;
              const x2 = toPos.x;
              const y2 = toPos.y + NODE_H / 2;
              const midX = (x1 + x2) / 2;
              const color = getConnectionColor(conn.from, conn.to);
              const markerId = color === '#10b981' ? 'canvas-arrow-green'
                : color === '#3b82f6' ? 'canvas-arrow-blue'
                : 'canvas-arrow';

              return (
                <path
                  key={ci}
                  d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  markerEnd={`url(#${markerId})`}
                  strokeDasharray={isRunning ? '6 4' : 'none'}
                  className={isRunning && color === '#3b82f6' ? 'animate-dash' : ''}
                />
              );
            })}

            {/* Temporary connection line while dragging */}
            {connecting && (() => {
              const fromPos = steps[connecting.fromIdx].position;
              if (!fromPos) return null;
              const x1 = fromPos.x + NODE_W;
              const y1 = fromPos.y + NODE_H / 2;
              const midX = (x1 + connecting.mouse.x) / 2;
              return (
                <path
                  d={`M${x1},${y1} C${midX},${y1} ${midX},${connecting.mouse.y} ${connecting.mouse.x},${connecting.mouse.y}`}
                  fill="none"
                  stroke="#71717a"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                />
              );
            })()}
          </svg>

          {/* Nodes */}
          {steps.map((step, idx) => {
            if (!step.position) return null;
            const colors = TYPE_COLORS[step.type] || TYPE_COLORS.claude;
            const isSelected = selectedIdx === idx;
            const isDragging = dragIdx === idx;
            const runStatus = getRunStatus(step.name);

            return (
              <div
                key={idx}
                className="absolute select-none"
                style={{
                  left: step.position.x,
                  top: step.position.y,
                  width: NODE_W,
                  height: NODE_H,
                  zIndex: isDragging ? 50 : isSelected ? 40 : 10,
                }}
              >
                {/* Input handle (left) */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-zinc-600 bg-zinc-900 hover:border-zinc-400 hover:bg-zinc-700 transition-colors z-20 cursor-crosshair"
                  style={{ left: 0 }}
                />

                {/* Output handle (right) */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 rounded-full border-2 border-zinc-600 bg-zinc-900 hover:border-emerald-400 hover:bg-emerald-900 transition-colors z-20 cursor-crosshair"
                  style={{ right: 0 }}
                  onMouseDown={(e) => handleHandleMouseDown(idx, 'out', e)}
                />

                {/* Node card */}
                <div
                  className={`w-full h-full rounded-lg border font-mono cursor-grab active:cursor-grabbing transition-all overflow-hidden ${
                    isSelected
                      ? 'ring-2 ring-emerald-500/50 border-emerald-500/40'
                      : isDragging
                      ? 'opacity-80 border-zinc-600 shadow-xl'
                      : 'border-zinc-700 hover:border-zinc-600'
                  }`}
                  style={{ backgroundColor: '#18181b', borderColor: isSelected ? undefined : colors.border }}
                  onMouseDown={(e) => handleNodeMouseDown(idx, e)}
                  onClick={(e) => { e.stopPropagation(); setSelectedIdx(idx); }}
                >
                  {/* Header row */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60">
                    {/* Step number */}
                    <span
                      className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold text-zinc-950 flex-shrink-0"
                      style={{ backgroundColor: colors.dot }}
                    >
                      {idx + 1}
                    </span>

                    {/* Name */}
                    <span className="text-xs text-zinc-200 truncate flex-1 font-medium">{step.name}</span>

                    {/* Delete on selected */}
                    {isSelected && (
                      <button
                        className="p-0.5 rounded text-zinc-600 hover:text-red-400 transition-colors"
                        onClick={(e) => { e.stopPropagation(); removeNode(idx); }}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5">
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded border"
                      style={{ color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }}
                    >
                      {step.type}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500 bg-zinc-800/40">
                      {step.model || 'sonnet'}
                    </span>
                    {runStatus && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ml-auto ${
                        runStatus.status === 'done' ? 'bg-emerald-500/15 text-emerald-400'
                          : runStatus.status === 'error' || runStatus.status === 'killed' ? 'bg-red-500/15 text-red-400'
                          : 'bg-blue-500/15 text-blue-400'
                      }`}>
                        {runStatus.status}
                      </span>
                    )}
                  </div>

                  {/* Task preview */}
                  <div className="px-3 pb-2">
                    <p className="text-[10px] text-zinc-500 leading-tight line-clamp-2">
                      {step.task || 'no task defined'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Add node button */}
          <button
            className="absolute w-10 h-10 rounded-lg border border-dashed border-zinc-700 hover:border-emerald-500/50 hover:bg-emerald-500/5 flex items-center justify-center transition-all group"
            style={{
              left: steps.length > 0
                ? Math.max(...steps.map(s => (s.position?.x || 0))) + H_GAP
                : 60,
              top: 60 + NODE_H / 2 - 20,
              zIndex: 5,
            }}
            onClick={(e) => { e.stopPropagation(); addNode(); }}
          >
            <Plus className="w-4 h-4 text-zinc-600 group-hover:text-emerald-400 transition-colors" />
          </button>
        </div>
      </div>

      {/* Selected node detail panel */}
      {selectedStep && selectedIdx !== null && (
        <div className="mt-3 border border-zinc-800 rounded-xl bg-zinc-900/80 p-4 font-mono">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">edit node</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => removeNode(selectedIdx)}
                className="text-[10px] text-red-400/70 hover:text-red-400 flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3 h-3" /> delete
              </button>
              <button
                onClick={() => setSelectedIdx(null)}
                className="text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            {/* Name */}
            <div>
              <label className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1 block">name</label>
              <input
                value={selectedStep.name}
                onChange={(e) => {
                  const oldName = selectedStep.name;
                  const newName = e.target.value;
                  // Rename in deps too
                  onChange(steps.map((s, i) => {
                    const updated = i === selectedIdx ? { ...s, name: newName } : { ...s };
                    if (updated.dependsOn) {
                      updated.dependsOn = updated.dependsOn.map(d => d === oldName ? newName : d);
                    }
                    return updated;
                  }));
                }}
                className="w-full h-7 px-2 text-xs bg-zinc-950/60 border border-zinc-800 rounded-md text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-zinc-600"
              />
            </div>

            {/* Model */}
            <div>
              <label className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1 block">model</label>
              <input
                value={selectedStep.model || 'sonnet'}
                onChange={(e) => updateStep(selectedIdx, 'model', e.target.value)}
                className="w-full h-7 px-2 text-xs bg-zinc-950/60 border border-zinc-800 rounded-md text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-zinc-600"
              />
            </div>
          </div>

          {/* Type selector */}
          <div className="mb-3">
            <label className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1 block">type</label>
            <div className="flex items-center gap-1.5">
              {(['claude', 'codex', 'custom', 'test'] as AgentType[]).map(t => {
                const c = TYPE_COLORS[t];
                const isActive = selectedStep.type === t;
                return (
                  <button
                    key={t}
                    onClick={() => updateStep(selectedIdx, 'type', t)}
                    className={`text-[10px] px-2.5 py-1 rounded-md border transition-all ${
                      isActive
                        ? 'border-current font-medium'
                        : 'border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700'
                    }`}
                    style={isActive ? { color: c.text, borderColor: c.border, backgroundColor: c.bg } : undefined}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Task */}
          <div className="mb-3">
            <label className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1 block">task</label>
            <textarea
              value={selectedStep.task}
              onChange={(e) => updateStep(selectedIdx, 'task', e.target.value)}
              placeholder="What should this step do..."
              rows={3}
              className="w-full px-2 py-1.5 text-xs bg-zinc-950/60 border border-zinc-800 rounded-md text-zinc-300 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-zinc-600 placeholder:text-zinc-700"
            />
          </div>

          {/* Dependencies */}
          <div>
            <label className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5 block">
              depends on
              <span className="text-zinc-700 normal-case ml-1">(or drag from output handle to input handle)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {steps.map((s, i) => {
                if (i === selectedIdx) return null;
                const deps = selectedStep.dependsOn || [];
                const isChecked = deps.includes(s.name);
                return (
                  <label key={i} className="flex items-center gap-1.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        const newDeps = e.target.checked
                          ? [...deps, s.name]
                          : deps.filter(d => d !== s.name);
                        updateStep(selectedIdx, 'dependsOn', newDeps.length > 0 ? newDeps : undefined);
                      }}
                      className="w-3 h-3 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors">{s.name}</span>
                  </label>
                );
              })}
              {steps.length <= 1 && (
                <span className="text-[10px] text-zinc-700">no other steps to depend on</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dash animation keyframe */}
      <style jsx>{`
        @keyframes dashMove {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -20; }
        }
        :global(.animate-dash) {
          animation: dashMove 0.8s linear infinite;
        }
      `}</style>
    </div>
  );
}
