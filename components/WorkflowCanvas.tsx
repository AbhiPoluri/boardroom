'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Plus, Trash2, X, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, LayoutGrid, Copy } from 'lucide-react';
import type { AgentType } from '@/types';

interface WorkflowStep {
  name: string;
  type: AgentType;
  model?: string;
  task: string;
  dependsOn?: string[];
  parallel?: boolean;
  position?: { x: number; y: number };
  stepType?: 'standard' | 'evaluator' | 'router';
  maxRetries?: number;
  routes?: string[];
  agentConfig?: string;
}

interface AgentConfigOption {
  slug: string;
  name: string;
  type: string;
  model?: string;
  description: string;
}

interface CanvasProps {
  steps: WorkflowStep[];
  onChange: (steps: WorkflowStep[]) => void;
  isRunning?: boolean;
  runAgents?: Array<{ stepName: string; agentId: string; status: string }>;
  stepOutputs?: Record<string, string>;
  agentConfigs?: AgentConfigOption[];
}

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  claude: { bg: '#1e3a5f20', border: '#3b82f640', text: '#60a5fa', dot: '#60a5fa' },
  codex: { bg: '#5c3d1e20', border: '#f59e0b40', text: '#fbbf24', dot: '#fbbf24' },
  opencode: { bg: '#1e3a2f20', border: '#22c55e40', text: '#4ade80', dot: '#4ade80' },
  custom: { bg: '#4c1d9520', border: '#a855f740', text: '#c084fc', dot: '#c084fc' },
  test: { bg: '#14532d20', border: '#10b98140', text: '#34d399', dot: '#34d399' },
};

const NODE_W = 200;
const NODE_H = 120;
const H_GAP = 240;
const V_GAP = 150;
const GRID_SIZE = 20;
const MAX_HISTORY = 30;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

function snapToGrid(val: number): number {
  return Math.round(val / GRID_SIZE) * GRID_SIZE;
}

function deepCloneSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map(s => ({
    ...s,
    dependsOn: s.dependsOn ? [...s.dependsOn] : undefined,
    position: s.position ? { ...s.position } : undefined,
  }));
}

/** Detect if adding edge from -> to would create a cycle */
function wouldCreateCycle(steps: WorkflowStep[], fromName: string, toIdx: number): boolean {
  const toName = steps[toIdx].name;
  // If from === to, it's a self-loop
  if (fromName === toName) return true;

  // BFS from fromName backwards through dependsOn to see if we can reach toName
  // i.e., check if toName is an ancestor of fromName
  const nameToStep = new Map<string, WorkflowStep>();
  steps.forEach(s => nameToStep.set(s.name, s));

  // We need to check: if we add toName depends on fromName,
  // does fromName already (transitively) depend on toName?
  const visited = new Set<string>();
  const queue = [fromName];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === toName) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const step = nameToStep.get(cur);
    if (step?.dependsOn) {
      for (const dep of step.dependsOn) {
        if (!visited.has(dep)) queue.push(dep);
      }
    }
  }
  return false;
}

function autoLayout(steps: WorkflowStep[]): WorkflowStep[] {
  if (steps.length === 0) return steps;

  const nameToIdx = new Map<string, number>();
  steps.forEach((s, i) => nameToIdx.set(s.name, i));

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
  if (queue.length === 0) queue = [0];

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
    layer.forEach((idx, vi) => {
      result[idx].position = {
        x: snapToGrid(startX + li * H_GAP),
        y: snapToGrid(startY + vi * V_GAP),
      };
    });
  });

  return result;
}

/** Get bezier midpoint for a cubic bezier */
function bezierMidpoint(x1: number, y1: number, cx1: number, cy1: number, cx2: number, cy2: number, x2: number, y2: number) {
  const t = 0.5;
  const mt = 1 - t;
  return {
    x: mt * mt * mt * x1 + 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t * t * t * x2,
    y: mt * mt * mt * y1 + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t * y2,
  };
}

