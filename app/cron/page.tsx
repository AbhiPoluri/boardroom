'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Clock, Play, Pause, Trash2, Edit2, RotateCcw, Calendar, X, Check, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import CronPicker from '@/components/CronPicker';

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  task: string;
  agent_type: string;
  model: string;
  repo: string | null;
  enabled: number;
  last_run: number | null;
  next_run: number | null;
  last_status: string | null;
  last_agent_id: string | null;
  run_count: number;
  created_at: number;
}

function relativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function nextRunLabel(ts: number | null): string {
  if (!ts) return '—';
  const diff = ts - Date.now();
  if (diff <= 0) return 'soon';
  if (diff < 60000) return 'in <1m';
  if (diff < 3600000) return `in ${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `in ${Math.floor(diff / 3600000)}h`;
  return `in ${Math.floor(diff / 86400000)}d`;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-[10px] font-mono text-zinc-700">—</span>;
  const map: Record<string, string> = {
    done: 'text-emerald-400 bg-emerald-950 border-emerald-800',
    error: 'text-red-400 bg-red-950 border-red-800',
    running: 'text-blue-400 bg-blue-950 border-blue-800',
  };
  const cls = map[status] || 'text-zinc-400 bg-zinc-800 border-zinc-700';
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}

const BLANK = {
  name: '',
  schedule: '0 * * * *',
  task: '',
  agent_type: 'claude',
  model: 'sonnet',
  repo: '',
};

// --- Draft system ---
const DRAFTS_KEY = 'boardroom:cron-drafts';
const ACTIVE_DRAFT_KEY = 'boardroom:cron-active-draft';

interface DraftState {
  id: string;
  editingId: string | null; // cron job ID if editing existing
  isNew: boolean;
  name: string;
  schedule: string;
  task: string;
  agentType: string;
  model: string;
  repo: string;
  savedAt: number;
}

function loadDrafts(): DraftState[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveDrafts(drafts: DraftState[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch {}
}

function getActiveDraftId(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(ACTIVE_DRAFT_KEY); } catch { return null; }
}

function setActiveDraftId(id: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (id) localStorage.setItem(ACTIVE_DRAFT_KEY, id);
    else localStorage.removeItem(ACTIVE_DRAFT_KEY);
  } catch {}
}

function genDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [form, setForm] = useState(BLANK);

  // Draft state
  const [drafts, setDrafts] = useState<DraftState[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(true);
  const isDirty = useRef(false);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/cron');
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {
      setError('Failed to load cron jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const iv = setInterval(fetchJobs, 10000);
    return () => clearInterval(iv);
  }, [fetchJobs]);

  // Restore drafts on mount
  useEffect(() => {
    const saved = loadDrafts();
    setDrafts(saved);
    const activeId = getActiveDraftId();
    if (activeId) {
      const active = saved.find(d => d.id === activeId);
      if (active) {
        setCurrentDraftId(active.id);
        setEditingId(active.editingId);
        setForm({
          name: active.name,
          schedule: active.schedule,
          task: active.task,
          agent_type: active.agentType,
          model: active.model,
          repo: active.repo,
        });
        setShowForm(true);
        isDirty.current = false;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft (500ms debounce)
  useEffect(() => {
    if (!isDirty.current || !showForm) return;
    const timer = setTimeout(() => {
      if (!isDirty.current) return;
      const draftId = currentDraftId || genDraftId();
      const draft: DraftState = {
        id: draftId,
        editingId,
        isNew: !editingId,
        name: form.name,
        schedule: form.schedule,
        task: form.task,
        agentType: form.agent_type,
        model: form.model,
        repo: form.repo,
        savedAt: Date.now(),
      };
      setDrafts(prev => {
        const next = prev.filter(d => d.id !== draftId);
        next.unshift(draft);
        saveDrafts(next);
        return next;
      });
      if (!currentDraftId) setCurrentDraftId(draftId);
      setActiveDraftId(draftId);
    }, 500);
    return () => clearTimeout(timer);
  }, [form, showForm, editingId, currentDraftId]);

  // Helper: delete a draft
  const deleteDraft = useCallback((id: string) => {
    setDrafts(prev => {
      const next = prev.filter(d => d.id !== id);
      saveDrafts(next);
      return next;
    });
    if (currentDraftId === id) {
      setCurrentDraftId(null);
      setActiveDraftId(null);
    }
  }, [currentDraftId]);

  // Helper: load draft into editor
  const loadDraftIntoEditor = useCallback((draft: DraftState) => {
    setEditingId(draft.editingId);
    setForm({
      name: draft.name,
      schedule: draft.schedule,
      task: draft.task,
      agent_type: draft.agentType,
      model: draft.model,
      repo: draft.repo,
    });
    setCurrentDraftId(draft.id);
    setActiveDraftId(draft.id);
    isDirty.current = false;
    setError('');
    setSuccess('');
    setShowForm(true);
  }, []);

  // Wrap setForm to mark dirty on user changes
  const updateForm = useCallback((updater: (prev: typeof BLANK) => typeof BLANK) => {
    isDirty.current = true;
    setForm(updater);
  }, []);

  const openNew = () => {
    setEditingId(null);
    setForm(BLANK);
    setCurrentDraftId(null);
    setActiveDraftId(null);
    isDirty.current = false;
    setError('');
    setSuccess('');
    setShowForm(true);
  };

  const openEdit = (job: CronJob) => {
    setEditingId(job.id);
    setForm({
      name: job.name,
      schedule: job.schedule,
      task: job.task,
      agent_type: job.agent_type,
      model: job.model,
      repo: job.repo || '',
    });
    setCurrentDraftId(null);
    setActiveDraftId(null);
    isDirty.current = false;
    setError('');
    setSuccess('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setCurrentDraftId(null);
    setActiveDraftId(null);
    setError('');
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.schedule.trim()) { setError('Schedule is required'); return; }
    if (!form.task.trim()) { setError('Task prompt is required'); return; }
    setSaving(true);
    setError('');
    try {
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId
        ? { id: editingId, ...form, repo: form.repo || null }
        : { ...form, repo: form.repo || null };
      const res = await fetch('/api/cron', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || 'Failed to save');
      }
      await fetchJobs();
      isDirty.current = false;
      if (currentDraftId) deleteDraft(currentDraftId);
      setSuccess(editingId ? 'updated' : 'created');
      setTimeout(() => setSuccess(''), 2000);
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleJob = async (job: CronJob) => {
    try {
      await fetch('/api/cron', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, enabled: job.enabled ? 0 : 1 }),
      });
      await fetchJobs();
    } catch {
      setError('Failed to toggle');
    }
  };

  const deleteJob = async (job: CronJob) => {
    if (!confirm(`Delete cron job "${job.name}"?`)) return;
    try {
      await fetch('/api/cron', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id }),
      });
      setJobs(prev => prev.filter(j => j.id !== job.id));
    } catch {
      setError('Failed to delete');
    }
  };

  const runJob = async (job: CronJob) => {
    setRunningId(job.id);
    try {
      await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', id: job.id }),
      });
      setTimeout(fetchJobs, 1000);
    } catch {
      setError('Failed to trigger run');
    } finally {
      setTimeout(() => setRunningId(null), 2000);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-sm text-zinc-100">cron jobs</h1>
          {jobs.length > 0 && (
            <span className="text-[10px] font-mono text-zinc-600">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {success && <span className="text-[10px] font-mono text-emerald-400">{success}</span>}
          {error && !showForm && <span className="text-[10px] font-mono text-red-400">{error}</span>}
          <Button
            onClick={openNew}
            className="font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-white h-7 px-3"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            new job
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-xs font-mono text-zinc-600 animate-pulse text-center">loading...</div>
        ) : jobs.length === 0 && !showForm ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center mb-6 border border-zinc-800">
              <Calendar className="w-8 h-8 text-zinc-600" />
            </div>
            <h2 className="text-lg font-mono text-zinc-300 mb-2">no cron jobs yet</h2>
            <p className="text-sm font-mono text-zinc-500 max-w-md mb-6 leading-relaxed">
              Schedule agents to run automatically on a recurring basis — daily reports, periodic code reviews, automated deployments, or anything else you want on a schedule.
            </p>
            <Button
              onClick={openNew}
              className="font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-white h-8 px-4"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              create first job
            </Button>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto p-6 space-y-3">
            {/* Job list */}
            {/* Drafts section */}
            {drafts.length > 0 && (
              <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 overflow-hidden">
                <button
                  onClick={() => setDraftsOpen(o => !o)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-amber-950/30 transition-colors"
                >
                  {draftsOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-amber-500" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-amber-500" />
                  )}
                  <FileText className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-mono text-xs text-amber-400">drafts</span>
                  <span className="font-mono text-[10px] text-amber-600">{drafts.length}</span>
                </button>
                {draftsOpen && (
                  <div className="border-t border-amber-900/40 divide-y divide-amber-900/30">
                    {drafts.map((draft) => (
                      <div
                        key={draft.id}
                        className={`flex items-center gap-3 px-4 py-2.5 group ${
                          currentDraftId === draft.id ? 'bg-amber-950/40' : 'hover:bg-amber-950/20'
                        }`}
                      >
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => loadDraftIntoEditor(draft)}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-amber-200 truncate">
                              {draft.name || '(untitled)'}
                            </span>
                            {draft.editingId && (
                              <span className="text-[9px] font-mono text-amber-700 bg-amber-950 px-1 py-0.5 rounded border border-amber-800">
                                editing
                              </span>
                            )}
                            {currentDraftId === draft.id && (
                              <span className="text-[9px] font-mono text-amber-500">active</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="font-mono text-[10px] text-amber-700 truncate max-w-[200px]">
                              {draft.task || '(no task)'}
                            </span>
                            <span className="font-mono text-[10px] text-amber-800">
                              {new Date(draft.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => loadDraftIntoEditor(draft)}
                            title="load draft"
                            className="p-1 rounded text-amber-600 hover:text-amber-400 hover:bg-amber-900/40 transition-colors"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deleteDraft(draft.id)}
                            title="discard draft"
                            className="p-1 rounded text-amber-600 hover:text-red-400 hover:bg-amber-900/40 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {jobs.map((job) => (
              <div
                key={job.id}
                className={`rounded-xl border bg-zinc-900/50 p-4 transition-opacity ${
                  job.enabled ? 'border-zinc-800 opacity-100' : 'border-zinc-800/50 opacity-60'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-mono text-sm ${job.enabled ? 'text-zinc-100' : 'text-zinc-500 line-through'}`}>
                        {job.name}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">
                        {job.schedule}
                      </span>
                      <StatusBadge status={job.last_status} />
                    </div>
                    <p className="font-mono text-xs text-zinc-500 truncate mb-2">{job.task}</p>
                    <div className="flex items-center gap-4 text-[10px] font-mono text-zinc-600">
                      <span>agent: <span className="text-zinc-500">{job.agent_type}/{job.model}</span></span>
                      {job.repo && <span>repo: <span className="text-zinc-500">{job.repo}</span></span>}
                      <span>last run: <span className="text-zinc-500">{relativeTime(job.last_run)}</span></span>
                      <span>runs: <span className="text-zinc-500">{job.run_count}</span></span>
                      {job.next_run && <span>next: <span className="text-zinc-500">{nextRunLabel(job.next_run)}</span></span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Manual run */}
                    <button
                      onClick={() => runJob(job)}
                      disabled={runningId === job.id}
                      title="run now"
                      className="p-1.5 rounded text-zinc-600 hover:text-emerald-400 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                    >
                      {runningId === job.id ? (
                        <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {/* Toggle enable/disable */}
                    <button
                      onClick={() => toggleJob(job)}
                      title={job.enabled ? 'disable' : 'enable'}
                      className={`p-1.5 rounded transition-colors hover:bg-zinc-800 ${
                        job.enabled ? 'text-emerald-400 hover:text-zinc-400' : 'text-zinc-600 hover:text-emerald-400'
                      }`}
                    >
                      {job.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    {/* Edit */}
                    <button
                      onClick={() => openEdit(job)}
                      title="edit"
                      className="p-1.5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => deleteJob(job)}
                      title="delete"
                      className="p-1.5 rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl mx-4">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
              <h2 className="font-mono text-sm text-zinc-100">
                {editingId ? 'edit cron job' : 'new cron job'}
              </h2>
              <button onClick={closeForm} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form body */}
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {error && (
                <div className="text-[11px] font-mono text-red-400 bg-red-950/40 border border-red-900/50 rounded px-3 py-2">
                  {error}
                </div>
              )}

              {/* Name */}
              <div className="space-y-1">
                <Label className="font-mono text-[10px] text-zinc-500">name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => updateForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="daily-report"
                  className="font-mono text-sm h-8 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-700 focus:border-emerald-800"
                />
              </div>

              {/* Schedule */}
              <div className="space-y-1.5">
                <Label className="font-mono text-[10px] text-zinc-500">schedule (cron expression)</Label>
                <CronPicker
                  value={form.schedule}
                  onChange={(v) => updateForm(f => ({ ...f, schedule: v }))}
                />
              </div>

              {/* Task prompt */}
              <div className="space-y-1">
                <Label className="font-mono text-[10px] text-zinc-500">task prompt</Label>
                <Textarea
                  value={form.task}
                  onChange={(e) => updateForm(f => ({ ...f, task: e.target.value }))}
                  placeholder="Run a code review on the latest changes..."
                  className="font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-700 resize-none focus:border-emerald-800 min-h-[80px]"
                  spellCheck={false}
                />
              </div>

              {/* Agent type + model */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="font-mono text-[10px] text-zinc-500">agent type</Label>
                  <div className="flex gap-1 flex-wrap">
                    {(['claude', 'codex', 'custom'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => updateForm(f => ({ ...f, agent_type: t }))}
                        className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                          form.agent_type === t
                            ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="font-mono text-[10px] text-zinc-500">model</Label>
                  <Input
                    value={form.model}
                    onChange={(e) => updateForm(f => ({ ...f, model: e.target.value }))}
                    placeholder="sonnet"
                    className="font-mono text-sm h-8 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-700 focus:border-emerald-800"
                  />
                </div>
              </div>

              {/* Repo */}
              <div className="space-y-1">
                <Label className="font-mono text-[10px] text-zinc-500">repo path (optional)</Label>
                <Input
                  value={form.repo}
                  onChange={(e) => updateForm(f => ({ ...f, repo: e.target.value }))}
                  placeholder="/path/to/repo"
                  className="font-mono text-sm h-8 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-700 focus:border-emerald-800"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-zinc-800">
              <Button
                variant="outline"
                onClick={closeForm}
                className="font-mono text-xs h-7 px-3 border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              >
                cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-white h-7 px-4 disabled:opacity-50"
              >
                {saving ? 'saving...' : editingId ? 'update' : 'create'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
