'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Save, Play, X, Clock, ListChecks } from 'lucide-react';
import { toast } from '@/lib/toast';
import { humanizeCron } from '@/lib/cron-humanize';
import type { Persona, TaskList } from '@/lib/db';

interface Schedule {
  id: string;
  name: string;
  schedule: string;
  task: string;
  persona_id: string | null;
  enabled: number;
  last_run: number | null;
  last_status: string | null;
  run_count: number;
}

type Tab = 'schedules' | 'lists';

export default function WorkflowsPage() {
  const [tab, setTab] = useState<Tab>('schedules');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [creating, setCreating] = useState<'schedule' | 'list' | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, l, p] = await Promise.all([
        fetch('/api/schedules').then(r => r.json()),
        fetch('/api/task-lists').then(r => r.json()),
        fetch('/api/personas').then(r => r.json()),
      ]);
      setSchedules(s.schedules || []);
      setLists(l.taskLists || []);
      setPersonas(p.personas || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 8000);
    return () => clearInterval(iv);
  }, [refresh]);

  return (
    <div className="brr-os-workflows-page">
      <div className="brr-os-workflows-tabs">
        <button
          type="button"
          className={`brr-os-tab ${tab === 'schedules' ? 'is-on' : ''}`}
          onClick={() => setTab('schedules')}
        >
          <Clock className="w-3 h-3" strokeWidth={1.75} />
          schedules
          <span className="brr-os-tab-count">{schedules.length}</span>
        </button>
        <button
          type="button"
          className={`brr-os-tab ${tab === 'lists' ? 'is-on' : ''}`}
          onClick={() => setTab('lists')}
        >
          <ListChecks className="w-3 h-3" strokeWidth={1.75} />
          task lists
          <span className="brr-os-tab-count">{lists.length}</span>
        </button>
        <button
          type="button"
          className="brr-btn brr-btn--primary"
          style={{ marginLeft: 'auto' }}
          onClick={() => setCreating(tab === 'schedules' ? 'schedule' : 'list')}
        >
          <Plus className="w-3 h-3" strokeWidth={1.75} />
          new {tab === 'schedules' ? 'schedule' : 'list'}
        </button>
      </div>

      <div className="brr-os-workflows-body">
        {tab === 'schedules' && (
          <SchedulesTab
            schedules={schedules}
            personas={personas}
            creating={creating === 'schedule'}
            onClose={() => setCreating(null)}
            onChange={refresh}
          />
        )}
        {tab === 'lists' && (
          <ListsTab
            lists={lists}
            personas={personas}
            creating={creating === 'list'}
            onClose={() => setCreating(null)}
            onChange={refresh}
          />
        )}
      </div>
    </div>
  );
}

// ── Schedules ───────────────────────────────────────────────────────────────

