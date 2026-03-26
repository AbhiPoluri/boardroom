'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Plus, Trash2, Play, Save, Workflow, Clock,
  Zap, Activity, CheckCircle2, XCircle, Eye, Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SubNav } from '@/components/SubNav';
import CronPicker from '@/components/CronPicker';
import WorkflowCanvas from '@/components/WorkflowCanvas';
import { describeCron } from '@/lib/cron-utils';
import type { AgentType } from '@/types';

interface WorkflowStep {
  name: string;
  type: AgentType;
  model?: string;
  task: string;
  dependsOn?: string[];
  parallel?: boolean;
  stepType?: 'standard' | 'evaluator' | 'router';
  maxRetries?: number;
  routes?: string[];
  agentConfig?: string;
}

interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  schedule?: string | null;
  cron_enabled?: number;
}

const TYPE_THEME: Record<string, { dot: string; badge: string; ring: string; label: string }> = {
  claude: { dot: 'bg-blue-400', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20', ring: 'ring-blue-500/20', label: 'text-blue-400' },
  codex: { dot: 'bg-amber-400', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20', ring: 'ring-amber-500/20', label: 'text-amber-400' },
  opencode: { dot: 'bg-green-400', badge: 'bg-green-500/10 text-green-400 border-green-500/20', ring: 'ring-green-500/20', label: 'text-green-400' },
  custom: { dot: 'bg-purple-400', badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20', ring: 'ring-purple-500/20', label: 'text-purple-400' },
  test: { dot: 'bg-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', ring: 'ring-emerald-500/20', label: 'text-emerald-400' },
};


const DRAFTS_KEY = 'boardroom:workflow-drafts';
const ACTIVE_DRAFT_KEY = 'boardroom:workflow-active-draft';

interface DraftState {
  id: string;
  selected: string | null;
  isNew: boolean;
  name: string;
  desc: string;
  steps: WorkflowStep[];
  schedule: string;
  cronEnabled: boolean;
  savedAt: number;
}

function loadDrafts(): DraftState[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const drafts = JSON.parse(raw) as DraftState[];
    // Expire drafts older than 7 days
    const valid = drafts.filter(d => Date.now() - d.savedAt < 7 * 24 * 60 * 60 * 1000);
    if (valid.length !== drafts.length) localStorage.setItem(DRAFTS_KEY, JSON.stringify(valid));
    return valid;
  } catch { return []; }
}

function saveDrafts(drafts: DraftState[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch {}
}

function getActiveDraftId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_DRAFT_KEY);
}

function setActiveDraftId(id: string | null) {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem(ACTIVE_DRAFT_KEY, id);
  else localStorage.removeItem(ACTIVE_DRAFT_KEY);
}

function genDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

interface AgentConfigOption {
  slug: string;
  name: string;
  type: string;
  model?: string;
  description: string;
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfigOption[]>([]);
  const [drafts, setDrafts] = useState<DraftState[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [running, setRunning] = useState(false);

  const [edName, setEdName] = useState('');
  const [edDesc, setEdDesc] = useState('');
  const [edSteps, setEdSteps] = useState<WorkflowStep[]>([]);
  const [edSchedule, setEdSchedule] = useState('0 * * * *');
  const [edCronEnabled, setEdCronEnabled] = useState(false);
  const [isNew, setIsNew] = useState(false);

  // Only true after the user has actually changed something in the editor.
  // Prevents a programmatic load (selectWorkflow) from immediately creating a draft.
  const isDirty = useRef(false);

  // Auto-save current editor state as a draft
  useEffect(() => {
    if (!isNew && !selected) return;
    // Don't auto-create a new draft until the user has actually edited something.
    // If a draft is already in progress (currentDraftId set), keep saving it.
    if (!currentDraftId && !isDirty.current) return;
    const timeout = setTimeout(() => {
      const draftId = currentDraftId || genDraftId();
      if (!currentDraftId) setCurrentDraftId(draftId);
      const draft: DraftState = {
        id: draftId, selected, isNew, name: edName, desc: edDesc,
        steps: edSteps, schedule: edSchedule, cronEnabled: edCronEnabled,
        savedAt: Date.now(),
      };
      setDrafts(prev => {
        const updated = prev.filter(d => d.id !== draftId);
        updated.unshift(draft);
        saveDrafts(updated);
        return updated;
      });
      setActiveDraftId(draftId);
    }, 500);
    return () => clearTimeout(timeout);
  }, [selected, isNew, edName, edDesc, edSteps, edSchedule, edCronEnabled, currentDraftId]);

  const deleteDraft = (draftId: string) => {
    setDrafts(prev => {
      const updated = prev.filter(d => d.id !== draftId);
      saveDrafts(updated);
      return updated;
    });
    if (currentDraftId === draftId) {
      setCurrentDraftId(null);
      setActiveDraftId(null);
    }
  };

  const loadDraftIntoEditor = (draft: DraftState) => {
    isDirty.current = false;
    setCurrentDraftId(draft.id);
    setActiveDraftId(draft.id);
    setSelected(draft.selected);
    setIsNew(draft.isNew);
    setEdName(draft.name);
    setEdDesc(draft.desc);
    setEdSteps(draft.steps);
    setEdSchedule(draft.schedule);
    setEdCronEnabled(draft.cronEnabled);
    setError('');
    setSuccess('');
    // Existing draft — allow auto-save to keep updating it
    isDirty.current = true;
  };


  // Active runs state
  interface WorkflowRun {
    runId: string;
    workflowName: string;
    status: 'running' | 'done' | 'error';
    agents: Array<{ stepName: string; agentId: string; status: string }>;
    stepOutputs?: Record<string, string>;
  }
  const [activeRuns, setActiveRuns] = useState<WorkflowRun[]>([]);
  const [viewingRun, setViewingRun] = useState<string | null>(null);
  const [viewedRunData, setViewedRunData] = useState<WorkflowRun | null>(null);
  const [viewedRunSteps, setViewedRunSteps] = useState<WorkflowStep[]>([]);

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
    // Restore draft state from localStorage after mount (avoids SSR/client hydration mismatch)
    const storedDrafts = loadDrafts();
    const storedActiveDraftId = getActiveDraftId();
    const storedActiveDraft = storedActiveDraftId
      ? storedDrafts.find(d => d.id === storedActiveDraftId)
      : null;

    if (storedDrafts.length > 0) setDrafts(storedDrafts);

    if (storedActiveDraft) {
      isDirty.current = false;
      setCurrentDraftId(storedActiveDraft.id);
      setEdName(storedActiveDraft.name);
      setEdDesc(storedActiveDraft.desc);
      setEdSteps(storedActiveDraft.steps);
      setEdSchedule(storedActiveDraft.schedule);
      setEdCronEnabled(storedActiveDraft.cronEnabled);
      setIsNew(storedActiveDraft.isNew);
      isDirty.current = true; // existing draft — keep auto-saving
    }

    Promise.all([
      fetch('/api/workflows').then(r => r.json()),
      fetch('/api/agent-configs').then(r => r.json()).catch(() => ({ configs: [] })),
    ]).then(([wfData, cfgData]) => {
      setWorkflows(wfData.workflows || []);
      setAgentConfigs(cfgData.configs || []);
      setLoading(false);
      // If restoring a draft editing an existing workflow, re-select it
      if (storedActiveDraft?.selected && !storedActiveDraft.isNew) {
        const wf = (wfData.workflows || []).find((w: WorkflowDef) => w.id === storedActiveDraft.selected);
        if (wf) setSelected(wf.id);
      }
    }).catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll active runs + fetch history
  useEffect(() => {
    const fetchRuns = () => {
      Promise.all([
        fetch('/api/workflows?runs=1').then(r => r.json()).catch(() => ({ runs: [] })),
        fetch('/api/workflows/history').then(r => r.json()).catch(() => ({ runs: [] })),
      ]).then(([runsData, historyData]) => {
        const inMemory: WorkflowRun[] = runsData.runs || [];
        const history: HistoryRun[] = historyData.runs || [];
        setRunHistory(history);

        // Merge: include DB history runs that are still "running" but not in in-memory
        // (happens after hot reload wipes the in-memory map)
        const inMemoryIds = new Set(inMemory.map(r => r.runId));
        const fromHistory: WorkflowRun[] = history
          .filter(h => h.status === 'running' && !inMemoryIds.has(h.id))
          .map(h => ({
            runId: h.id,
            workflowName: h.workflow_id,
            status: 'running' as const,
            agents: (h.agent_ids || []).map((aid: string) => ({ stepName: '?', agentId: aid, status: 'running' })),
          }));

        setActiveRuns([...inMemory, ...fromHistory]);
      });
    };
    fetchRuns();
    const iv = setInterval(fetchRuns, 8000);
    return () => clearInterval(iv);
  }, []);

  // Poll viewed run status (faster 3s interval for live canvas)
  useEffect(() => {
    if (!viewingRun) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/workflows?runId=${viewingRun}`);
        const data = await res.json();
        if (data.run) {
          setViewedRunData({
            runId: viewingRun,
            workflowName: data.run.workflowName,
            status: data.run.status,
            agents: data.run.agents || [],
            stepOutputs: data.run.stepOutputs || {},
          });
          // Also update in activeRuns list
          setActiveRuns(prev => prev.map(r => r.runId === viewingRun ? { ...r, ...data.run } : r));
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [viewingRun]);

  const handleCancelRun = async () => {
    if (!viewingRun) return;
    try {
      await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', runId: viewingRun }),
      });
    } catch {}
  };

  const selectWorkflow = (wf: WorkflowDef) => {
    isDirty.current = false;
    setCurrentDraftId(null);
    setActiveDraftId(null);
    setSelected(wf.id);
    setEdName(wf.name);
    setEdDesc(wf.description);
    setEdSteps(wf.steps);
    setEdSchedule(wf.schedule || '0 * * * *');
    setEdCronEnabled(!!wf.cron_enabled);
    setIsNew(false);
    setViewingRun(null);
    setViewedRunData(null);
    setError('');
    setSuccess('');
  };

  const viewRun = (runId: string) => {
    setViewingRun(runId);
    setSelected(null);
    setIsNew(false);
    // Find matching run + workflow steps
    const run = activeRuns.find(r => r.runId === runId);
    if (run) {
      setViewedRunData(run);
      const wf = workflows.find(w => w.name === run.workflowName);
      if (wf) setViewedRunSteps(wf.steps);
    }
  };

  const startNew = () => {
    const newDraftId = genDraftId();
    setCurrentDraftId(newDraftId);
    setActiveDraftId(newDraftId);
    setSelected(null);
    setViewingRun(null);
    setViewedRunData(null);
    setEdName('');
    setEdDesc('');
    setEdSteps([{ name: 'step-1', type: 'claude', model: 'sonnet', task: '', parallel: false }]);
    setEdSchedule('0 * * * *');
    setEdCronEnabled(false);
    setIsNew(true);
    setError('');
  };

  const addStep = () => {
    setEdSteps(prev => [...prev, { name: `step-${prev.length + 1}`, type: 'claude', model: 'sonnet', task: '', parallel: false }]);
  };

  const removeStep = (idx: number) => setEdSteps(prev => prev.filter((_, i) => i !== idx));


  const handleSave = async () => {
    if (!edName.trim()) { setError('Name required'); return; }
    if (edSteps.length === 0) { setError('Add at least one step'); return; }
    setSaving(true);
    setError('');
    try {
      const method = isNew ? 'POST' : 'PUT';
      const body = isNew
        ? { name: edName, description: edDesc, steps: edSteps, schedule: edCronEnabled ? edSchedule : null, cron_enabled: edCronEnabled ? 1 : 0 }
        : { id: selected, name: edName, description: edDesc, steps: edSteps, schedule: edCronEnabled ? edSchedule : null, cron_enabled: edCronEnabled ? 1 : 0 };
      const res = await fetch('/api/workflows', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      const wfRes = await fetch('/api/workflows');
      const wfData = await wfRes.json();
      setWorkflows(wfData.workflows || []);
      if (data.workflow?.id) setSelected(data.workflow.id);
      setIsNew(false);
      setSuccess('saved');
      isDirty.current = false;
      if (currentDraftId) deleteDraft(currentDraftId);
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

  const handleDuplicate = () => {
    const newDraftId = genDraftId();
    setCurrentDraftId(newDraftId);
    setActiveDraftId(newDraftId);
    setSelected(null);
    setViewingRun(null);
    setViewedRunData(null);
    setEdName(`${edName}-copy`);
    // edDesc, edSteps, edSchedule, edCronEnabled already loaded from selected workflow
    setIsNew(true);
    setError('');
    setSuccess('');
    isDirty.current = true;
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
  }, [runId, runStatus]);

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
        // Switch to canvas run viewer
        setViewingRun(data.runId);
        setViewedRunSteps(edSteps);
        setViewedRunData({
          runId: data.runId,
          workflowName: edName,
          status: 'running',
          agents: data.agents || [],
        });
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
  const viewedRun = viewedRunData || activeRuns.find(r => r.runId === viewingRun) || null;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <SubNav tabs={[{ label: 'workflows', href: '/workflows', active: true }, { label: 'cron', href: '/cron', active: false }]} />
          <h1 className="font-mono text-sm text-zinc-100">pipelines</h1>
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
              {edCronEnabled && edSchedule && (
                <Badge className="text-[9px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {describeCron(edSchedule)}
                </Badge>
              )}
              {currentDraftId && (
                <Badge className="text-[9px] font-mono bg-amber-500/15 text-amber-400 border-amber-500/25">
                  draft
                </Badge>
              )}
              {error && <Badge variant="destructive" className="text-[10px] font-mono">{error}</Badge>}
              {success && <Badge className="text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border-emerald-500/25">{success}</Badge>}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {hasEditor && (
            <>
              {!isNew && selected && (
                <>
                  <Button onClick={handleDuplicate} variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-600 hover:text-zinc-300" title="Duplicate workflow">
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button onClick={handleDelete} variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-600 hover:text-red-400" aria-label="Delete workflow">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
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
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-medium truncate">{wf.name}</span>
                    {!!wf.cron_enabled && wf.schedule && (
                      <Clock className="w-3 h-3 text-amber-400 flex-shrink-0" />
                    )}
                  </div>
                  {/* Mini pipeline + cron badge */}
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
                    {!!wf.cron_enabled && wf.schedule && (
                      <span className="text-[8px] font-mono text-amber-400/70 ml-auto px-1 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                        {describeCron(wf.schedule)}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}

            {/* Templates */}
            <Separator className="my-2 bg-zinc-800" />
            <div className="px-2 pt-1 pb-1.5 flex items-center gap-1.5">
              <Workflow className="w-3 h-3 text-zinc-600" />
              <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">templates</span>
            </div>
            {[
              {
                label: 'PR Review Pipeline',
                desc: 'code-reviewer → security-scanner → summarizer',
                steps: [
                  { name: 'code-reviewer', type: 'claude' as AgentType, model: 'sonnet', task: 'Review the code changes for correctness, readability, and best practices.', parallel: false },
                  { name: 'security-scanner', type: 'claude' as AgentType, model: 'sonnet', task: 'Scan the code for security vulnerabilities and potential exploits.', dependsOn: ['code-reviewer'], parallel: false },
                  { name: 'summarizer', type: 'claude' as AgentType, model: 'haiku', task: 'Summarize the review findings from the code reviewer and security scanner into a concise PR comment.', dependsOn: ['security-scanner'], parallel: false },
                ],
              },
              {
                label: 'Test & Deploy',
                desc: 'test-runner → deploy',
                steps: [
                  { name: 'test-runner', type: 'claude' as AgentType, model: 'sonnet', task: 'Run the full test suite and report any failures.', parallel: false },
                  { name: 'deploy', type: 'claude' as AgentType, model: 'sonnet', task: 'Deploy the application to the target environment after tests pass.', dependsOn: ['test-runner'], parallel: false },
                ],
              },
              {
                label: 'Code Quality Audit',
                desc: 'linter + security-scanner (parallel) → report',
                steps: [
                  { name: 'linter', type: 'claude' as AgentType, model: 'haiku', task: 'Lint the codebase and list all style violations and warnings.', parallel: true },
                  { name: 'security-scanner', type: 'claude' as AgentType, model: 'sonnet', task: 'Scan the codebase for security issues and dependency vulnerabilities.', parallel: true },
                  { name: 'report', type: 'claude' as AgentType, model: 'sonnet', task: 'Consolidate the linter and security scanner findings into a structured quality report.', dependsOn: ['linter', 'security-scanner'], parallel: false },
                ],
              },
            ].map((tpl) => (
              <div key={tpl.label} className="px-3 py-2 rounded-lg text-zinc-500">
                <div className="font-mono text-[11px] font-medium text-zinc-400 truncate">{tpl.label}</div>
                <div className="text-[9px] font-mono text-zinc-700 mt-0.5 truncate">{tpl.desc}</div>
                <button
                  onClick={() => {
                    const newDraftId = genDraftId();
                    setCurrentDraftId(newDraftId);
                    setActiveDraftId(newDraftId);
                    setSelected(null);
                    setViewingRun(null);
                    setViewedRunData(null);
                    setEdName(tpl.label);
                    setEdDesc(tpl.desc);
                    setEdSteps(tpl.steps);
                    setEdSchedule('0 * * * *');
                    setEdCronEnabled(false);
                    setIsNew(true);
                    setError('');
                    setSuccess('');
                    isDirty.current = true;
                  }}
                  className="mt-1.5 text-[9px] font-mono text-emerald-500 hover:text-emerald-400 transition-colors"
                >
                  use template →
                </button>
              </div>
            ))}

            {/* Drafts */}
            {drafts.length > 0 && (
              <>
                <Separator className="my-2 bg-zinc-800" />
                <div className="px-2 pt-1 pb-1.5 flex items-center gap-1.5">
                  <Eye className="w-3 h-3 text-amber-500/60" />
                  <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">drafts</span>
                  <Badge variant="outline" className="text-[8px] font-mono ml-auto h-4 px-1.5">
                    {drafts.length}
                  </Badge>
                </div>
                {drafts.map((d) => (
                  <div
                    key={d.id}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-all group/draft ${
                      currentDraftId === d.id
                        ? 'bg-amber-950/30 text-amber-300 ring-1 ring-amber-800/40'
                        : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => loadDraftIntoEditor(d)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="font-mono text-[11px] font-medium truncate">
                          {d.name || 'untitled'}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] font-mono text-zinc-700">
                            {d.steps.length} step{d.steps.length !== 1 ? 's' : ''}
                          </span>
                          <span className="text-[9px] font-mono text-zinc-700">
                            {new Date(d.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </button>
                      <button
                        onClick={() => deleteDraft(d.id)}
                        className="p-1 text-zinc-700 hover:text-red-400 opacity-0 group-hover/draft:opacity-100 transition-all flex-shrink-0"
                        title="Delete draft"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </>
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
                  const matchingWf = workflows.find(wf => wf.name === run.workflow_id || wf.id === run.workflow_id);
                  return (
                    <button
                      key={run.id}
                      onClick={() => { if (matchingWf) selectWorkflow(matchingWf); }}
                      disabled={!matchingWf}
                      className={`w-full text-left px-3 py-2 rounded-lg text-zinc-500 transition-all ${
                        matchingWf ? 'hover:bg-zinc-900 hover:text-zinc-400 cursor-pointer' : 'cursor-default opacity-60'
                      }`}
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
                        <div className={`text-[9px] font-mono mt-1 pl-3.5 ${run.status === 'error' ? 'text-red-400 font-medium' : 'text-red-400/70'} truncate`}>
                          {run.error}
                        </div>
                      )}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {viewedRun ? (
            /* Run viewer — canvas + progress bar */
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Compact run header */}
              <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-950/50">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center ${
                  viewedRun.status === 'running' ? 'bg-blue-500/15'
                    : viewedRun.status === 'done' ? 'bg-emerald-500/15'
                    : 'bg-red-500/15'
                }`}>
                  {viewedRun.status === 'running' ? <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                    : viewedRun.status === 'done' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                </div>
                <span className="font-mono text-[10px] text-zinc-600">{viewedRun.runId}</span>

                {/* Progress bar */}
                <div className="flex-1 max-w-[200px] h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      viewedRun.status === 'error' ? 'bg-red-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${viewedRun.agents.length > 0 ? (viewedRun.agents.filter(a => a.status === 'done').length / viewedRun.agents.length) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-zinc-500">
                  {viewedRun.agents.filter(a => a.status === 'done').length}/{viewedRun.agents.length}
                </span>

                {/* Step status pills */}
                <div className="flex items-center gap-1 ml-2">
                  {viewedRun.agents.map((a) => (
                    <div
                      key={a.agentId}
                      title={`${a.stepName}: ${a.status}`}
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        a.status === 'done' ? 'bg-emerald-400'
                          : a.status === 'running' ? 'bg-blue-400 animate-pulse'
                          : a.status === 'error' || a.status === 'killed' ? 'bg-red-400'
                          : 'bg-zinc-600'
                      }`}
                    />
                  ))}
                </div>

                <div className="ml-auto flex items-center gap-2">
                  {viewedRun.status === 'running' && (
                    <Button
                      onClick={handleCancelRun}
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] font-mono text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
                    >
                      <XCircle className="w-3 h-3 mr-1" /> cancel
                    </Button>
                  )}
                  <Button
                    onClick={() => { setViewingRun(null); setViewedRunData(null); }}
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-zinc-600 hover:text-zinc-400"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Canvas with live run status */}
              {viewedRunSteps.length > 0 ? (
                <WorkflowCanvas
                  steps={viewedRunSteps}
                  onChange={() => {}} // read-only
                  isRunning={viewedRun.status === 'running'}
                  stepOutputs={viewedRun.stepOutputs}
                  runAgents={viewedRun.agents}
                />
              ) : (
                /* Fallback: step list when no canvas layout available */
                <div className="flex-1 overflow-y-auto p-5">
                  <div className="max-w-lg mx-auto space-y-2">
                    {viewedRun.agents.map((a, i) => {
                      const wf = workflows.find(w => w.name === viewedRun.workflowName);
                      const step = wf?.steps[i];
                      return (
                        <div key={a.agentId} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-mono font-bold ${
                            a.status === 'done' ? 'bg-emerald-400 text-zinc-950'
                              : a.status === 'error' || a.status === 'killed' ? 'bg-red-400 text-zinc-950'
                              : a.status === 'running' ? 'bg-blue-400 text-zinc-950'
                              : 'bg-zinc-700 text-zinc-300'
                          }`}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-mono text-xs text-zinc-200 truncate block">{a.stepName}</span>
                            <span className="font-mono text-[10px] text-zinc-600">{a.agentId.slice(0, 8)}{step ? ` · ${step.type}/${step.model || 'sonnet'}` : ''}</span>
                          </div>
                          <Badge variant="outline" className={`text-[9px] font-mono ${
                            a.status === 'done' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                              : a.status === 'error' || a.status === 'killed' ? 'bg-red-500/10 text-red-400 border-red-500/25'
                              : a.status === 'running' ? 'bg-blue-500/10 text-blue-400 border-blue-500/25'
                              : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/25'
                          }`}>
                            {a.status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
              <div className="max-w-3xl mx-auto space-y-5">
                {/* Name + Desc */}
                <Card size="sm" className="bg-zinc-900/60 border-zinc-800">
                  <CardContent className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">name</label>
                      <Input
                        value={edName}
                        onChange={(e) => { isDirty.current = true; setEdName(e.target.value); }}
                        placeholder="my-workflow"
                        className="font-mono text-sm h-8 bg-zinc-950/50 border-zinc-800 text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">description</label>
                      <Input
                        value={edDesc}
                        onChange={(e) => { isDirty.current = true; setEdDesc(e.target.value); }}
                        placeholder="optional"
                        className="font-mono text-sm h-8 bg-zinc-950/50 border-zinc-800 text-zinc-100"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Pipeline canvas */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">pipeline</span>
                    <Badge variant="outline" className="text-[9px] font-mono">{edSteps.length} step{edSteps.length !== 1 ? 's' : ''}</Badge>
                  </div>
                </div>

                <WorkflowCanvas
                  steps={edSteps}
                  onChange={(steps) => { isDirty.current = true; setEdSteps(steps); }}
                  isRunning={running}
                  runAgents={runAgents}
                  agentConfigs={agentConfigs}
                />

                {/* Schedule section */}
                <Card className="bg-zinc-900/60 border-zinc-800">
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">schedule</span>
                        {edCronEnabled && (
                          <Badge variant="outline" className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border-emerald-500/25">
                            {describeCron(edSchedule)}
                          </Badge>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => { isDirty.current = true; setEdCronEnabled(!edCronEnabled); }}
                        className={`relative w-8 h-[18px] rounded-full transition-colors ${
                          edCronEnabled ? 'bg-emerald-600' : 'bg-zinc-700'
                        }`}
                      >
                        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                          edCronEnabled ? 'left-[16px]' : 'left-[2px]'
                        }`} />
                      </button>
                    </div>
                    {edCronEnabled && (
                      <CronPicker
                        value={edSchedule}
                        onChange={(v) => { isDirty.current = true; setEdSchedule(v); }}
                      />
                    )}
                  </CardContent>
                </Card>

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
