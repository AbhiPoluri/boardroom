'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Save, Sparkles } from 'lucide-react';
import { toast } from '@/lib/toast';
import type { Persona } from '@/lib/db';

interface PersonaForm {
  id?: string;
  name: string;
  role: string;
  system_prompt: string;
  skills: string[];
  color: string;
  model: string;
  agent_type: string;
  autonomy: 'manual' | 'auto';
}

const EMPTY: PersonaForm = {
  name: '',
  role: '',
  system_prompt: '',
  skills: [],
  color: '#c08552',
  model: 'sonnet',
  agent_type: 'claude',
  autonomy: 'manual',
};

export default function PersonasPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selected, setSelected] = useState<Persona | null>(null);
  const [draft, setDraft] = useState<PersonaForm>(EMPTY);
  const [skillInput, setSkillInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/personas');
      const d = await r.json();
      setPersonas(d.personas || []);
      if (d.personas?.length && !selected) {
        setSelected(d.personas[0]);
        loadDraft(d.personas[0]);
      }
    } catch { /* ignore */ }
  }, [selected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadDraft = (p: Persona) => {
    setDraft({
      id: p.id,
      name: p.name,
      role: p.role || '',
      system_prompt: p.system_prompt || '',
      skills: p.skills_json ? safeParse(p.skills_json) : [],
      color: p.color || '#c08552',
      model: p.model || 'sonnet',
      agent_type: (p as Persona & { agent_type?: string }).agent_type || 'claude',
      autonomy: p.autonomy === 'auto' ? 'auto' : 'manual',
    });
    setCreating(false);
  };

  const handleSelect = (p: Persona) => {
    setSelected(p);
    loadDraft(p);
  };

  const handleNew = () => {
    setSelected(null);
    setDraft({ ...EMPTY });
    setCreating(true);
  };

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error('name is required');
      return;
    }
    setBusy(true);
    try {
      if (creating || !draft.id) {
        const r = await fetch('/api/personas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: draft.name,
            role: draft.role || null,
            system_prompt: draft.system_prompt || null,
            skills: draft.skills,
            color: draft.color,
            model: draft.model,
            agent_type: draft.agent_type,
            autonomy: draft.autonomy,
          }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          toast.error(err.error || 'create failed');
          return;
        }
        toast.success('persona created');
      } else {
        const r = await fetch(`/api/personas/${draft.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: draft.name,
            role: draft.role || null,
            system_prompt: draft.system_prompt || null,
            skills: draft.skills,
            color: draft.color,
            model: draft.model,
            agent_type: draft.agent_type,
            autonomy: draft.autonomy,
          }),
        });
        if (!r.ok) { toast.error('save failed'); return; }
        toast.success('saved');
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id) return;
    if (!confirm(`Delete persona "${draft.name}"? Their session will be stopped.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/personas/${draft.id}`, { method: 'DELETE' });
      toast.success('deleted');
      setSelected(null);
      setDraft(EMPTY);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brr-os-personas-page">
      <aside className="brr-os-personas-list">
        <div className="brr-os-pane-head">
          <span className="brr-os-pane-title">personas</span>
          <button
            type="button"
            className="brr-btn brr-btn--ghost"
            onClick={handleNew}
            style={{ marginLeft: 'auto' }}
          >
            <Plus className="w-3 h-3" strokeWidth={1.75} /> new
          </button>
        </div>
        <div className="brr-os-pane-body">
          {personas.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p)}
              className={`brr-os-personas-list-item ${selected?.id === p.id ? 'is-on' : ''}`}
            >
              <span
                className="brr-os-persona-avatar"
                style={{ background: p.color || 'var(--accent-soft)', width: 22, height: 22, fontSize: 10 }}
              >
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--fg)' }}>{p.name}</span>
                {p.role && <span style={{ display: 'block', fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{p.role}</span>}
              </span>
              {p.autonomy === 'auto' && <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} strokeWidth={1.5} />}
            </button>
          ))}
          {personas.length === 0 && (
            <div className="brr-os-empty">no personas yet — click + new</div>
          )}
        </div>
      </aside>

      <main className="brr-os-personas-editor">
        <div className="brr-os-pane-head">
          <span className="brr-os-pane-title">{creating ? 'new persona' : (draft.id ? 'edit persona' : 'select a persona')}</span>
          {draft.id && !creating && (
            <button
              type="button"
              className="brr-btn brr-btn--ghost"
              style={{ marginLeft: 'auto' }}
              onClick={remove}
              disabled={busy}
            >
              <Trash2 className="w-3 h-3" strokeWidth={1.5} /> delete
            </button>
          )}
        </div>

        <div className="brr-os-personas-form">
          <div className="brr-os-form-row">
            <label>name</label>
            <input
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder="Maya"
            />
          </div>
          <div className="brr-os-form-row">
            <label>role</label>
            <input
              value={draft.role}
              onChange={e => setDraft({ ...draft, role: e.target.value })}
              placeholder="senior frontend designer"
            />
          </div>
          <div className="brr-os-form-row" style={{ alignItems: 'flex-start' }}>
            <label>system prompt</label>
            <textarea
              value={draft.system_prompt}
              onChange={e => setDraft({ ...draft, system_prompt: e.target.value })}
              placeholder="Describe how this persona thinks, what they care about, what tone to use…"
              rows={6}
            />
          </div>
          <div className="brr-os-form-row" style={{ alignItems: 'flex-start' }}>
            <label>skills</label>
            <div style={{ flex: 1 }}>
              <div className="brr-os-composer-skills" style={{ width: '100%' }}>
                {draft.skills.map(s => (
                  <span key={s} className="brr-os-skill-pill">
                    {s}
                    <button
                      type="button"
                      className="brr-os-skill-x"
                      onClick={() => setDraft({ ...draft, skills: draft.skills.filter(x => x !== s) })}
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
                      if (!draft.skills.includes(skillInput.trim())) {
                        setDraft({ ...draft, skills: [...draft.skills, skillInput.trim()] });
                      }
                      setSkillInput('');
                    }
                  }}
                />
              </div>
              <p style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                used to match tasks via auto-pickup
              </p>
            </div>
          </div>
          <div className="brr-os-form-row">
            <label>color</label>
            <input
              type="color"
              value={draft.color}
              onChange={e => setDraft({ ...draft, color: e.target.value })}
              style={{ width: 60, height: 28, padding: 0, border: '1px solid var(--border)' }}
            />
          </div>
          <div className="brr-os-form-row">
            <label>runtime</label>
            <select value={draft.agent_type} onChange={e => setDraft({ ...draft, agent_type: e.target.value })}>
              <option value="claude">claude — default; full tool-use, persistent session</option>
              <option value="hermes">hermes — non-Claude provider; one-shot prompts, no quota</option>
              <option value="codex">codex — OpenAI codex CLI</option>
              <option value="opencode">opencode — open-source coding agent</option>
            </select>
          </div>
          {draft.agent_type === 'claude' && (
            <div className="brr-os-form-row">
              <label>model</label>
              <select value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })}>
                <option value="haiku">haiku — fast & cheap</option>
                <option value="sonnet">sonnet — default</option>
                <option value="opus">opus — heavy reasoning</option>
              </select>
            </div>
          )}
          {draft.agent_type === 'hermes' && (
            <div className="brr-os-form-row">
              <label>model (hermes)</label>
              <input
                type="text"
                value={draft.model}
                onChange={e => setDraft({ ...draft, model: e.target.value })}
                placeholder="leave blank to use hermes default"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          )}
          <div className="brr-os-form-row">
            <label>autonomy</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className={`brr-btn ${draft.autonomy === 'manual' ? 'brr-btn--primary' : 'brr-btn--ghost'}`}
                onClick={() => setDraft({ ...draft, autonomy: 'manual' })}
              >manual</button>
              <button
                type="button"
                className={`brr-btn ${draft.autonomy === 'auto' ? 'brr-btn--primary' : 'brr-btn--ghost'}`}
                onClick={() => setDraft({ ...draft, autonomy: 'auto' })}
              >auto-pickup</button>
              <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                auto = picks up open tasks matching their skills
              </span>
            </div>
          </div>

          <div className="brr-os-form-foot">
            <button
              type="button"
              className="brr-btn brr-btn--primary"
              disabled={busy || !draft.name.trim()}
              onClick={save}
            >
              <Save className="w-3 h-3" strokeWidth={1.75} />
              {creating ? 'create persona' : 'save changes'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function safeParse(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}
