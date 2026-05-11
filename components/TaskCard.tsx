'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, UserPlus, Trash2, Pause, Check, MessageSquareQuote, GitPullRequest } from 'lucide-react';
import type { BoardTaskWithPersona, Persona } from '@/lib/db';

interface TaskCardProps {
  task: BoardTaskWithPersona;
  personas: Persona[];
  onAssign?: (taskId: string, personaId: string) => void;
  onUpdateStatus?: (taskId: string, status: string) => void;
  onDelete?: (taskId: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  open: 'open',
  assigned: 'assigned',
  in_progress: 'in progress',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'cancelled',
  pending: 'open',
};

const COMPLETION_LABEL: Record<string, string> = {
  confirmed: '✓ confirmed',
  auto: 'done',
  truncated: 'truncated',
  refused: 'refused',
};
const COMPLETION_TINT: Record<string, string> = {
  confirmed: 'var(--moss)',
  auto: 'var(--slate-tone)',
  truncated: 'var(--amber-tone)',
  refused: 'var(--brick)',
};
const COMPLETION_TOOLTIP: Record<string, string> = {
  confirmed: 'agent self-confirmed completion with [DONE]',
  auto: 'process exited cleanly — no explicit confirmation',
  truncated: 'response cut off (max tokens reached) — output may be incomplete',
  refused: 'model refused to complete the task',
};

const STATUS_TINT: Record<string, string> = {
  open: 'var(--fg-muted)',
  assigned: 'var(--clay)',
  in_progress: 'var(--moss)',
  blocked: 'var(--amber-tone)',
  done: 'var(--slate-tone)',
  cancelled: 'var(--fg-faint)',
  pending: 'var(--fg-muted)',
};

export function TaskCard({ task, personas, onAssign, onUpdateStatus, onDelete }: TaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const skills: string[] = task.required_skills_json ? safeParse(task.required_skills_json) : [];
  const status = task.status || 'open';
  const result = (task.result || '').trim();
  const hasRecap = status === 'done' && result.length > 0;
  const recapPreview = hasRecap
    ? (result.split('\n').find(l => l.trim().length > 1) || result).slice(0, 160)
    : '';

  const candidates = personas.filter(p => {
    if (skills.length === 0) return true;
    const personaSkills = p.skills_json ? safeParse(p.skills_json) : [];
    return skills.every(s => personaSkills.includes(s));
  });

  return (
    <div className="brr-os-task">
      <div className="brr-os-task-head">
        <div className="brr-os-task-status" style={{ color: STATUS_TINT[status] || 'inherit' }}>
          {status === 'done' && task.completion
            ? <span title={COMPLETION_TOOLTIP[task.completion]} style={{ color: COMPLETION_TINT[task.completion] }}>{COMPLETION_LABEL[task.completion]}</span>
            : (STATUS_LABEL[status] || status)}
        </div>
        {task.from_persona_name && (
          <span
            className="brr-os-task-from"
            title={task.handoff_reason ? `handed off — ${task.handoff_reason}` : `handed off from ${task.from_persona_name}`}
          >
            <span
              className="brr-os-task-from-dot"
              style={{ background: task.from_persona_color || 'var(--accent)' }}
            />
            ← {task.from_persona_name}
          </span>
        )}
        {task.persona_name ? (
          <div className="brr-os-task-assignee">
            <span
              className="brr-os-task-assignee-dot"
              style={{ background: task.persona_color || 'var(--accent)' }}
            />
            {task.persona_name}
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="brr-btn brr-btn--ghost"
              onClick={() => setMenuOpen(o => !o)}
              style={{ padding: '2px 6px', fontSize: 10 }}
            >
              <UserPlus className="w-3 h-3" strokeWidth={1.5} />
              assign
              <ChevronDown className="w-3 h-3" strokeWidth={1.5} />
            </button>
            {menuOpen && (
              <div className="brr-os-task-assign-menu">
                {candidates.length === 0 ? (
                  <div className="brr-os-task-assign-empty">no matching personas</div>
                ) : candidates.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    className="brr-os-task-assign-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onAssign?.(task.id, p.id);
                    }}
                  >
                    <span
                      className="brr-os-task-assign-dot"
                      style={{ background: p.color || 'var(--accent)' }}
                    />
                    {p.name}
                    {p.status !== 'idle' && (
                      <span className="brr-os-task-assign-busy">{p.status}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="brr-os-task-title">{task.title || task.description.slice(0, 80)}</div>
      {task.description && task.description !== task.title && (
        <div className="brr-os-task-desc">{task.description}</div>
      )}

      {skills.length > 0 && (
        <div className="brr-os-task-skills">
          {skills.map(s => (
            <span key={s} className="brr-os-skill-pill">{s}</span>
          ))}
        </div>
      )}

      {hasRecap && (
        <div className="brr-os-task-recap" data-open={recapOpen}>
          <button
            type="button"
            className="brr-os-task-recap-head"
            onClick={() => setRecapOpen(o => !o)}
          >
            {recapOpen ? (
              <ChevronDown className="w-3 h-3" strokeWidth={1.75} />
            ) : (
              <ChevronRight className="w-3 h-3" strokeWidth={1.75} />
            )}
            <MessageSquareQuote className="w-3 h-3" strokeWidth={1.75} />
            <span className="brr-os-task-recap-label">recap</span>
            {!recapOpen && <span className="brr-os-task-recap-preview">{recapPreview}</span>}
          </button>
          {recapOpen && (
            <pre className="brr-os-task-recap-body">{result}</pre>
          )}
        </div>
      )}

      {task.push_request_id && (
        <Link
          href={`/review?id=${task.push_request_id}`}
          className="brr-os-task-pr"
          data-status={task.push_request_status || 'pending'}
          title={`${task.push_request_files ?? 0} file${(task.push_request_files ?? 0) === 1 ? '' : 's'} changed · ${task.push_request_status} · click to review`}
        >
          <GitPullRequest className="w-3 h-3" strokeWidth={1.75} />
          <span>{task.push_request_files ?? 0} file{(task.push_request_files ?? 0) === 1 ? '' : 's'}</span>
          <span className="brr-os-task-pr-status">{task.push_request_status}</span>
        </Link>
      )}

      <div className="brr-os-task-foot">
        {status === 'in_progress' || status === 'assigned' ? (
          <button
            type="button"
            className="brr-btn brr-btn--ghost"
            onClick={() => onUpdateStatus?.(task.id, 'done')}
            style={{ padding: '2px 6px', fontSize: 10 }}
          >
            <Check className="w-3 h-3" strokeWidth={1.5} />
            mark done
          </button>
        ) : status === 'open' ? (
          <button
            type="button"
            className="brr-btn brr-btn--ghost"
            onClick={() => onUpdateStatus?.(task.id, 'cancelled')}
            style={{ padding: '2px 6px', fontSize: 10 }}
          >
            <Pause className="w-3 h-3" strokeWidth={1.5} />
            cancel
          </button>
        ) : null}
        <button
          type="button"
          className="brr-btn brr-btn--ghost"
          onClick={() => onDelete?.(task.id)}
          style={{ padding: '2px 6px', fontSize: 10, marginLeft: 'auto' }}
          title="Delete"
        >
          <Trash2 className="w-3 h-3" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

function safeParse(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}