function SchedulesTab({
  schedules, personas, creating, onClose, onChange,
}: {
  schedules: Schedule[];
  personas: Persona[];
  creating: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  return (
    <div className="brr-os-workflows-list">
      {creating && (
        <ScheduleEditor
          personas={personas}
          onClose={onClose}
          onSaved={() => { onClose(); onChange(); }}
        />
      )}
      {schedules.length === 0 && !creating && (
        <div className="brr-os-empty" style={{ padding: 48 }}>
          no schedules yet — create one to send a recurring prompt to a persona
        </div>
      )}
      {schedules.map(s => (
        <ScheduleRow
          key={s.id}
          schedule={s}
          personas={personas}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function ScheduleEditor({
  personas, onClose, onSaved, initial,
}: {
  personas: Persona[];
  onClose: () => void;
  onSaved: () => void;
  initial?: Partial<Schedule>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [schedule, setSchedule] = useState(initial?.schedule ?? '0 9 * * 1');
  const [task, setTask] = useState(initial?.task ?? '');
  const [personaId, setPersonaId] = useState(initial?.persona_id ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || !task.trim() || !schedule.trim() || !personaId) {
      toast.error('name, schedule, persona, and prompt are all required');
      return;
    }
    setBusy(true);
    try {
      const url = initial?.id ? `/api/schedules/${initial.id}` : '/api/schedules';
      const method = initial?.id ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), schedule: schedule.trim(), task: task.trim(), persona_id: personaId }),
      });
      if (!r.ok) { toast.error('save failed'); return; }
      toast.success(initial?.id ? 'updated' : 'schedule created');
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brr-os-workflow-editor">
      <div className="brr-os-form-row">
        <label>name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="weekly research roundup" />
      </div>
      <div className="brr-os-form-row">
        <label>persona</label>
        <select value={personaId} onChange={e => setPersonaId(e.target.value)}>
          <option value="">— pick a persona —</option>
          {personas.map(p => (
            <option key={p.id} value={p.id}>{p.name}{p.role ? ` · ${p.role}` : ''}</option>
          ))}
        </select>
      </div>
      <div className="brr-os-form-row" style={{ alignItems: 'flex-start' }}>
        <label>cron</label>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            value={schedule}
            onChange={e => setSchedule(e.target.value)}
            placeholder="0 9 * * 1"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--accent)', fontStyle: 'italic' }}>
              {humanizeCron(schedule) === schedule
                ? 'unrecognized — will run on the cron expression as-is'
                : `→ ${humanizeCron(schedule)}`}
            </span>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
              min hour day mo dow
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {[
              { label: 'every day @ 9am', val: '0 9 * * *' },
              { label: 'weekdays @ 9am', val: '0 9 * * 1-5' },
              { label: 'every Monday', val: '0 9 * * 1' },
              { label: 'every hour', val: '0 * * * *' },
              { label: 'every 15 min', val: '*/15 * * * *' },
            ].map(p => (
              <button
                key={p.val}
                type="button"
                onClick={() => setSchedule(p.val)}
                className="brr-os-skill-pill"
                style={{ cursor: 'pointer' }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="brr-os-form-row" style={{ alignItems: 'flex-start' }}>
        <label>prompt</label>
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          placeholder="What should the persona do each time this fires?"
          rows={4}
        />
      </div>
      <div className="brr-os-form-foot" style={{ gap: 8 }}>
        <button type="button" className="brr-btn brr-btn--ghost" onClick={onClose}>cancel</button>
        <button type="button" className="brr-btn brr-btn--primary" onClick={save} disabled={busy}>
          <Save className="w-3 h-3" strokeWidth={1.75} /> {initial?.id ? 'save' : 'create schedule'}
        </button>
      </div>
    </div>
  );
}

function ScheduleRow({
  schedule, personas, onChange,
}: {
  schedule: Schedule;
  personas: Persona[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const persona = personas.find(p => p.id === schedule.persona_id);

  const toggleEnabled = async () => {
    await fetch(`/api/schedules/${schedule.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !schedule.enabled }),
    });
    onChange();
  };

  const remove = async () => {
    if (!confirm(`Delete schedule "${schedule.name}"?`)) return;
    await fetch(`/api/schedules/${schedule.id}`, { method: 'DELETE' });
    onChange();
  };

  if (editing) {
    return (
      <ScheduleEditor
        personas={personas}
        initial={schedule}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); onChange(); }}
      />
    );
  }

  return (
    <div className="brr-os-workflow-row">
      <div className="brr-os-workflow-row-head">
        <span className="brr-os-workflow-row-title">{schedule.name}</span>
        <span
          className="brr-os-persona-status"
          style={{ marginLeft: 'auto', cursor: 'pointer' }}
          onClick={toggleEnabled}
          title="toggle enabled"
        >
          <span className="brr-os-persona-dot" style={{ background: schedule.enabled ? 'var(--moss)' : 'var(--fg-faint)' }} />
          {schedule.enabled ? 'enabled' : 'disabled'}
        </span>
      </div>
      <div className="brr-os-workflow-row-meta">
        <span>{persona ? persona.name : '(no persona)'}</span>
        <span className="brr-os-meta-dot" />
        <span title={schedule.schedule}>{humanizeCron(schedule.schedule)}</span>
        <span className="brr-os-meta-dot" />
        <span>ran {schedule.run_count}× {schedule.last_run ? `· last ${formatRel(schedule.last_run)} (${schedule.last_status})` : ''}</span>
      </div>
      <div className="brr-os-workflow-row-task">{schedule.task}</div>
      <div className="brr-os-workflow-row-actions">
        <button type="button" className="brr-btn brr-btn--ghost" onClick={() => setEditing(true)}>edit</button>
        <button type="button" className="brr-btn brr-btn--ghost" onClick={remove}>
          <Trash2 className="w-3 h-3" strokeWidth={1.5} /> delete
        </button>
      </div>
    </div>
  );
}

// ── Task lists ──────────────────────────────────────────────────────────────

interface ListItemDraft {
  title: string;
  description: string;
  required_skills: string[];
  persona_id: string | null;
}

function ListsTab({
  lists, personas, creating, onClose, onChange,
}: {
  lists: TaskList[];
  personas: Persona[];
  creating: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  return (
    <div className="brr-os-workflows-list">
      {creating && (
        <TaskListEditor
          personas={personas}
          onClose={onClose}
          onSaved={() => { onClose(); onChange(); }}
        />
      )}
      {lists.length === 0 && !creating && (
        <div className="brr-os-empty" style={{ padding: 48 }}>
          no task lists yet — create one to bulk-add tasks to your board on demand
        </div>
      )}
      {lists.map(list => (
        <TaskListRow
          key={list.id}
          list={list}
          personas={personas}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function TaskListEditor({
  personas, onClose, onSaved, initial,
}: {
  personas: Persona[];
  onClose: () => void;
  onSaved: () => void;
  initial?: TaskList;
}) {
  const initialItems: ListItemDraft[] = initial
    ? (JSON.parse(initial.items_json || '[]') as Array<{
        title?: string; description?: string;
        required_skills?: string[]; persona_id?: string | null;
      }>).map(it => ({
        title: it.title ?? '',
        description: it.description ?? '',
        required_skills: Array.isArray(it.required_skills) ? it.required_skills : [],
        persona_id: it.persona_id ?? null,
      }))
    : [];

  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [items, setItems] = useState<ListItemDraft[]>(initialItems);
  const [busy, setBusy] = useState(false);

  const updateItem = (idx: number, patch: Partial<ListItemDraft>) => {
    setItems(items => items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const save = async () => {
    if (!title.trim()) { toast.error('title required'); return; }
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        items: items
          .filter(it => it.title.trim())
          .map(it => ({
            title: it.title.trim(),
            description: it.description.trim() || it.title.trim(),
            required_skills: it.required_skills,
            persona_id: it.persona_id,
          })),
      };
      const url = initial?.id ? `/api/task-lists/${initial.id}` : '/api/task-lists';
      const method = initial?.id ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { toast.error('save failed'); return; }
      toast.success(initial?.id ? 'saved' : 'list created');
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brr-os-workflow-editor">
      <div className="brr-os-form-row">
        <label>title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="weekly content checklist" />
      </div>
      <div className="brr-os-form-row" style={{ alignItems: 'flex-start' }}>
        <label>description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
      </div>

      <div className="brr-os-eyebrow" style={{ marginTop: 8 }}>tasks</div>
      {items.map((it, i) => (
        <ListItemRow
          key={i}
          draft={it}
          personas={personas}
          onChange={p => updateItem(i, p)}
          onRemove={() => setItems(items.filter((_, j) => j !== i))}
        />
      ))}
      <button
        type="button"
        className="brr-os-composer-trigger"
        onClick={() => setItems([...items, { title: '', description: '', required_skills: [], persona_id: null }])}
        style={{ marginTop: 4 }}
      >
        <Plus className="w-3 h-3" strokeWidth={1.75} /> add task
      </button>

      <div className="brr-os-form-foot" style={{ gap: 8, marginTop: 12 }}>
        <button type="button" className="brr-btn brr-btn--ghost" onClick={onClose}>cancel</button>
        <button type="button" className="brr-btn brr-btn--primary" onClick={save} disabled={busy}>
          <Save className="w-3 h-3" strokeWidth={1.75} /> {initial?.id ? 'save' : 'create list'}
        </button>
      </div>
    </div>
  );
}

function ListItemRow({
  draft, personas, onChange, onRemove,
}: {
  draft: ListItemDraft;
  personas: Persona[];
  onChange: (patch: Partial<ListItemDraft>) => void;
  onRemove: () => void;
}) {
  const [skillInput, setSkillInput] = useState('');
  return (
    <div className="brr-os-planning-subtask">
      <div className="brr-os-planning-subtask-row">
        <input
          value={draft.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder="task title"
          className="brr-os-planning-subtask-title"
        />
        <select
          value={draft.persona_id ?? ''}
          onChange={e => onChange({ persona_id: e.target.value || null })}
          className="brr-os-composer-select"
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
        rows={2}
        placeholder="details (optional)"
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

function TaskListRow({
  list, personas, onChange,
}: {
  list: TaskList;
  personas: Persona[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const items: Array<{ title: string; persona_id?: string | null }> = JSON.parse(list.items_json || '[]');

  const run = async () => {
    if (!confirm(`Add ${items.length} task${items.length === 1 ? '' : 's'} to the board?`)) return;
    const r = await fetch(`/api/task-lists/${list.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'run' }),
    });
    if (!r.ok) { toast.error('run failed'); return; }
    const d = await r.json();
    toast.success(`added ${d.created} tasks to the board`);
    onChange();
  };

  const remove = async () => {
    if (!confirm(`Delete list "${list.title}"?`)) return;
    await fetch(`/api/task-lists/${list.id}`, { method: 'DELETE' });
    onChange();
  };

  if (editing) {
    return (
      <TaskListEditor
        personas={personas}
        initial={list}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); onChange(); }}
      />
    );
  }

  return (
    <div className="brr-os-workflow-row">
      <div className="brr-os-workflow-row-head">
        <span className="brr-os-workflow-row-title">{list.title}</span>
        <span style={{ marginLeft: 'auto', font: '500 10px var(--font-mono)', color: 'var(--fg-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {items.length} task{items.length === 1 ? '' : 's'}
        </span>
      </div>
      {list.description && <div className="brr-os-workflow-row-meta">{list.description}</div>}
      <div className="brr-os-workflow-row-task">
        {items.slice(0, 5).map((it, i) => (
          <div key={i} style={{ marginBottom: 2 }}>· {it.title}</div>
        ))}
        {items.length > 5 && <div style={{ color: 'var(--fg-muted)' }}>… and {items.length - 5} more</div>}
      </div>
      <div className="brr-os-workflow-row-actions">
        <button type="button" className="brr-btn brr-btn--primary" onClick={run}>
          <Play className="w-3 h-3" strokeWidth={1.75} /> run to board
        </button>
        <button type="button" className="brr-btn brr-btn--ghost" onClick={() => setEditing(true)}>edit</button>
        <button type="button" className="brr-btn brr-btn--ghost" onClick={remove}>
          <Trash2 className="w-3 h-3" strokeWidth={1.5} /> delete
        </button>
      </div>
    </div>
  );
}

function formatRel(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 60 / 60_000)}h ago`;
  return `${Math.floor(diff / 24 / 60 / 60_000)}d ago`;
}