export default function WorkflowCanvas({ steps, onChange, isRunning, runAgents, stepOutputs, agentConfigs }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasFocusRef = useRef<HTMLDivElement>(null);

  // Selection: supports multi-select
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [connecting, setConnecting] = useState<{ fromIdx: number; mouse: { x: number; y: number } } | null>(null);

  // Output viewer
  const [viewingOutput, setViewingOutput] = useState<string | null>(null);

  // Zoom
  const [zoom, setZoom] = useState(1);

  // Undo/redo
  const [undoStack, setUndoStack] = useState<WorkflowStep[][]>([]);
  const [redoStack, setRedoStack] = useState<WorkflowStep[][]>([]);
  const lastPushedRef = useRef<string>('');

  // Connection hover/delete
  const [hoveredConn, setHoveredConn] = useState<number | null>(null);
  const [connDeleteIdx, setConnDeleteIdx] = useState<number | null>(null);
  const [invalidFlash, setInvalidFlash] = useState<{ fromIdx: number; toIdx: number } | null>(null);

  // Tooltip
  const [tooltip, setTooltip] = useState<{ x: number; y: number; step: WorkflowStep; runStatus: { stepName: string; agentId: string; status: string } | null; startTime?: number } | null>(null);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push to undo stack on meaningful changes
  const pushUndo = useCallback((prevSteps: WorkflowStep[]) => {
    const key = JSON.stringify(prevSteps.map(s => ({ n: s.name, t: s.type, m: s.model, tk: s.task, d: s.dependsOn, p: s.position })));
    if (key === lastPushedRef.current) return;
    lastPushedRef.current = key;
    setUndoStack(prev => {
      const next = [...prev, deepCloneSteps(prevSteps)];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setRedoStack([]);
  }, []);

  // Wrapped onChange that tracks undo
  const handleChange = useCallback((newSteps: WorkflowStep[]) => {
    pushUndo(steps);
    onChange(newSteps);
  }, [steps, onChange, pushUndo]);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    setRedoStack(s => [...s, deepCloneSteps(steps)]);
    lastPushedRef.current = '';
    onChange(prev);
  }, [undoStack, steps, onChange]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(s => s.slice(0, -1));
    setUndoStack(s => [...s, deepCloneSteps(steps)]);
    lastPushedRef.current = '';
    onChange(next);
  }, [redoStack, steps, onChange]);

  // selectedIdx for backward compat (first selected)
  const selectedIdx = useMemo(() => {
    const arr = Array.from(selectedIds);
    return arr.length === 1 ? arr[0] : null;
  }, [selectedIds]);

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

  // Node drag handlers with snap-to-grid
  const handleNodeMouseDown = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const step = steps[idx];
    if (!step.position) return;
    setDragIdx(idx);
    setDragOffset({
      x: e.clientX / zoom - step.position.x - pan.x / zoom,
      y: e.clientY / zoom - step.position.y - pan.y / zoom,
    });
    // Focus canvas for keyboard shortcuts
    canvasFocusRef.current?.focus();
  }, [steps, pan, zoom]);

  // Track drag start for undo
  const dragStartSteps = useRef<WorkflowStep[] | null>(null);

  useEffect(() => {
    if (dragIdx === null) return;
    if (!dragStartSteps.current) {
      dragStartSteps.current = deepCloneSteps(steps);
    }
    const handleMove = (e: MouseEvent) => {
      const newX = snapToGrid(e.clientX / zoom - dragOffset.x - pan.x / zoom);
      const newY = snapToGrid(e.clientY / zoom - dragOffset.y - pan.y / zoom);
      onChange(steps.map((s, i) => i === dragIdx ? { ...s, position: { x: newX, y: newY } } : s));
    };
    const handleUp = () => {
      if (dragStartSteps.current) {
        pushUndo(dragStartSteps.current);
        dragStartSteps.current = null;
      }
      setDragIdx(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragIdx, dragOffset, pan, steps, onChange, zoom, pushUndo]);

  // Pan handlers
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current || e.target === svgRef.current ||
        (e.target as HTMLElement).dataset?.canvasBg === 'true') {
      if (!e.shiftKey) {
        setSelectedIds(new Set());
      }
      setConnDeleteIdx(null);
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      canvasFocusRef.current?.focus();
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

  // Connection drag with cycle validation
  const handleHandleMouseDown = useCallback((idx: number, side: 'out', e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConnecting({
      fromIdx: idx,
      mouse: { x: (e.clientX - rect.left - pan.x) / zoom, y: (e.clientY - rect.top - pan.y) / zoom },
    });
  }, [pan, zoom]);

  useEffect(() => {
    if (!connecting) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const handleMove = (e: MouseEvent) => {
      setConnecting(prev => prev ? {
        ...prev,
        mouse: { x: (e.clientX - rect.left - pan.x) / zoom, y: (e.clientY - rect.top - pan.y) / zoom },
      } : null);
    };
    const handleUp = (e: MouseEvent) => {
      const mx = (e.clientX - rect.left - pan.x) / zoom;
      const my = (e.clientY - rect.top - pan.y) / zoom;
      for (let i = 0; i < steps.length; i++) {
        if (i === connecting.fromIdx) continue;
        const pos = steps[i].position;
        if (!pos) continue;
        const hx = pos.x;
        const hy = pos.y + NODE_H / 2;
        if (Math.abs(mx - hx) < 16 && Math.abs(my - hy) < 16) {
          const fromName = steps[connecting.fromIdx].name;
          // Self-connection check
          if (fromName === steps[i].name) {
            setInvalidFlash({ fromIdx: connecting.fromIdx, toIdx: i });
            setTimeout(() => setInvalidFlash(null), 600);
            break;
          }
          // Cycle check
          if (wouldCreateCycle(steps, fromName, i)) {
            setInvalidFlash({ fromIdx: connecting.fromIdx, toIdx: i });
            setTimeout(() => setInvalidFlash(null), 600);
            break;
          }
          const deps = steps[i].dependsOn || [];
          if (!deps.includes(fromName)) {
            handleChange(steps.map((s, si) => si === i ? { ...s, dependsOn: [...deps, fromName] } : s));
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
  }, [connecting, steps, pan, zoom, handleChange]);

  const addNode = useCallback(() => {
    const maxX = steps.reduce((mx, s) => Math.max(mx, (s.position?.x || 0)), 0);
    const newStep: WorkflowStep = {
      name: `step-${steps.length + 1}`,
      type: 'claude',
      model: 'sonnet',
      task: '',
      position: { x: snapToGrid(maxX + H_GAP), y: snapToGrid(60) },
    };
    handleChange([...steps, newStep]);
  }, [steps, handleChange]);

  const removeNode = useCallback((idx: number) => {
    if (!confirm('Delete this step?')) return;
    const removedName = steps[idx].name;
    const next = steps.filter((_, i) => i !== idx).map(s => ({
      ...s,
      dependsOn: s.dependsOn?.filter(d => d !== removedName),
    }));
    handleChange(next);
    setSelectedIds(new Set());
  }, [steps, handleChange]);

  const removeNodes = useCallback((indices: Set<number>) => {
    const removedNames = new Set(Array.from(indices).map(i => steps[i].name));
    const next = steps.filter((_, i) => !indices.has(i)).map(s => ({
      ...s,
      dependsOn: s.dependsOn?.filter(d => !removedNames.has(d)),
    }));
    handleChange(next);
    setSelectedIds(new Set());
  }, [steps, handleChange]);

  const duplicateNode = useCallback((idx: number) => {
    const orig = steps[idx];
    const newStep: WorkflowStep = {
      ...orig,
      name: `${orig.name} (copy)`,
      dependsOn: orig.dependsOn ? [...orig.dependsOn] : undefined,
      position: orig.position ? {
        x: snapToGrid(orig.position.x + 40),
        y: snapToGrid(orig.position.y + 40),
      } : undefined,
    };
    handleChange([...steps, newStep]);
    setSelectedIds(new Set([steps.length]));
  }, [steps, handleChange]);

  const updateStep = useCallback((idx: number, field: string, value: unknown) => {
    handleChange(steps.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }, [steps, handleChange]);

  const handleAutoLayout = useCallback(() => {
    handleChange(autoLayout(steps.map(s => ({ ...s, position: undefined }))));
  }, [steps, handleChange]);

  const removeConnection = useCallback((connIdx: number) => {
    const conn = connections[connIdx];
    if (!conn) return;
    const targetStep = steps[conn.to];
    const fromName = steps[conn.from].name;
    const newDeps = (targetStep.dependsOn || []).filter(d => d !== fromName);
    handleChange(steps.map((s, i) => i === conn.to ? { ...s, dependsOn: newDeps.length > 0 ? newDeps : undefined } : s));
    setConnDeleteIdx(null);
    setHoveredConn(null);
  }, [steps, handleChange]);

  // Zoom handlers
  const zoomIn = useCallback(() => setZoom(z => Math.min(z + ZOOM_STEP, MAX_ZOOM)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(z - ZOOM_STEP, MIN_ZOOM)), []);
  const fitToView = useCallback(() => {
    if (steps.length === 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    steps.forEach(s => {
      if (s.position) {
        minX = Math.min(minX, s.position.x);
        minY = Math.min(minY, s.position.y);
        maxX = Math.max(maxX, s.position.x + NODE_W);
        maxY = Math.max(maxY, s.position.y + NODE_H);
      }
    });
    if (minX === Infinity) return;
    const contentW = maxX - minX + 80;
    const contentH = maxY - minY + 80;
    const scaleX = rect.width / contentW;
    const scaleY = rect.height / contentH;
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_ZOOM), MAX_ZOOM);
    setZoom(newZoom);
    setPan({
      x: (rect.width - contentW * newZoom) / 2 - minX * newZoom + 40 * newZoom,
      y: (rect.height - contentH * newZoom) / 2 - minY * newZoom + 40 * newZoom,
    });
  }, [steps]);

  // Cmd+scroll = zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setZoom(z => Math.min(Math.max(z + delta, MIN_ZOOM), MAX_ZOOM));
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Keyboard shortcuts (Cmd+Z, Cmd+Shift+Z, Cmd+A, Backspace/Delete)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't fire when editing inputs/textareas
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const meta = e.metaKey || e.ctrlKey;

    // Cmd+Z / Cmd+Shift+Z
    if (meta && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if (meta && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      redo();
      return;
    }
    // Cmd+A select all
    if (meta && e.key === 'a') {
      e.preventDefault();
      setSelectedIds(new Set(steps.map((_, i) => i)));
      return;
    }
    // Backspace/Delete
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (selectedIds.size > 0) {
        e.preventDefault();
        removeNodes(selectedIds);
      }
      return;
    }
    // Escape deselect
    if (e.key === 'Escape') {
      setSelectedIds(new Set());
      setConnDeleteIdx(null);
    }
  }, [undo, redo, steps, selectedIds, removeNodes]);

  useEffect(() => {
    const el = canvasFocusRef.current;
    if (!el) return;
    el.addEventListener('keydown', handleKeyDown as EventListener);
    return () => el.removeEventListener('keydown', handleKeyDown as EventListener);
  }, [handleKeyDown]);

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

  // Right-click context menu for duplicate
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  const handleContextMenu = useCallback((idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, idx });
  }, []);

  // Close context menu on click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // Node hover tooltip
  const handleNodeMouseEnter = useCallback((step: WorkflowStep, e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    tooltipTimeout.current = setTimeout(() => {
      setTooltip({
        x: e.clientX - rect.left + 12,
        y: e.clientY - rect.top - 10,
        step,
        runStatus: getRunStatus(step.name),
      });
    }, 500);
  }, [getRunStatus]);

  const handleNodeMouseLeave = useCallback(() => {
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    setTooltip(null);
  }, []);

  // Mini-map data
  const miniMap = useMemo(() => {
    if (steps.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    steps.forEach(s => {
      if (s.position) {
        minX = Math.min(minX, s.position.x);
        minY = Math.min(minY, s.position.y);
        maxX = Math.max(maxX, s.position.x + NODE_W);
        maxY = Math.max(maxY, s.position.y + NODE_H);
      }
    });
    if (minX === Infinity) return null;
    const pad = 40;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [steps]);

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={undoStack.length === 0}
            className="p-1.5 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            title="Undo (Cmd+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={redoStack.length === 0}
            className="p-1.5 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            title="Redo (Cmd+Shift+Z)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <button
            onClick={handleAutoLayout}
            className="p-1.5 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-all"
            title="Auto-layout"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-600 font-mono">
          {selectedIds.size > 1 && (
            <span className="mr-2 text-zinc-500">{selectedIds.size} selected</span>
          )}
          <span>{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={(el) => {
          (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          (canvasFocusRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        tabIndex={0}
        className="relative overflow-auto border border-zinc-800 rounded-xl cursor-grab active:cursor-grabbing outline-none"
        style={{
          minHeight: 400,
          maxHeight: 500,
          backgroundImage: 'radial-gradient(circle, #27272a 1px, transparent 1px)',
          backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onMouseDown={handleCanvasMouseDown}
      >
        <div
          data-canvas-bg="true"
          style={{
            width: canvasSize.width * zoom,
            height: canvasSize.height * zoom,
            position: 'relative',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {/* SVG layer for connections */}
          <svg
            ref={svgRef}
            className="absolute inset-0"
            style={{ width: canvasSize.width, height: canvasSize.height, overflow: 'visible', pointerEvents: 'none' }}
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
              <marker id="canvas-arrow-red" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8" fill="#ef4444" />
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

              const isHovered = hoveredConn === ci;
              const isFlashing = invalidFlash && invalidFlash.fromIdx === conn.from && invalidFlash.toIdx === conn.to;
              const color = isFlashing ? '#ef4444' : getConnectionColor(conn.from, conn.to);
              const markerId = isFlashing ? 'canvas-arrow-red'
                : color === '#10b981' ? 'canvas-arrow-green'
                : color === '#3b82f6' ? 'canvas-arrow-blue'
                : 'canvas-arrow';

              const mid = bezierMidpoint(x1, y1, midX, y1, midX, y2, x2, y2);

              return (
                <g key={ci}>
                  {/* Invisible fat hitbox for hover/click */}
                  <path
                    d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredConn(ci)}
                    onMouseLeave={() => { setHoveredConn(null); }}
                    onClick={(e) => { e.stopPropagation(); setConnDeleteIdx(ci); }}
                  />
                  {/* Visible connection line */}
                  <path
                    d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={isHovered ? '#a1a1aa' : color}
                    strokeWidth={isHovered ? 3 : 2}
                    markerEnd={`url(#${markerId})`}
                    strokeDasharray={isRunning ? '6 4' : 'none'}
                    className={`transition-all duration-150 ${isRunning && color === '#3b82f6' ? 'animate-dash' : ''} ${isFlashing ? 'animate-flash-red' : ''}`}
                    style={{ pointerEvents: 'none' }}
                  />
                  {/* Delete button at midpoint */}
                  {connDeleteIdx === ci && (
                    <g
                      style={{ cursor: 'pointer', pointerEvents: 'all' }}
                      onClick={(e) => { e.stopPropagation(); removeConnection(ci); }}
                    >
                      <circle cx={mid.x} cy={mid.y} r={10} fill="#18181b" stroke="#ef4444" strokeWidth={1.5} />
                      <line x1={mid.x - 4} y1={mid.y - 4} x2={mid.x + 4} y2={mid.y + 4} stroke="#ef4444" strokeWidth={2} />
                      <line x1={mid.x + 4} y1={mid.y - 4} x2={mid.x - 4} y2={mid.y + 4} stroke="#ef4444" strokeWidth={2} />
                    </g>
                  )}
                </g>
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
            const isSelected = selectedIds.has(idx);
            const isDragging = dragIdx === idx;
            const runStatus = getRunStatus(step.name);
            const isActive = runStatus?.status === 'running';
            const isDone = runStatus?.status === 'done';
            const isFailed = runStatus?.status === 'error' || runStatus?.status === 'killed';
            const hasOutput = stepOutputs && stepOutputs[step.name];
            const showingOutput = viewingOutput === step.name;

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
                onMouseEnter={(e) => handleNodeMouseEnter(step, e)}
                onMouseLeave={handleNodeMouseLeave}
                onContextMenu={(e) => handleContextMenu(idx, e)}
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
                    isActive
                      ? 'ring-2 ring-emerald-400/60 border-emerald-400/50 shadow-[0_0_20px_rgba(52,211,153,0.15)]'
                      : isDone
                      ? 'border-emerald-500/30'
                      : isFailed
                      ? 'ring-1 ring-red-500/40 border-red-500/30'
                      : isSelected
                      ? 'ring-2 ring-emerald-500/50 border-emerald-500/40'
                      : isDragging
                      ? 'opacity-80 border-zinc-600 shadow-xl'
                      : 'border-zinc-700 hover:border-zinc-600'
                  }`}
                  style={{
                    backgroundColor: isActive ? '#0c1f17' : isDone ? '#111a14' : isFailed ? '#1a1111' : '#18181b',
                    borderColor: isActive ? undefined : isDone ? undefined : isFailed ? undefined : isSelected ? undefined : colors.border,
                  }}
                  onMouseDown={(e) => handleNodeMouseDown(idx, e)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey) {
                      // Multi-select toggle
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(idx)) next.delete(idx);
                        else next.add(idx);
                        return next;
                      });
                    } else {
                      setSelectedIds(new Set([idx]));
                    }
                  }}
                >
                  {/* Header row */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60">
                    <span
                      className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold text-zinc-950 flex-shrink-0"
                      style={{ backgroundColor: colors.dot }}
                    >
                      {idx + 1}
                    </span>
                    <span className="text-xs text-zinc-200 truncate flex-1 font-medium">{step.name}</span>
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
                    {step.stepType === 'evaluator' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-700/50 text-amber-400 bg-amber-500/10">
                        eval {step.maxRetries ? `x${step.maxRetries}` : 'x3'}
                      </span>
                    )}
                    {step.stepType === 'router' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded border border-purple-700/50 text-purple-400 bg-purple-500/10">
                        router
                      </span>
                    )}
                    {step.agentConfig && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded border border-indigo-700/50 text-indigo-400 bg-indigo-500/10 truncate max-w-[70px]" title={step.agentConfig}>
                        {step.agentConfig}
                      </span>
                    )}
                    {runStatus && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ml-auto ${
                        isActive ? 'bg-emerald-500/15 text-emerald-400 animate-pulse'
                          : isDone ? 'bg-emerald-500/15 text-emerald-400'
                          : isFailed ? 'bg-red-500/15 text-red-400'
                          : 'bg-blue-500/15 text-blue-400'
                      }`}>
                        {isActive ? 'active' : runStatus.status}
                      </span>
                    )}
                    {hasOutput && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setViewingOutput(showingOutput ? null : step.name); }}
                        className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                          showingOutput
                            ? 'bg-zinc-700 text-zinc-200'
                            : 'bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                        }`}
                        title="View output"
                      >
                        output
                      </button>
                    )}
                  </div>

                  {/* Task preview or output */}
                  <div className="px-3 pb-2">
                    {showingOutput && hasOutput ? (
                      <pre className="text-[9px] text-emerald-400/80 leading-tight whitespace-pre-wrap break-words max-h-[60px] overflow-y-auto font-mono bg-zinc-950/60 rounded p-1.5 -mx-0.5">
                        {stepOutputs![step.name].slice(0, 500)}
                      </pre>
                    ) : (
                      <p className="text-[10px] text-zinc-500 leading-tight line-clamp-2">
                        {step.task || 'no task defined'}
                      </p>
                    )}
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

        {/* Zoom controls (bottom-right) */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 z-50">
          <button
            onClick={zoomOut}
            className="p-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-all"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={fitToView}
            className="p-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-all"
            title="Fit to view"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={zoomIn}
            className="p-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-all"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Mini-map (bottom-left) */}
        {miniMap && (
          <div
            className="absolute bottom-3 left-3 z-50 rounded-md border border-zinc-800 bg-zinc-950/90 overflow-hidden"
            style={{ width: 120, height: 80 }}
          >
            <svg width="120" height="80" viewBox={`${miniMap.minX} ${miniMap.minY} ${miniMap.maxX - miniMap.minX} ${miniMap.maxY - miniMap.minY}`}>
              {/* Connection lines */}
              {connections.map((conn, ci) => {
                const fromPos = steps[conn.from].position;
                const toPos = steps[conn.to].position;
                if (!fromPos || !toPos) return null;
                return (
                  <line
                    key={ci}
                    x1={fromPos.x + NODE_W / 2}
                    y1={fromPos.y + NODE_H / 2}
                    x2={toPos.x + NODE_W / 2}
                    y2={toPos.y + NODE_H / 2}
                    stroke="#3f3f46"
                    strokeWidth={4}
                  />
                );
              })}
              {/* Node dots */}
              {steps.map((step, idx) => {
                if (!step.position) return null;
                const colors = TYPE_COLORS[step.type] || TYPE_COLORS.claude;
                return (
                  <rect
                    key={idx}
                    x={step.position.x}
                    y={step.position.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={6}
                    fill={colors.dot}
                    opacity={0.6}
                  />
                );
              })}
              {/* Viewport indicator */}
              {containerRef.current && (() => {
                const rect = containerRef.current.getBoundingClientRect();
                const vx = -pan.x / zoom;
                const vy = -pan.y / zoom;
                const vw = rect.width / zoom;
                const vh = rect.height / zoom;
                return (
                  <rect
                    x={vx}
                    y={vy}
                    width={vw}
                    height={vh}
                    fill="none"
                    stroke="#a1a1aa"
                    strokeWidth={6}
                    opacity={0.4}
                    rx={4}
                  />
                );
              })()}
            </svg>
          </div>
        )}

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute z-[60] pointer-events-none px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-700 shadow-xl font-mono max-w-[280px]"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <div className="text-[10px] text-zinc-300 font-medium mb-1">{tooltip.step.name}</div>
            <div className="text-[9px] text-zinc-500 leading-relaxed mb-1">
              {tooltip.step.task || 'no task defined'}
            </div>
            {tooltip.runStatus && (
              <div className="text-[9px] text-zinc-500">
                agent: <span className="text-zinc-400">{tooltip.runStatus.agentId}</span>
                {' | '}status: <span className={
                  tooltip.runStatus.status === 'done' ? 'text-emerald-400'
                  : tooltip.runStatus.status === 'error' ? 'text-red-400'
                  : 'text-blue-400'
                }>{tooltip.runStatus.status}</span>
              </div>
            )}
          </div>
        )}

        {/* Right-click context menu */}
        {contextMenu && (
          <div
            className="fixed z-[100] py-1 rounded-lg bg-zinc-900 border border-zinc-700 shadow-xl font-mono"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800 transition-colors"
              onClick={() => { duplicateNode(contextMenu.idx); setContextMenu(null); }}
            >
              <Copy className="w-3 h-3" /> Duplicate
            </button>
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-red-400 hover:bg-zinc-800 transition-colors"
              onClick={() => { removeNode(contextMenu.idx); setContextMenu(null); }}
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Selected node detail panel */}
      {selectedStep && selectedIdx !== null && (
        <div className="mt-3 border border-zinc-800 rounded-xl bg-zinc-900/80 p-4 font-mono">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">edit node</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => duplicateNode(selectedIdx)}
                className="text-[10px] text-zinc-400/70 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                title="Duplicate node"
              >
                <Copy className="w-3 h-3" /> duplicate
              </button>
              <button
                onClick={() => removeNode(selectedIdx)}
                className="text-[10px] text-red-400/70 hover:text-red-400 flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3 h-3" /> delete
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
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
                  handleChange(steps.map((s, i) => {
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
              {(['claude', 'codex', 'opencode', 'custom', 'test'] as AgentType[]).map(t => {
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

          {/* Agent Config */}
          {agentConfigs && agentConfigs.length > 0 && (
            <div className="mb-3">
              <label className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1 block">agent config</label>
              <select
                value={selectedStep.agentConfig || ''}
                onChange={(e) => {
                  const slug = e.target.value;
                  if (!slug) {
                    updateStep(selectedIdx, 'agentConfig', undefined);
                  } else {
                    const cfg = agentConfigs.find(c => c.slug === slug);
                    const updates: Partial<WorkflowStep> = { agentConfig: slug };
                    if (cfg) {
                      updates.type = cfg.type as AgentType;
                      if (cfg.model) updates.model = cfg.model;
                    }
                    handleChange(steps.map((s, i) => i === selectedIdx ? { ...s, ...updates } : s));
                  }
                }}
                className="w-full h-7 px-2 text-xs bg-zinc-950/60 border border-zinc-800 rounded-md text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-700"
              >
                <option value="">none (custom task)</option>
                {agentConfigs.map(cfg => (
                  <option key={cfg.slug} value={cfg.slug}>{cfg.name}</option>
                ))}
              </select>
              {selectedStep.agentConfig && (() => {
                const cfg = agentConfigs.find(c => c.slug === selectedStep.agentConfig);
                return cfg?.description ? (
                  <p className="text-[9px] text-indigo-400/70 mt-1">{cfg.description}</p>
                ) : null;
              })()}
            </div>
          )}

          {/* Task */}
          <div className="mb-3">
            <label className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1 block">
              {selectedStep.agentConfig ? 'additional instructions (optional)' : 'task'}
            </label>
            <textarea
              value={selectedStep.task}
              onChange={(e) => updateStep(selectedIdx, 'task', e.target.value)}
              placeholder={selectedStep.agentConfig ? 'Extra context or overrides on top of the agent config...' : 'What should this step do...'}
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
                        if (e.target.checked) {
                          // Validate: would this create a cycle?
                          if (wouldCreateCycle(steps, s.name, selectedIdx)) {
                            // Flash briefly — don't add
                            setInvalidFlash({ fromIdx: i, toIdx: selectedIdx });
                            setTimeout(() => setInvalidFlash(null), 600);
                            return;
                          }
                        }
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

          {/* Step behavior */}
          <div className="mt-3 pt-3 border-t border-zinc-800/60">
            <label className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5 block">behavior</label>
            <div className="flex items-center gap-1.5 mb-2">
              {(['standard', 'evaluator', 'router'] as const).map(st => (
                <button
                  key={st}
                  onClick={() => updateStep(selectedIdx, 'stepType', st === 'standard' ? undefined : st)}
                  className={`text-[10px] px-2.5 py-1 rounded-md border transition-all ${
                    (selectedStep.stepType || 'standard') === st
                      ? st === 'evaluator' ? 'bg-amber-500/10 border-amber-700/50 text-amber-400'
                        : st === 'router' ? 'bg-purple-500/10 border-purple-700/50 text-purple-400'
                        : 'bg-zinc-800 border-zinc-600 text-zinc-300'
                      : 'border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Evaluator: maxRetries */}
            {selectedStep.stepType === 'evaluator' && (
              <div className="mt-2">
                <label className="text-[10px] text-zinc-600 mb-1 block">max retries (how many times to re-run the dependency)</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={selectedStep.maxRetries ?? 3}
                  onChange={(e) => updateStep(selectedIdx, 'maxRetries', Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                  className="w-20 h-7 px-2 text-xs bg-zinc-950/60 border border-zinc-800 rounded-md text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-amber-700"
                />
                <p className="text-[9px] text-zinc-700 mt-1">this step evaluates its dependency&apos;s output. if it outputs FAIL/BLOCKED/NEEDS CHANGES, the dependency is re-run with feedback.</p>
              </div>
            )}

            {/* Router: routes */}
            {selectedStep.stepType === 'router' && (
              <div className="mt-2">
                <label className="text-[10px] text-zinc-600 mb-1 block">route targets (step names this router can send to)</label>
                <div className="flex flex-wrap gap-1.5">
                  {steps.map((s, i) => {
                    if (i === selectedIdx) return null;
                    const routes = selectedStep.routes || [];
                    const isRoute = routes.includes(s.name);
                    return (
                      <label key={i} className="flex items-center gap-1.5 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={isRoute}
                          onChange={(e) => {
                            const newRoutes = e.target.checked
                              ? [...routes, s.name]
                              : routes.filter(r => r !== s.name);
                            updateStep(selectedIdx, 'routes', newRoutes.length > 0 ? newRoutes : undefined);
                          }}
                          className="w-3 h-3 rounded border-zinc-700 bg-zinc-900 text-purple-500 focus:ring-0 focus:ring-offset-0"
                        />
                        <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors">{s.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[9px] text-zinc-700 mt-1">this step classifies its input and picks one route. include the target step names in its task so it knows the options. unselected routes are skipped.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Animations */}
      <style jsx>{`
        @keyframes dashMove {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -20; }
        }
        :global(.animate-dash) {
          animation: dashMove 0.8s linear infinite;
        }
        @keyframes flashRed {
          0%, 100% { stroke: #ef4444; stroke-width: 3; }
          50% { stroke: #fca5a5; stroke-width: 4; }
        }
        :global(.animate-flash-red) {
          animation: flashRed 0.3s ease-in-out 2;
        }
      `}</style>
    </div>
  );
}
