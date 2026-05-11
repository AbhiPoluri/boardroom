'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, GitBranch, Folder, X, Check } from 'lucide-react';
import { toast } from '@/lib/toast';

export interface Project {
  id: string;
  name: string;
  repo: string | null;
  branch: string | null;
  working_dir: string | null;
  goal: string | null;
  created_at: number;
  updated_at: number;
}

interface ProjectSwitcherProps {
  active: Project | null;
  projects: Project[];
  onActiveChange: (id: string) => void;
  onProjectsChange: () => void;
}

export function ProjectSwitcher({ active, projects, onActiveChange, onProjectsChange }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const label = active?.name || 'workspace';
  const sub = active?.repo || (active?.working_dir ? truncatePath(active.working_dir) : 'no repo');

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Switch project"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px 4px 10px',
          marginRight: 8,
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          color: 'var(--fg-secondary)',
          font: '500 11px/1.1 var(--font-mono)',
          cursor: 'pointer',
          transition: 'background 180ms cubic-bezier(0.16,1,0.3,1), color 180ms',
        }}
      >
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <span style={{ color: 'var(--fg)' }}>{label}</span>
          <span style={{ font: '400 9px/1 var(--font-mono)', color: 'var(--fg-muted)', letterSpacing: '0.04em' }}>
            {sub}
          </span>
        </span>
        <ChevronDown className="w-3 h-3" strokeWidth={1.75} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 70,
            minWidth: 280,
            maxWidth: 360,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 10,
            boxShadow: 'var(--shadow-pop)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--border)',
              font: '500 9px/1 var(--font-mono)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--fg-muted)',
            }}
          >
            projects
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto', padding: 4 }}>
            {projects.length === 0 ? (
              <div style={{ padding: '12px', font: '400 11px var(--font-mono)', color: 'var(--fg-muted)' }}>
                no projects yet
              </div>
            ) : projects.map(p => {
              const isActive = active?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  className="brr-project-row"
                  onClick={() => { onActiveChange(p.id); setOpen(false); }}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '14px 1fr auto',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--fg-secondary)',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    font: '400 12px/1.3 var(--font-mono)',
                    transition: 'background 160ms',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isActive ? <Check className="w-3 h-3" strokeWidth={2} /> : null}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ color: isActive ? 'var(--accent)' : 'var(--fg)' }}>{p.name}</span>
                    {(p.repo || p.working_dir) && (
                      <span
                        style={{
                          font: '400 10px/1 var(--font-mono)',
                          color: 'var(--fg-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.repo ? p.repo : truncatePath(p.working_dir!)}
                        {p.branch ? `  ·  ${p.branch}` : ''}
                      </span>
                    )}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="brr-row-edit"
                    onClick={(e) => { e.stopPropagation(); setOpen(false); setEditing(p); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setOpen(false); setEditing(p); } }}
                    title="Edit project"
                    style={{
                      font: '500 10px var(--font-mono)',
                      color: 'var(--fg-muted)',
                      cursor: 'pointer',
                      padding: '3px 7px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-inset, var(--bg-card))',
                      transition: 'color 160ms, border-color 160ms',
                    }}
                  >
                    edit
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => { setCreating(true); setOpen(false); }}
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderTop: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--accent)',
              border: 'none',
              cursor: 'pointer',
              font: '500 11px/1 var(--font-mono)',
            }}
          >
            <Plus className="w-3 h-3" strokeWidth={1.75} /> new project
          </button>
        </div>
      )}

      {(creating || editing) && (
        <ProjectModal
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { onProjectsChange(); setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function truncatePath(p: string): string {
  if (p.length <= 32) return p;
  return '…' + p.slice(p.length - 31);
}

interface ProjectModalProps {
  existing: Project | null;
  onClose: () => void;
  onSaved: () => void;
}

function ProjectModal({ existing, onClose, onSaved }: ProjectModalProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [repo, setRepo] = useState(existing?.repo ?? '');
  const [workingDir, setWorkingDir] = useState(existing?.working_dir ?? '');
  const [branch, setBranch] = useState(existing?.branch ?? '');
  const [goal, setGoal] = useState(existing?.goal ?? '');
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setTimeout(() => firstInputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { toast.error('project name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: trimmedName,
        repo: repo.trim() || null,
        branch: branch.trim() || null,
        working_dir: workingDir.trim() || null,
        goal: goal.trim() || null,
      };
      const url = existing ? `/api/projects/${existing.id}` : '/api/projects';
      const method = existing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `request failed (${res.status})`);
      }
      toast.success(existing ? 'project updated' : 'project created');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed to save project');
    } finally {
      setSaving(false);
    }
  }, [name, repo, branch, workingDir, goal, existing, onSaved]);

  const remove = useCallback(async () => {
    if (!existing) return;
    if (!confirm(`Delete project "${existing.name}"? Agents already spawned in it stay.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${existing.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      toast.success('project deleted');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed to delete');
    } finally {
      setSaving(false);
    }
  }, [existing, onSaved]);

  if (!mounted) return null;

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 96,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-strong)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex flex-col gap-1">
            <span className="brr-eyebrow">{existing ? 'edit project' : 'new project'}</span>
            <h3
              style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontWeight: 400,
                fontSize: 22,
                lineHeight: 1.2,
                color: 'var(--fg)',
              }}
            >
              {existing ? <>edit <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{existing.name}</em></> : <>scope a <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>new</em> project.</>}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="brr-icon-btn"
            title="Close (Esc)"
            style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--fg-muted)' }}
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="name" hint="how you'll refer to it">
            <input
              ref={firstInputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="billing rebuild"
              className="brr-input"
            />
          </Field>

          <Field label="repo" hint="optional · absolute path to a local git repo — personas will get isolated worktrees of it">
            <div style={{ position: 'relative' }}>
              <GitBranch
                className="w-3 h-3"
                strokeWidth={1.75}
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }}
              />
              <input
                value={repo}
                onChange={e => setRepo(e.target.value)}
                placeholder="/Users/you/code/your-project"
                className="brr-input"
                style={{ paddingLeft: 28 }}
              />
            </div>
          </Field>

          <Field label="working dir" hint="optional · absolute path; agents spawned here use it as cwd">
            <div style={{ position: 'relative' }}>
              <Folder
                className="w-3 h-3"
                strokeWidth={1.75}
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }}
              />
              <input
                value={workingDir}
                onChange={e => setWorkingDir(e.target.value)}
                placeholder="/Users/you/code/myproject"
                className="brr-input"
                style={{ paddingLeft: 28 }}
              />
            </div>
          </Field>

          <Field label="branch" hint="optional · default agent branch base">
            <input
              value={branch}
              onChange={e => setBranch(e.target.value)}
              placeholder="main"
              className="brr-input"
            />
          </Field>

          <Field label="goal" hint="optional · the headline goal driving this project">
            <textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="add stripe billing, end-to-end."
              rows={2}
              className="brr-input"
              style={{ resize: 'vertical', fontFamily: 'var(--font-mono)' }}
            />
          </Field>
        </div>

        <div
          className="flex items-center justify-between"
          style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg-raised)' }}
        >
          {existing ? (
            <button
              type="button"
              onClick={remove}
              disabled={saving}
              className="brr-btn brr-btn--ghost"
              style={{ color: 'var(--state-error)' }}
            >
              delete
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="brr-btn brr-btn--ghost" disabled={saving}>cancel</button>
            <button type="button" onClick={save} disabled={saving || !name.trim()} className="brr-btn brr-btn--primary">
              {saving ? 'saving…' : existing ? 'save' : 'create'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span
        style={{
          font: '500 9px/1 var(--font-mono)',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--fg-muted)',
        }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ font: '400 10px/1.4 var(--font-mono)', color: 'var(--fg-muted)' }}>{hint}</span>
      )}
    </label>
  );
}
