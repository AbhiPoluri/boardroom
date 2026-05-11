'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Trash2, Save, Play, X, ListTodo, StopCircle, Loader2, List, Network,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { PlanCanvas, type CanvasSubtask } from '@/components/PlanCanvas';
import type { Persona, PlanWithSubtasks } from '@/lib/db';

interface SubtaskDraft {
  id?: string;
  title: string;
  description: string;
  required_skills: string[];
  persona_id: string | null;
  depends_on?: string[];
  canvas_x?: number | null;
  canvas_y?: number | null;
}

interface PlanDraft {
  id?: string;
  title: string;
  description: string;
  execution_mode: 'parallel' | 'sequential';
  subtasks: SubtaskDraft[];
}

const EMPTY: PlanDraft = {
  title: '',
  description: '',
  execution_mode: 'parallel',
  subtasks: [],
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'draft',
  active: 'running',
  done: 'done',
  cancelled: 'cancelled',
};

const STATUS_DOT: Record<string, string> = {
  draft: 'var(--fg-faint)',
  active: 'var(--moss)',
  done: 'var(--slate-tone)',
  cancelled: 'var(--brick)',
};

export default function PlanningPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PlanWithSubtasks[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [draft, setDraft] = useState<PlanDraft>(EMPTY);
  const [creating, setCreating] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'list' | 'canvas'>('list');

  const refresh = useCallback(async () => {
    try {
      const [pr, ar] = await Promise.all([fetch('/api/plans'), fetch('/api/personas')]);
      const pd = await pr.json();
      const ad = await ar.json();
      setPlans(pd.plans || []);
      setPersonas(ad.personas || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  const loadPlan = (p: PlanWithSubtasks) => {
    setDraft({
      id: p.id,
      title: p.title,
      description: p.description || '',
      execution_mode: p.execution_mode,
      subtasks: p.subtasks.map(t => ({
        id: t.id,
        title: t.title || t.description.slice(0, 80),
        description: t.description,
        required_skills: t.required_skills_json ? JSON.parse(t.required_skills_json) : [],
        persona_id: t.persona_id,
        depends_on: t.depends_on_json ? JSON.parse(t.depends_on_json) : [],
        canvas_x: t.canvas_x,
        canvas_y: t.canvas_y,
      })),
    });
    setCreating(false);
  };

  const newPlan = () => {
    setDraft({ ...EMPTY });
    setCreating(true);
  };

  const addSubtask = () => {
    setDraft(d => ({
      ...d,
      subtasks: [...d.subtasks, { title: '', description: '', required_skills: [], persona_id: null }],
    }));
  };

  const updateSubtask = (idx: number, patch: Partial<SubtaskDraft>) => {
    setDraft(d => ({
      ...d,
      subtasks: d.subtasks.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
  };

  const removeSubtask = (idx: number) => {
    setDraft(d => ({ ...d, subtasks: d.subtasks.filter((_, i) => i !== idx) }));
  };

  const moveSubtask = (idx: number, delta: number) => {
    setDraft(d => {
      const next = [...d.subtasks];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return d;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...d, subtasks: next };
    });
  };

  const save = async () => {
    if (!draft.title.trim()) { toast.error('plan needs a title'); return; }
    if (draft.subtasks.length === 0) { toast.error('plan needs at least one subtask'); return; }
    setBusy(true);
    try {
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        execution_mode: draft.execution_mode,
        subtasks: draft.subtasks
          .filter(s => s.title.trim())
          .map(s => ({
            id: s.id,
            title: s.title.trim(),
            description: s.description.trim() || s.title.trim(),
            required_skills: s.required_skills,
            persona_id: s.persona_id,
            depends_on: s.depends_on ?? [],
            canvas_x: s.canvas_x ?? null,
            canvas_y: s.canvas_y ?? null,
          })),
      };
      let id = draft.id;
      if (creating || !id) {
        const r = await fetch('/api/plans', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) { toast.error('save failed'); return; }
        const d = await r.json();
        id = d.id;
        toast.success('plan saved');
      } else {
        const r = await fetch(`/api/plans/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) { toast.error('save failed'); return; }
        toast.success('saved');
      }
      await refresh();
      if (id) {
        const r = await fetch(`/api/plans/${id}`);
        if (r.ok) {
          const d = await r.json();
          if (d.plan) loadPlan(d.plan);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!draft.id) { toast.error('save the plan first'); return; }
    if (draft.subtasks.length > 5) {
      if (!confirm(`Start plan? This will spawn up to ${draft.subtasks.length} agents.`)) return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/plans/${draft.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast.error(err.error || 'start failed');
        return;
      }
      const d = await r.json();
      toast.success(`opened ${d.opened} of ${d.total} subtasks`);
      router.push('/');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!draft.id) return;
    if (!confirm(`Cancel plan "${draft.title}" and all its non-done subtasks?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/plans/${draft.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      await refresh();
      newPlan();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id) return;
    if (!confirm(`Delete plan "${draft.title}"? Its subtasks will become orphan board tasks.`)) return;
    await fetch(`/api/plans/${draft.id}`, { method: 'DELETE' });
    await refresh();
    newPlan();
  };

  const activePlan = plans.find(p => p.id === draft.id);

  return (
    <div className="brr-os-planning-page">
      <aside className="brr-os-planning-list">
        <div className="brr-os-pane-head">
          <span className="brr-os-pane-title"><ListTodo className="w-3 h-3" strokeWidth={1.75} /> plans</span>
          <button
            type="button"
            className="brr-btn brr-btn--ghost"
            onClick={newPlan}
            style={{ marginLeft: 'auto' }}
          >
            <Plus className="w-3 h-3" strokeWidth={1.75} /> new
          </button>
        </div>
        <div className="brr-os-pane-body">
          {plans.length === 0 ? (
            <div className="brr-os-empty">no plans yet — click + new</div>
          ) : plans.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadPlan(p)}
              className={`brr-os-planning-list-item ${draft.id === p.id ? 'is-on' : ''}`}
            >
              <div className="brr-os-planning-list-head">
                <span className="brr-os-planning-list-title">{p.title}</span>
                <span className="brr-os-persona-status" style={{ marginLeft: 'auto' }}>
                  <span className="brr-os-persona-dot" style={{ background: STATUS_DOT[p.status] || '#888' }} />
                  {STATUS_LABEL[p.status] || p.status}
                </span>
              </div>
              <div className="brr-os-planning-list-meta">
                {p.done} / {p.total} subtasks · {p.execution_mode}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="brr-os-planning-editor">
        <div className="brr-os-pane-head">
          <span className="brr-os-pane-title">
            {creating ? 'new plan' : draft.id ? 'edit plan' : 'select a plan'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {draft.id && (
              <>
                <button type="button" className="brr-btn brr-btn--ghost" onClick={remove} disabled={busy}>
                  <Trash2 className="w-3 h-3" strokeWidth={1.5} /> delete
                </button>
                {activePlan?.status === 'active' && (
                  <button type="button" className="brr-btn brr-btn--ghost" onClick={cancel} disabled={busy}>
                    <StopCircle className="w-3 h-3" strokeWidth={1.5} /> cancel run
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="brr-os-planning-form">
          <div className="brr-os-form-row">
            <label>title</label>
            <input
              value={draft.title}
              onChange={e => setDraft({ ...draft, title: e.target.value })}
              placeholder="Q3 launch checklist"
            />
          </div>
          <div className="brr-os-form-row" style={{ alignItems: 'flex-start' }}>
            <label>description</label>
            <textarea
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              placeholder="What this plan accomplishes overall…"
              rows={3}
            />
          </div>
          <div className="brr-os-form-row">
            <label>mode</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`brr-btn ${draft.execution_mode === 'parallel' ? 'brr-btn--primary' : 'brr-btn--ghost'}`}
                onClick={() => setDraft({ ...draft, execution_mode: 'parallel' })}
              >parallel</button>
              <button
                type="button"
                className={`brr-btn ${draft.execution_mode === 'sequential' ? 'brr-btn--primary' : 'brr-btn--ghost'}`}
                onClick={() => setDraft({ ...draft, execution_mode: 'sequential' })}
              >sequential</button>
              <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                parallel = all at once · sequential = one at a time
              </span>
            </div>
          </div>

          <div className="brr-os-planning-subtasks">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className="brr-os-eyebrow">subtasks</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, padding: 2, background: 'var(--bg-hover)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className={`brr-btn ${view === 'list' ? 'brr-btn--primary' : 'brr-btn--ghost'}`}
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  title="ordered list"
                >
                  <List className="w-3 h-3" strokeWidth={1.75} /> list
                </button>
                <button
                  type="button"
                  onClick={() => setView('canvas')}
                  className={`brr-btn ${view === 'canvas' ? 'brr-btn--primary' : 'brr-btn--ghost'}`}
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  title="DAG canvas — drag node to node to wire dependencies"
                >
                  <Network className="w-3 h-3" strokeWidth={1.75} /> canvas
                </button>
              </div>
            </div>

            {view === 'list' ? (
              <>
                {draft.subtasks.length === 0 && (
                  <div className="brr-os-empty" style={{ padding: '16px 0' }}>
                    no subtasks yet. add the first step below.
                  </div>
                )}
                {draft.subtasks.map((s, i) => (
                  <SubtaskRow
                    key={s.id ?? `new-${i}`}
                    index={i}
                    draft={s}
                    personas={personas}
                    onChange={patch => updateSubtask(i, patch)}
                    onRemove={() => removeSubtask(i)}
                    onMove={delta => moveSubtask(i, delta)}
                    isFirst={i === 0}
                    isLast={i === draft.subtasks.length - 1}
                  />
                ))}
                <button
                  type="button"
                  className="brr-os-composer-trigger"
                  onClick={addSubtask}
                  style={{ marginTop: 8 }}
                >
                  <Plus className="w-3 h-3" strokeWidth={1.75} />
                  add subtask
                </button>
              </>
            ) : (
              <>
                <PlanCanvas
                  subtasks={draft.subtasks as CanvasSubtask[]}
                  personas={personas}
                  onChange={(next) => setDraft(d => {
                    // Merge by index AND handle inserts (length grew via canvas dbl-click).
                    const merged = next.map((s, i) => i < d.subtasks.length ? { ...d.subtasks[i], ...s } : s);
                    return { ...d, subtasks: merged };
                  })}
                  onAdd={addSubtask}
                />
                <p style={{ marginTop: 8, font: '400 11px var(--font-mono)', color: 'var(--fg-muted)' }}>
                  {draft.subtasks.length === 0
                    ? 'click + add or double-click anywhere on the canvas to start · drag handles to wire dependencies'
                    : 'drag a node to move it · drag from one node\'s bottom handle to another\'s top to wire a dependency · in parallel mode, a subtask waits until all its deps finish'}
                </p>
              </>
            )}
          </div>

          <div className="brr-os-form-foot" style={{ gap: 8 }}>
            <button
              type="button"
              className="brr-btn"
              onClick={save}
              disabled={busy || !draft.title.trim() || draft.subtasks.length === 0}
            >
              <Save className="w-3 h-3" strokeWidth={1.75} />
              {creating ? 'save draft' : 'save changes'}
            </button>
            {draft.id && activePlan?.status === 'draft' && (
              <button
                type="button"
                className="brr-btn brr-btn--primary"
                onClick={start}
                disabled={busy || draft.subtasks.length === 0}
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.75} /> : <Play className="w-3 h-3" strokeWidth={1.75} />}
                start plan
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function SubtaskRow({
  index, draft, personas, onChange, onRemove, onMove, isFirst, isLast,
}: {
  index: number;
  draft: SubtaskDraft;
  personas: Persona[];
  onChange: (patch: Partial<SubtaskDraft>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [skillInput, setSkillInput] = useState('');

  return (
    <div className="brr-os-planning-subtask">
      <div className="brr-os-planning-subtask-row">
        <div className="brr-os-planning-subtask-handle">
          <button type="button" onClick={() => onMove(-1)} disabled={isFirst} title="move up">↑</button>
          <span className="brr-os-planning-subtask-num">{index + 1}</span>
          <button type="button" onClick={() => onMove(1)} disabled={isLast} title="move down">↓</button>
        </div>
        <input
          value={draft.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder="step title"
          className="brr-os-planning-subtask-title"
        />
        <select
          value={draft.persona_id ?? ''}
          onChange={e => onChange({ persona_id: e.target.value || null })}
          className="brr-os-composer-select"
          title="pre-assign to a persona (else auto-pickup)"
        >
          <option value="">auto-pickup</option>
          {personas.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="button" className="brr-btn brr-btn--ghost" onClick={onRemove}>
          <X className="w-3 h-3" strokeWidth={1.75} />
        </button>
      </div>

      <textarea
        value={draft.description}
        onChange={e => onChange({ description: e.target.value })}
        placeholder="what should the persona do?"
        rows={2}
        className="brr-os-planning-subtask-desc"
      />

      <div className="brr-os-composer-skills" style={{ width: '100%' }}>
        {draft.required_skills.map(s => (
          <span key={s} className="brr-os-skill-pill">
            {s}
            <button
              type="button"
              className="brr-os-skill-x"
              onClick={() => onChange({ required_skills: draft.required_skills.filter(x => x !== s) })}
            >×</button>
          </span>
        ))}
        <input
          value={skillInput}
          onChange={e => setSkillInput(e.target.value)}
          className="brr-os-composer-skill-input"
          placeholder="+ skill"
          onKeyDown={e => {
            if (e.key === 'Enter' && skillInput.trim()) {
              e.preventDefault();
              if (!draft.required_skills.includes(skillInput.trim())) {
                onChange({ required_skills: [...draft.required_skills, skillInput.trim()] });
              }
              setSkillInput('');
            }
          }}
        />
      </div>
    </div>
  );
}
