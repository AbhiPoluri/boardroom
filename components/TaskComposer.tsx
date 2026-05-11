'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Persona } from '@/lib/db';

interface TaskComposerProps {
  personas: Persona[];
  onCreate: (input: {
    title: string;
    description: string;
    persona_id: string | null;
    required_skills: string[];
    priority: number;
  }) => Promise<void> | void;
}

export function TaskComposer({ personas, onCreate }: TaskComposerProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [personaId, setPersonaId] = useState<string>('');
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState('');
  const [priority, setPriority] = useState(0);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle('');
    setDescription('');
    setPersonaId('');
    setSkills([]);
    setSkillInput('');
    setPriority(0);
    setOpen(false);
  };

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || title.trim(),
        persona_id: personaId || null,
        required_skills: skills,
        priority,
      });
      reset();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="brr-os-composer-trigger"
        onClick={() => setOpen(true)}
      >
        <Plus className="w-3 h-3" strokeWidth={1.75} />
        <span>new task</span>
      </button>
    );
  }

  return (
    <div className="brr-os-composer">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="what needs to be done?"
        className="brr-os-composer-title"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === 'Escape') reset();
        }}
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="details, context, definition of done…"
        className="brr-os-composer-desc"
        rows={3}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
      />

      <div className="brr-os-composer-row">
        <select
          value={personaId}
          onChange={e => setPersonaId(e.target.value)}
          className="brr-os-composer-select"
        >
          <option value="">unassigned (auto-pickup)</option>
          {personas.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div className="brr-os-composer-skills">
          {skills.map(s => (
            <span key={s} className="brr-os-skill-pill">
              {s}
              <button
                type="button"
                onClick={() => setSkills(skills.filter(x => x !== s))}
                className="brr-os-skill-x"
                aria-label={`remove ${s}`}
              >
                <X className="w-2 h-2" strokeWidth={2} />
              </button>
            </span>
          ))}
          <input
            value={skillInput}
            onChange={e => setSkillInput(e.target.value)}
            placeholder="+ skill"
            className="brr-os-composer-skill-input"
            onKeyDown={e => {
              if (e.key === 'Enter' && skillInput.trim()) {
                e.preventDefault();
                if (!skills.includes(skillInput.trim())) {
                  setSkills([...skills, skillInput.trim()]);
                }
                setSkillInput('');
              }
              if (e.key === 'Backspace' && !skillInput && skills.length) {
                setSkills(skills.slice(0, -1));
              }
            }}
          />
        </div>

        <input
          type="number"
          value={priority}
          onChange={e => setPriority(Number(e.target.value) || 0)}
          className="brr-os-composer-priority"
          title="priority (higher = picked up first)"
          min={-5}
          max={5}
        />
      </div>

      <div className="brr-os-composer-foot">
        <span className="brr-os-composer-hint">⌘↩ to add · esc to cancel</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="brr-btn brr-btn--ghost" onClick={reset}>cancel</button>
          <button
            type="button"
            className="brr-btn brr-btn--primary"
            onClick={submit}
            disabled={!title.trim() || busy}
          >
            {busy ? 'adding…' : 'add task'}
          </button>
        </div>
      </div>
    </div>
  );
}
