'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, ChevronDown, ListTodo, Settings2 } from 'lucide-react';
import { TaskCard } from '@/components/TaskCard';
import type { PlanWithSubtasks, BoardTaskWithPersona, Persona } from '@/lib/db';

interface PlanGroupCardProps {
  plan: PlanWithSubtasks;
  /** Subtasks belonging to this plan that match the column we're in. */
  visibleSubtasks: BoardTaskWithPersona[];
  personas: Persona[];
  onAssign?: (taskId: string, personaId: string) => void;
  onUpdateStatus?: (taskId: string, status: string) => void;
  onDeleteTask?: (taskId: string) => void;
}

const STATUS_TINT: Record<string, string> = {
  draft: 'var(--fg-muted)',
  active: 'var(--moss)',
  done: 'var(--slate-tone)',
  cancelled: 'var(--brick)',
};

export function PlanGroupCard({
  plan, visibleSubtasks, personas, onAssign, onUpdateStatus, onDeleteTask,
}: PlanGroupCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const assignees = Array.from(
    new Map(
      visibleSubtasks
        .filter(t => t.persona_name)
        .map(t => [t.persona_id, { name: t.persona_name!, color: t.persona_color }]),
    ).values(),
  );

  return (
    <div className="brr-os-plan-card" data-expanded={expanded}>
      <button
        type="button"
        className="brr-os-plan-card-head"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" strokeWidth={1.75} />
        ) : (
          <ChevronRight className="w-3 h-3" strokeWidth={1.75} />
        )}
        <ListTodo className="w-3 h-3" strokeWidth={1.75} style={{ color: 'var(--fg-muted)' }} />
        <span className="brr-os-plan-card-title">{plan.title}</span>
        <span
          className="brr-os-plan-card-status"
          style={{ color: STATUS_TINT[plan.status] || 'inherit' }}
        >
          {plan.status === 'active' ? 'running' : plan.status}
        </span>
      </button>

      <div className="brr-os-plan-card-meta">
        <span className="brr-os-plan-card-progress">
          {plan.done} / {plan.total}
        </span>
        <span className="brr-os-plan-card-progressbar">
          <span
            className="brr-os-plan-card-progressfill"
            style={{ width: `${plan.total ? (plan.done / plan.total) * 100 : 0}%` }}
          />
        </span>
        <span style={{ flex: 1 }} />
        {assignees.slice(0, 4).map((a, i) => (
          <span
            key={i}
            className="brr-os-plan-card-assignee-dot"
            style={{ background: a.color || 'var(--accent)' }}
            title={a.name}
          />
        ))}
        <button
          type="button"
          className="brr-btn brr-btn--ghost"
          onClick={(e) => { e.stopPropagation(); router.push('/planning'); }}
          title="edit plan"
          style={{ padding: '2px 6px' }}
        >
          <Settings2 className="w-3 h-3" strokeWidth={1.5} />
        </button>
      </div>

      {expanded && visibleSubtasks.length > 0 && (
        <div className="brr-os-plan-card-subtasks">
          {visibleSubtasks.map(t => (
            <TaskCard
              key={t.id}
              task={t}
              personas={personas}
              onAssign={onAssign}
              onUpdateStatus={onUpdateStatus}
              onDelete={onDeleteTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}
