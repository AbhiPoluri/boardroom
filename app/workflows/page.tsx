'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Play, Save, GripVertical,
  MoreHorizontal, Copy, ArrowUp, ArrowDown, GitBranch, Workflow,
  ChevronDown, Zap, Activity, CheckCircle2, XCircle, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AgentType } from '@/types';

interface WorkflowStep {
  name: string;
  type: AgentType;
  model?: string;
  task: string;
  dependsOn?: string[];
  parallel?: boolean;
}

interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

const AGENT_TYPES: AgentType[] = ['claude', 'codex', 'custom', 'test'];

const TYPE_THEME: Record<string, { dot: string; badge: string; ring: string; label: string }> = {
  claude: { dot: 'bg-blue-400', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20', ring: 'ring-blue-500/20', label: 'text-blue-400' },
  codex: { dot: 'bg-amber-400', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20', ring: 'ring-amber-500/20', label: 'text-amber-400' },
  custom: { dot: 'bg-purple-400', badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20', ring: 'ring-purple-500/20', label: 'text-purple-400' },
  test: { dot: 'bg-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', ring: 'ring-emerald-500/20', label: 'text-emerald-400' },
};

function PipelineConnector({ parallel }: { parallel: boolean }) {
  if (parallel) {
    return (
      <div className="flex flex-col items-center py-2">
        <div className="w-px h-2 bg-amber-500/30" />
        <Badge variant="outline" className="text-[10px] font-mono bg-amber-500/10 text-amber-400 border-amber-500/25 px-2.5 py-0.5">
          <GitBranch className="w-2.5 h-2.5 mr-1" />
          parallel
        </Badge>
        <div className="w-px h-2 bg-amber-500/30" />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center py-1.5">
      <svg width="2" height="20" className="text-zinc-700">
        <line x1="1" y1="0" x2="1" y2="20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
      </svg>
      <ChevronDown className="w-4 h-4 text-zinc-600 -my-1" />
    </div>
  );
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [running, setRunning] = useState(false);

  const [edName, setEdName] = useState('');
  const [edDesc, setEdDesc] = useState('');
  const [edSteps, setEdSteps] = useState<WorkflowStep[]>([]);
  const [isNew, setIsNew] = useState(false);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const dragStartY = useRef(0);

  // Active runs state
  interface WorkflowRun {
    runId: string;
    workflowName: string;
    status: 'running' | 'done' | 'error';
    agents: Array<{ stepName: string; agentId: string; status: string }>;
  }
  const [activeRuns, setActiveRuns] = useState<WorkflowRun[]>([]);
  const [viewingRun, setViewingRun] = useState<string | null>(null);

  // Run history from DB
  interface HistoryRun {
    id: string;
    workflow_id: string;
    status: string;
    started_at: number;
    finished_at: number | null;
    agent_ids: string[];
    error: string | null;
  }
  const [runHistory, setRunHistory] = useState<HistoryRun[]>([]);

  useEffect(() => {
    fetch('/api/workflows').then(r => r.json()).then(data => {
      setWorkflows(data.workflows || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Poll active runs + fetch history
  useEffect(() => {
    const fetchRuns = () => {
      fetch('/api/workflows?runs=1').then(r => r.json()).then(data => {
        setActiveRuns(data.runs || []);
      }).catch(() => {});
    };
    const fetchHistory = () => {
      fetch('/api/workflows/history').then(r => r.json()).then(data => {
        setRunHistory(data.runs || []);
      }).catch(() => {});
    };
    fetchRuns();
    fetchHistory();
    const iv = setInterval(fetchRuns, 8000);
    const hv = setInterval(fetchHistory, 15000);
    return () => { clearInterval(iv); clearInterval(hv); };
  }, []);

  const selectWorkflow = (wf: WorkflowDef) => {
    setSelected(wf.id);
    setEdName(wf.name);
    setEdDesc(wf.description);
    setEdSteps(wf.steps);
    setIsNew(false);
    setViewingRun(null);
    setError('');
    setSuccess('');
  };

  const viewRun = (runId: string) => {
    setViewingRun(runId);
    setSelected(null);
    setIsNew(false);
  };

  const startNew = () => {
    setSelected(null);
    setViewingRun(null);
    setEdName('');
    setEdDesc('');
    setEdSteps([{ name: 'step-1', type: 'claude', model: 'sonnet', task: '', parallel: false }]);
    setIsNew(true);
    setError('');
  };

  const addStep = () => {
    setEdSteps(prev => [...prev, { name: `step-${prev.length + 1}`, type: 'claude', model: 'sonnet', task: '', parallel: false }]);
  };

  const removeStep = (idx: number) => setEdSteps(prev => prev.filter((_, i) => i !== idx));

  const duplicateStep = (idx: number) => {
    setEdSteps(prev => {
      const clone = { ...prev[idx], name: `${prev[idx].name}-copy` };
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
  };

  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= edSteps.length) return;
    setEdSteps(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const updateStep = (idx: number, field: keyof WorkflowStep, value: unknown) => {
    setEdSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const handleDragStart = useCallback((idx: number, e: React.MouseEvent) => {
    setDragIdx(idx);
    dragStartY.current = e.clientY;
    const handleMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientY - dragStartY.current;
      const offset = Math.round(delta / 140);
      const target = Math.max(0, Math.min(edSteps.length - 1, idx + offset));
      setDropIdx(target !== idx ? target : null);
    };
    const handleMouseUp = () => {
      if (dropIdx !== null && dragIdx !== null) moveStep(dragIdx, dropIdx);
      setDragIdx(null);
      setDropIdx(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [dragIdx, dropIdx, edSteps.length]);

  const handleSave = async () => {
    if (!edName.trim()) { setError('Name required'); return; }
    if (edSteps.length === 0) { setError('Add at least one step'); return; }
    setSaving(true);
    setError('');
    try {
      const method = isNew ? 'POST' : 'PUT';
      const body = isNew
        ? { name: edName, description: edDesc, steps: edSteps }
        : { id: selected, name: edName, description: edDesc, steps: edSteps };
      const res = await fetch('/api/workflows', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      const wfRes = await fetch('/api/workflows');
      const wfData = await wfRes.json();
      setWorkflows(wfData.workflows || []);
      if (data.workflow?.id) setSelected(data.workflow.id);
      setIsNew(false);
      setSuccess('saved');
      setTimeout(() => setSuccess(''), 2000);
    } catch { setError('Failed to save'); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!selected) return;
    await fetch('/api/workflows', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected }) });
    setWorkflows(prev => prev.filter(w => w.id !== selected));
    setSelected(null);
    setIsNew(false);
  };

  const [runId, setRunId] = useState<string | null>(null);
  const [runAgents, setRunAgents] = useState<Array<{ stepName: string; agentId: string; status: string }>>([]);
  const [runStatus, setRunStatus] = useState<string | null>(null);

  // Poll run status
  useEffect(() => {
    if (!runId) return;
    const iv = setInterval(async () => {
      // Already done — stop polling
      if (runStatus === 'done' || runStatus === 'error') return;
      try {
        const res = await fetch(`/api/workflows?runId=${runId}`);
        const data = await res.json();
        if (data.run) {
          setRunAgents(data.run.agents || []);
          setRunStatus(data.run.status);
          if (data.run.status === 'done' || data.run.status === 'error') {
            setRunning(false);
            clearInterval(iv);
            setSuccess(data.run.status === 'done' ? 'workflow complete' : 'workflow failed');
            setTimeout(() => setSuccess(''), 4000);
          }
        }
      } catch {}
    }, 4000);
    return () => clearInterval(iv);
  }, [runId]);

  const handleRun = async () => {
    if (edSteps.length === 0 || !edSteps.some(s => s.task.trim())) return;
    setRunning(true);
    setError('');
    setSuccess('');
    setRunAgents([]);
    setRunStatus('running');
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', name: edName, steps: edSteps }),
      });
      const data = await res.json();
      if (data.runId) {
        setRunId(data.runId);
        setRunAgents(data.agents || []);
        setSuccess(`running — ${data.agents?.length || 0} agent(s) spawned`);
      } else {
        setError(data.error || 'failed to start');
        setRunning(false);
      }
    } catch {
      setError('failed to start workflow');
      setRunning(false);
    }
  };

  const hasEditor = isNew || selected;
  const viewedRun = activeRuns.find(r => r.runId === viewingRun);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-sm text-zinc-100">workflows</h1>
          {viewedRun ? (
            <>
              <Separator orientation="vertical" className="h-4" />
              <Eye className="w-3.5 h-3.5 text-zinc-500" />
              <span className="font-mono text-xs text-zinc-500">{viewedRun.workflowName}</span>
              <Badge variant="outline" className={`text-[10px] font-mono ${
                viewedRun.status === 'running' ? 'bg-blue-500/10 text-blue-400 border-blue-500/25'
                  : viewedRun.status === 'done' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : 'bg-red-500/10 text-red-400 border-red-500/25'
              }`}>
                {viewedRun.status}
              </Badge>
            </>
          ) : hasEditor ? (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="font-mono text-xs text-zinc-500">{isNew ? 'new' : edName}</span>
              <Badge variant="outline" className="text-[10px] font-mono">{edSteps.length} step{edSteps.length !== 1 ? 's' : ''}</Badge>
              {error && <Badge variant="destructive" className="text-[10px] font-mono">{error}</Badge>}
              {success && <Badge className="text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border-emerald-500/25">{success}</Badge>}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {hasEditor && (
            <>
              {!isNew && selected && (
                <Button onClick={handleDelete} variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-600 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button onClick={handleRun} disabled={edSteps.length === 0 || !edSteps.some(s => s.task.trim()) || running} variant="outline" size="sm" className="font-mono text-xs h-7 px-3">
                <Play className="w-3 h-3 mr-1.5" /> {running ? 'running...' : 'run'}
              </Button>
              <Button onClick={handleSave} disabled={saving} size="sm" className="font-mono text-xs h-7 px-3 bg-emerald-600 hover:bg-emerald-500 text-white">
                <Save className="w-3 h-3 mr-1.5" /> {saving ? '...' : 'save'}
              </Button>
              <Separator orientation="vertical" className="h-4 mx-1" />
            </>
          )}
          <Button onClick={startNew} size="sm" className="font-mono text-xs h-7 px-3 bg-emerald-600 hover:bg-emerald-500 text-white">
            <Plus className="w-3.5 h-3.5 mr-1" /> new
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-[220px] flex-shrink-0 border-r border-zinc-800 overflow-y-auto">
          <div className="p-2 space-y-1">
            {/* Saved workflows */}
            <div className="px-2 pt-1 pb-1.5">
              <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">saved</span>
            </div>
            {loading ? (
              <div className="p-3 text-xs font-mono text-zinc-700">loading...</div>
            ) : workflows.length === 0 && !isNew ? (
              <div className="py-4 text-center">
                <p className="text-[11px] font-mono text-zinc-600">no workflows yet</p>
                <p className="text-[10px] font-mono text-zinc-700 mt-1">click + new to create one</p>
              </div>
            ) : (
              workflows.map((wf) => (
                <button
                  key={wf.id}
                  onClick={() => selectWorkflow(wf)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                    selected === wf.id
                      ? 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-300'
                  }`}
                >
                  <div className="font-mono text-xs font-medium truncate">{wf.name}</div>
                  {/* Mini pipeline */}
                  <div className="flex items-center gap-1 mt-2">
                    {wf.steps.map((s, i) => {
                      const theme = TYPE_THEME[s.type] || TYPE_THEME.claude;
                      return (
                        <div key={i} className="flex items-center gap-1">
                          {i > 0 && (
                            <svg width="8" height="8" className="text-zinc-700 flex-shrink-0">
                              <path d="M0 4 L6 4 M4 2 L6 4 L4 6" fill="none" stroke="currentColor" strokeWidth="1" />
                            </svg>
                          )}
                          <div className={`w-2.5 h-2.5 rounded-full ${theme.dot} flex-shrink-0`} />
                        </div>
                      );
                    })}
                    <span className="text-[9px] font-mono text-zinc-600 ml-1">{wf.steps.length}s</span>
                  </div>
                </button>
              ))
            )}

            {/* Active runs */}
            {activeRuns.length > 0 && (
              <>
                <Separator className="my-2 bg-zinc-800" />
                <div className="px-2 pt-1 pb-1.5 flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-zinc-600" />
                  <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">runs</span>
                  <Badge variant="outline" className="text-[8px] font-mono ml-auto h-4 px-1.5">
                    {activeRuns.filter(r => r.status === 'running').length} active
                  </Badge>
                </div>
                {activeRuns.map((run) => (
                  <button
                    key={run.runId}
                    onClick={() => viewRun(run.runId)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                      viewingRun === run.runId
                        ? 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        run.status === 'running' ? 'bg-blue-400 animate-pulse'
                          : run.status === 'done' ? 'bg-emerald-400'
                          : 'bg-red-400'
                      }`} />
                      <span className="font-mono text-xs font-medium truncate">{run.workflowName}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 pl-3.5">
                      <span className={`text-[9px] font-mono ${
                        run.status === 'running' ? 'text-blue-400'
                          : run.status === 'done' ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}>{run.status}</span>
                      <span className="text-[9px] font-mono text-zinc-700">{run.agents.length} step{run.agents.length !== 1 ? 's' : ''}</span>
                      <span className="text-[9px] font-mono text-zinc-700 ml-auto">{run.runId.slice(0, 8)}</span>
                    </div>
                  </button>
                ))}
              </>
            )}

            {/* Run History from DB */}
            {runHistory.length > 0 && (
              <>
                <Separator className="my-2 bg-zinc-800" />
                <div className="px-2 pt-1 pb-1.5 flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-zinc-600" />
                  <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">history</span>
                  <Badge variant="outline" className="text-[8px] font-mono ml-auto h-4 px-1.5">
                    {runHistory.length}
                  </Badge>
                </div>
                {runHistory.slice(0, 10).map((run) => {
                  const duration = run.finished_at ? run.finished_at - run.started_at : Date.now() - run.started_at;
                  const durationStr = duration < 60000 ? `${Math.round(duration / 1000)}s` : `${Math.round(duration / 60000)}m`;
                  return (
                    <div
                      key={run.id}
                      className="w-full text-left px-3 py-2 rounded-lg text-zinc-500 hover:bg-zinc-900 hover:text-zinc-400 transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          run.status === 'running' ? 'bg-blue-400 animate-pulse'
                            : run.status === 'done' ? 'bg-emerald-400'
                            : 'bg-red-400'
                        }`} />
                        <span className="font-mono text-[10px] font-medium truncate flex-1">{run.workflow_id}</span>
                        <span className={`text-[9px] font-mono ${
                          run.status === 'done' ? 'text-emerald-500' : run.status === 'error' ? 'text-red-400' : 'text-blue-400'
                        }`}>{run.status}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 pl-3.5">
                        <span className="text-[9px] font-mono text-zinc-700">{durationStr}</span>
                        <span className="text-[9px] font-mono text-zinc-700">{run.agent_ids.length} agent{run.agent_ids.length !== 1 ? 's' : ''}</span>
                        <span className="text-[9px] font-mono text-zinc-700 ml-auto">
                          {new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {run.error && (
                        <div className="text-[9px] font-mono text-red-400/70 mt-1 pl-3.5 truncate">{run.error}</div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {viewedRun ? (
            /* Run viewer */
            <div className="flex-1 overflow-y-auto p-5">
              <div className="max-w-lg mx-auto space-y-4">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    viewedRun.status === 'running' ? 'bg-blue-500/15'
                      : viewedRun.status === 'done' ? 'bg-emerald-500/15'
                      : 'bg-red-500/15'
                  }`}>
                    {viewedRun.status === 'running' ? <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
                      : viewedRun.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      : <XCircle className="w-4 h-4 text-red-400" />}
                  </div>
                  <div>
                    <h2 className="font-mono text-sm text-zinc-100">{viewedRun.workflowName}</h2>
                    <span className="font-mono text-[10px] text-zinc-600">{viewedRun.runId}</span>
                  </div>
                  <Badge variant="outline" className={`ml-auto text-[10px] font-mono ${
                    viewedRun.status === 'running' ? 'bg-blue-500/10 text-blue-400 border-blue-500/25'
                      : viewedRun.status === 'done' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                      : 'bg-red-500/10 text-red-400 border-red-500/25'
                  }`}>
                    {viewedRun.status}
                  </Badge>
                </div>

                <Separator className="bg-zinc-800" />

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">steps</span>
                    <Badge variant="outline" className="text-[9px] font-mono">
                      {viewedRun.agents.filter(a => a.status === 'done').length}/{viewedRun.agents.length} complete
                    </Badge>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full mb-4 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        viewedRun.status === 'error' ? 'bg-red-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${viewedRun.agents.length > 0 ? (viewedRun.agents.filter(a => a.status === 'done').length / viewedRun.agents.length) * 100 : 0}%` }}
                    />
                  </div>

                  <div className="space-y-2">
                    {viewedRun.agents.map((a, i) => {
                      // Try to find step info from the workflow
                      const wf = workflows.find(w => w.name === viewedRun.workflowName);
                      const step = wf?.steps[i];
                      return (
                      <a key={a.agentId} href={`/agents/${a.agentId}`} className="block group">
                        <Card className="bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 transition-colors">
                          <CardContent className="py-3 px-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-mono font-bold ${
                                a.status === 'done' ? 'bg-emerald-400 text-zinc-950'
                                  : a.status === 'error' || a.status === 'killed' ? 'bg-red-400 text-zinc-950'
                                  : a.status === 'running' ? 'bg-blue-400 text-zinc-950'
                                  : 'bg-zinc-700 text-zinc-300'
                              }`}>
                                {i + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="font-mono text-xs text-zinc-200 block truncate">{a.stepName}</span>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="font-mono text-[10px] text-zinc-600">{a.agentId.slice(0, 8)}</span>
                                  {step && (
                                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{step.type} / {step.model || 'sonnet'}</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {a.status === 'running' && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                )}
                                <Badge variant="outline" className={`text-[9px] font-mono ${
                                  a.status === 'done' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                    : a.status === 'error' || a.status === 'killed' ? 'bg-red-500/10 text-red-400 border-red-500/25'
                                    : a.status === 'running' ? 'bg-blue-500/10 text-blue-400 border-blue-500/25'
                                    : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/25'
                                }`}>
                                  {a.status}
                                </Badge>
                              </div>
                            </div>
                            {step && (
                              <div className="mt-2 pl-8 text-[10px] font-mono text-zinc-500 line-clamp-2">{step.task}</div>
                            )}
                          </CardContent>
                        </Card>
                      </a>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : !hasEditor ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <Card className="bg-zinc-900/50 border-zinc-800 px-10 py-8">
                <CardContent className="flex flex-col items-center p-0">
                  <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center mb-4">
                    <Workflow className="w-6 h-6 text-zinc-500" />
                  </div>
                  <h2 className="text-sm font-mono font-medium text-zinc-200 mb-1">agent pipelines</h2>
                  <p className="text-xs font-mono text-zinc-500 max-w-xs mb-5">
                    Chain agent steps into automated pipelines — review, test, deploy.
                  </p>

                  {/* Example pipeline */}
                  <div className="flex items-center gap-1.5 mb-5">
                    <Badge variant="outline" className="text-[10px] font-mono bg-blue-500/10 text-blue-400 border-blue-500/20">
                      <Zap className="w-2.5 h-2.5 mr-1" /> reviewer
                    </Badge>
                    <svg width="16" height="8" className="text-zinc-600"><path d="M0 4 L12 4 M10 2 L12 4 L10 6" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
                    <Badge variant="outline" className="text-[10px] font-mono bg-purple-500/10 text-purple-400 border-purple-500/20">
                      <Zap className="w-2.5 h-2.5 mr-1" /> tests
                    </Badge>
                    <svg width="16" height="8" className="text-zinc-600"><path d="M0 4 L12 4 M10 2 L12 4 L10 6" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
                    <Badge variant="outline" className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                      <Zap className="w-2.5 h-2.5 mr-1" /> deploy
                    </Badge>
                  </div>

                  <Button onClick={startNew} size="sm" className="font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-white h-8 px-4">
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> new workflow
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            /* Editor */
            <div className="flex-1 overflow-y-auto p-5">
              <div className="max-w-lg mx-auto space-y-5">
                {/* Name + Desc */}
                <Card size="sm" className="bg-zinc-900/60 border-zinc-800">
                  <CardContent className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">name</label>
                      <Input
                        value={edName}
                        onChange={(e) => setEdName(e.target.value)}
                        placeholder="my-workflow"
                        className="font-mono text-sm h-8 bg-zinc-950/50 border-zinc-800 text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">description</label>
                      <Input
                        value={edDesc}
                        onChange={(e) => setEdDesc(e.target.value)}
                        placeholder="optional"
                        className="font-mono text-sm h-8 bg-zinc-950/50 border-zinc-800 text-zinc-100"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Pipeline header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">pipeline</span>
                    <Badge variant="outline" className="text-[9px] font-mono">{edSteps.length} step{edSteps.length !== 1 ? 's' : ''}</Badge>
                  </div>
                  <Button onClick={addStep} variant="ghost" size="sm" className="font-mono text-[10px] h-6 px-2 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10">
                    <Plus className="w-3 h-3 mr-1" /> add step
                  </Button>
                </div>

                {edSteps.length === 0 ? (
                  <button
                    onClick={addStep}
                    className="w-full py-10 rounded-xl border border-dashed border-zinc-800 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all flex flex-col items-center gap-2 group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-zinc-900 flex items-center justify-center group-hover:bg-emerald-500/10 transition-colors">
                      <Plus className="w-5 h-5 text-zinc-700 group-hover:text-emerald-400" />
                    </div>
                    <span className="text-xs font-mono text-zinc-700 group-hover:text-emerald-400">add first step</span>
                  </button>
                ) : (
                  <div className="flex flex-col items-center">
                    {edSteps.map((step, idx) => {
                      const theme = TYPE_THEME[step.type] || TYPE_THEME.claude;
                      return (
                        <div key={idx} className="w-full">
                          {idx > 0 && <PipelineConnector parallel={step.parallel || false} />}

                          <Card
                            size="sm"
                            className={`transition-all ${
                              dragIdx === idx
                                ? 'opacity-40 border-zinc-700'
                                : dropIdx === idx
                                ? 'ring-2 ring-emerald-500/40 bg-emerald-500/5'
                                : `bg-zinc-900/60 border-zinc-800 hover:border-zinc-700`
                            }`}
                          >
                            <CardContent className="p-0">
                              {/* Step header */}
                              <div className="group flex items-center gap-2 px-3 py-2">
                                <button
                                  onMouseDown={(e) => handleDragStart(idx, e)}
                                  className="cursor-grab active:cursor-grabbing text-zinc-800 hover:text-zinc-500 transition-colors touch-none"
                                >
                                  <GripVertical className="w-3.5 h-3.5" />
                                </button>

                                {/* Numbered badge */}
                                <div className={`w-5 h-5 rounded-md ${theme.dot} flex items-center justify-center flex-shrink-0 text-[10px] font-mono font-bold text-zinc-950`}>
                                  {idx + 1}
                                </div>

                                <Input
                                  value={step.name}
                                  onChange={(e) => updateStep(idx, 'name', e.target.value)}
                                  placeholder="step name"
                                  className="font-mono text-xs h-7 flex-1 bg-transparent border-none shadow-none text-zinc-200 px-1 focus-visible:ring-1 focus-visible:ring-zinc-600"
                                />

                                {/* Type */}
                                <Select value={step.type} onValueChange={(v) => updateStep(idx, 'type', v)}>
                                  <SelectTrigger className={`w-[85px] h-7 text-[10px] font-mono bg-transparent border-zinc-800/60 ${theme.label} rounded-md`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {AGENT_TYPES.map(t => (
                                      <SelectItem key={t} value={t} className="text-xs font-mono">
                                        <span className="flex items-center gap-1.5">
                                          <span className={`w-1.5 h-1.5 rounded-full ${TYPE_THEME[t]?.dot}`} />
                                          {t}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>

                                {/* Model */}
                                <Select value={step.model || 'sonnet'} onValueChange={(v) => updateStep(idx, 'model', v)}>
                                  <SelectTrigger className="w-[85px] h-7 text-[10px] font-mono bg-transparent border-zinc-800/60 text-zinc-400 rounded-md">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="haiku" className="text-xs font-mono">haiku</SelectItem>
                                    <SelectItem value="sonnet" className="text-xs font-mono">sonnet</SelectItem>
                                    <SelectItem value="opus" className="text-xs font-mono">opus</SelectItem>
                                  </SelectContent>
                                </Select>

                                {/* Parallel — only show on steps after the first */}
                                {idx > 0 && (
                                  <button
                                    onClick={() => updateStep(idx, 'parallel', !step.parallel)}
                                    title={step.parallel ? 'Runs in parallel with previous step' : 'Run in parallel with previous step'}
                                    className={`p-1 rounded-md transition-all ${
                                      step.parallel
                                        ? 'text-amber-400 bg-amber-500/15 ring-1 ring-amber-500/30'
                                        : 'text-zinc-700 hover:text-zinc-500'
                                    }`}
                                  >
                                    <GitBranch className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                {/* Menu */}
                                <DropdownMenu>
                                  <DropdownMenuTrigger className="p-1 rounded text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-all">
                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-36">
                                    <DropdownMenuItem onClick={() => moveStep(idx, idx - 1)} disabled={idx === 0} className="text-xs font-mono">
                                      <ArrowUp className="w-3 h-3 mr-2" /> Move up
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => moveStep(idx, idx + 1)} disabled={idx === edSteps.length - 1} className="text-xs font-mono">
                                      <ArrowDown className="w-3 h-3 mr-2" /> Move down
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => duplicateStep(idx)} className="text-xs font-mono">
                                      <Copy className="w-3 h-3 mr-2" /> Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => removeStep(idx)} className="text-xs font-mono text-red-400 focus:text-red-400">
                                      <Trash2 className="w-3 h-3 mr-2" /> Remove
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>

                              {/* Task */}
                              <div className="px-3 pb-3">
                                <Textarea
                                  value={step.task}
                                  onChange={(e) => updateStep(idx, 'task', e.target.value)}
                                  placeholder="What should this step do..."
                                  className="font-mono text-xs bg-zinc-950/40 border-zinc-800/50 text-zinc-300 resize-none min-h-[44px] placeholder:text-zinc-700 rounded-md"
                                  rows={2}
                                />
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      );
                    })}

                    {/* Add step at bottom */}
                    <div className="w-full flex flex-col items-center pt-1.5">
                      <svg width="2" height="16" className="text-zinc-800">
                        <line x1="1" y1="0" x2="1" y2="16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
                      </svg>
                      <button
                        onClick={addStep}
                        className="mt-1 w-full py-3 rounded-xl border border-dashed border-zinc-800 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all flex items-center justify-center gap-1.5 group"
                      >
                        <Plus className="w-3.5 h-3.5 text-zinc-700 group-hover:text-emerald-400 transition-colors" />
                        <span className="text-[11px] font-mono text-zinc-700 group-hover:text-emerald-400 transition-colors">add step</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Run status */}
                {runAgents.length > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">run status</span>
                      <Badge variant="outline" className={`text-[10px] font-mono ${
                        runStatus === 'done' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                          : runStatus === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/25'
                          : 'bg-blue-500/10 text-blue-400 border-blue-500/25'
                      }`}>
                        {runStatus}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {runAgents.map((a) => {
                        const step = edSteps.find(s => s.name === a.stepName);
                        return (
                        <a key={a.agentId} href={`/agents/${a.agentId}`} className="block px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50 hover:border-zinc-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              a.status === 'done' ? 'bg-emerald-400'
                                : a.status === 'error' || a.status === 'killed' ? 'bg-red-400'
                                : 'bg-blue-400 animate-pulse'
                            }`} />
                            <span className="text-[11px] font-mono text-zinc-200 font-medium flex-1">{a.stepName}</span>
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                              a.status === 'done' ? 'bg-emerald-500/10 text-emerald-400'
                                : a.status === 'error' ? 'bg-red-500/10 text-red-400'
                                : 'bg-blue-500/10 text-blue-400'
                            }`}>{a.status}</span>
                          </div>
                          {step && (
                            <div className="mt-1 pl-3.5 text-[10px] font-mono text-zinc-500 line-clamp-1">{step.task}</div>
                          )}
                          <div className="mt-1 pl-3.5 flex items-center gap-2">
                            <span className="text-[9px] font-mono text-zinc-700">{a.agentId.slice(0, 8)}</span>
                            {step && <span className="text-[9px] font-mono text-zinc-700">{step.type} / {step.model || 'sonnet'}</span>}
                          </div>
                        </a>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
