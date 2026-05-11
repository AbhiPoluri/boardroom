'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  Handle, Position, addEdge,
  applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Persona } from '@/lib/db';

export interface CanvasSubtask {
  id?: string;
  title: string;
  description: string;
  required_skills: string[];
  persona_id: string | null;
  depends_on?: string[];
  canvas_x?: number | null;
  canvas_y?: number | null;
}

interface PlanCanvasProps {
  subtasks: CanvasSubtask[];
  personas: Persona[];
  onChange: (next: CanvasSubtask[]) => void;
  /** Called when the user clicks the canvas "+ add" affordance to create a new subtask. */
  onAdd?: () => void;
}

interface SubtaskNodeData extends Record<string, unknown> {
  title: string;
  status: string;
  personaName: string | null;
  personaColor: string | null;
}

function SubtaskNode({ data }: NodeProps<Node<SubtaskNodeData>>) {
  return (
    <div className="brr-os-canvas-node">
      <Handle type="target" position={Position.Top} />
      <div className="brr-os-canvas-node-head">
        {data.personaColor && (
          <span
            className="brr-os-canvas-node-dot"
            style={{ background: data.personaColor }}
          />
        )}
        <span className="brr-os-canvas-node-title">{data.title || '(untitled)'}</span>
      </div>
      <div className="brr-os-canvas-node-meta">
        {data.personaName ?? 'auto-pickup'}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const NODE_TYPES = { subtask: SubtaskNode };

export function PlanCanvas({ subtasks, personas, onChange, onAdd }: PlanCanvasProps) {
  return (
    <ReactFlowProvider>
      <PlanCanvasInner subtasks={subtasks} personas={personas} onChange={onChange} onAdd={onAdd} />
    </ReactFlowProvider>
  );
}

function PlanCanvasInner({ subtasks, personas, onChange, onAdd }: PlanCanvasProps) {
  // Stable client ids for subtasks that don't yet have a server id.
  const clientIdRef = useRef(new Map<CanvasSubtask, string>());
  const getKey = useCallback((s: CanvasSubtask, idx: number): string => {
    if (s.id) return s.id;
    const cached = clientIdRef.current.get(s);
    if (cached) return cached;
    const k = `tmp-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    clientIdRef.current.set(s, k);
    return k;
  }, []);

  const personaById = useMemo(() => {
    const m = new Map<string, Persona>();
    for (const p of personas) m.set(p.id, p);
    return m;
  }, [personas]);

  // Build the canonical nodes/edges representation from the subtasks prop.
  const { computedNodes, computedEdges } = useMemo(() => {
    const nodes: Node<SubtaskNodeData>[] = subtasks.map((s, i) => {
      const id = getKey(s, i);
      const persona = s.persona_id ? personaById.get(s.persona_id) : null;
      const x = typeof s.canvas_x === 'number' ? s.canvas_x : autoX(i);
      const y = typeof s.canvas_y === 'number' ? s.canvas_y : autoY(i);
      return {
        id,
        type: 'subtask',
        position: { x, y },
        data: {
          title: s.title || '(untitled)',
          status: 'staged',
          personaName: persona?.name ?? null,
          personaColor: persona?.color ?? null,
        },
      };
    });
    const edges: Edge[] = [];
    subtasks.forEach((s, i) => {
      const targetId = getKey(s, i);
      for (const dep of s.depends_on ?? []) {
        const exists = nodes.some(n => n.id === dep);
        if (exists) {
          edges.push({ id: `${dep}->${targetId}`, source: dep, target: targetId, animated: true });
        }
      }
    });
    return { computedNodes: nodes, computedEdges: edges };
  }, [subtasks, personaById, getKey]);

  // Controlled state — must reflect prop changes (e.g., parent calls onAdd
  // and pushes a new subtask). When the IDs in props change, we re-sync.
  const [nodes, setNodes] = useState<Node<SubtaskNodeData>[]>(computedNodes);
  const [edges, setEdges] = useState<Edge[]>(computedEdges);

  // Re-sync when the subtask set changes (id additions/removals/title changes
  // from outside the canvas). We preserve drag positions for nodes that are
  // still present.
  const subtaskSig = useMemo(
    () => JSON.stringify(subtasks.map((s, i) => ({ id: s.id ?? null, key: getKey(s, i), title: s.title, deps: s.depends_on, persona: s.persona_id }))),
    [subtasks, getKey],
  );
  useEffect(() => {
    setNodes(prev => {
      const prevById = new Map(prev.map(n => [n.id, n] as const));
      return computedNodes.map(n => {
        const existing = prevById.get(n.id);
        if (existing) {
          // Keep the user's current drag position + merge fresh data.
          return { ...n, position: existing.position, data: { ...n.data } };
        }
        return n;
      });
    });
    setEdges(computedEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtaskSig]);

  const flushUp = useCallback((nextNodes: Node<SubtaskNodeData>[], nextEdges: Edge[]) => {
    const next: CanvasSubtask[] = nextNodes.map((n) => {
      const orig = subtasks.find((s, i) => getKey(s, i) === n.id) ?? null;
      const incoming = nextEdges.filter(e => e.target === n.id).map(e => e.source);
      return {
        id: orig?.id,
        title: orig?.title ?? n.data.title,
        description: orig?.description ?? n.data.title,
        required_skills: orig?.required_skills ?? [],
        persona_id: orig?.persona_id ?? null,
        depends_on: incoming,
        canvas_x: n.position.x,
        canvas_y: n.position.y,
      };
    });
    onChange(next);
  }, [subtasks, getKey, onChange]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(prev => {
      const next = applyNodeChanges(changes, prev) as Node<SubtaskNodeData>[];
      if (changes.some(c => c.type === 'position' && c.dragging === false)) {
        // Defer the parent flush a tick so React commits state first.
        queueMicrotask(() => flushUp(next, edges));
      }
      return next;
    });
  }, [flushUp, edges]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges(prev => {
      const next = applyEdgeChanges(changes, prev);
      if (changes.some(c => c.type === 'remove')) {
        queueMicrotask(() => flushUp(nodes, next));
      }
      return next;
    });
  }, [flushUp, nodes]);

  const onConnect = useCallback((conn: Connection) => {
    if (conn.source === conn.target) return;
    setEdges(prev => {
      const next = addEdge({ ...conn, id: `${conn.source}->${conn.target}`, animated: true }, prev);
      queueMicrotask(() => flushUp(nodes, next));
      return next;
    });
  }, [flushUp, nodes]);

  const handlePaneDoubleClick = useCallback(() => {
    if (onAdd) onAdd();
  }, [onAdd]);

  return (
    <div className="brr-os-canvas-frame">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDoubleClick={handlePaneDoubleClick}
        fitView={nodes.length > 0}
        defaultViewport={{ x: 60, y: 40, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        {nodes.length > 0 && <MiniMap pannable zoomable />}
      </ReactFlow>
      {onAdd && (
        <button
          type="button"
          className="brr-os-canvas-add"
          onClick={onAdd}
          title="add subtask (or double-click the canvas)"
        >
          + add subtask
        </button>
      )}
      {nodes.length === 0 && (
        <div className="brr-os-canvas-empty">
          empty canvas — click + add (or double-click) to drop in your first node
        </div>
      )}
    </div>
  );
}

function autoX(i: number): number {
  const col = i % 3;
  return 60 + col * 280;
}
function autoY(i: number): number {
  const row = Math.floor(i / 3);
  return 40 + row * 160;
}
