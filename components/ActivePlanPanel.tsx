'use client';

/**
 * Live progress widget for the orchestrator chat. Polls /api/plans every 2s
 * and surfaces every *active* plan with per-subtask state. Designed to sit
 * inside the floating orchestrator dock so the user always knows whether
 * the system is alive, who is working right now, and what just finished.
 *
 * Each plan row shows: title, mode (sequential/parallel), per-step icon
 * (open=◯, working=◐, done=✓, error=✕), persona name, elapsed time, and
 * a Stop button that cancels the plan + kills agents.
 */

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, Circle, XCircle, Square, Layers } from 'lucide-react';
import { toast } from '@/lib/toast';

interface Subtask {
  id: string;
  title: string;
  status: 'staged' | 'open' | 'assigned' | 'in_progress' | 'blocked' | 'done' | 'error' | 'cancelled';
  persona_id?: string | null;
  persona_name?: string | null;
  step_order?: number | null;
  agent_id?: string | null;
  updated_at: number;
}

interface PlanRow {
  id: string;
  title: string;
  status: 'draft' | 'active' | 'done' | 'cancelled';
  execution_mode: 'parallel' | 'sequential';
  continuation_goal?: string | null;
  started_at: number | null;
  finished_at: number | null;
  subtasks: Subtask[];
  total: number;
  done: number;
}

const POLL_MS = 2000;

export function ActivePlanPanel() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/plans');
      const data = await res.json();
      const all: PlanRow[] = data.plans || [];
      // Only show plans that are actively driving work — drafts are
      // pre-start, done/cancelled are historical noise.
      setPlans(all.filter(p => p.status === 'active'));
    } catch { /* swallow — next tick retries */ }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, POLL_MS);
    return () => clearInterval(iv);
  }, [refresh]);

  async function stopPlan(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/plans/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      if (res.ok) {
        toast.success('plan cancelled');
        refresh();
      } else {
        toast.error('cancel failed');
      }
    } finally {
      setBusy(null);
    }
  }

  if (plans.length === 0) return null;

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-inset)',
      maxHeight: '40%',
      overflowY: 'auto',
    }}>
      <AnimatePresence initial={false}>
        {plans.map(p => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <PlanRow plan={p} onStop={() => stopPlan(p.id)} stopping={busy === p.id} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function PlanRow({ plan, onStop, stopping }: { plan: PlanRow; onStop: () => void; stopping: boolean }) {
  const sorted = [...plan.subtasks].sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0));
  const active = sorted.find(s => s.status === 'in_progress' || s.status === 'assigned');
  const pct = plan.total > 0 ? Math.round((plan.done / plan.total) * 100) : 0;
  const continuationActive = !!plan.continuation_goal;

  return (
    <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Layers size={13} style={{ color: 'var(--accent)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, color: 'var(--fg)', fontWeight: 500,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {plan.title}
          </div>
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            {plan.done}/{plan.total} · {plan.execution_mode}
            {continuationActive && <span style={{ color: 'var(--accent)' }}> · autonomous</span>}
            {active && <span> · {active.persona_name ?? '…'} working</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          title="cancel plan + kill in-flight agents"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', fontSize: 10, fontFamily: 'var(--font-mono)',
            border: '1px solid var(--state-error)',
            background: 'transparent', color: 'var(--state-error)',
            borderRadius: 4, cursor: 'pointer',
            opacity: stopping ? 0.4 : 1,
          }}
        >
          <Square size={9} />
          {stopping ? 'stopping…' : 'stop'}
        </button>
      </div>

      {/* progress bar */}
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <motion.div
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
          style={{ height: '100%', background: 'var(--accent)' }}
        />
      </div>

      {/* steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sorted.map(s => (
          <StepRow key={s.id} step={s} />
        ))}
      </div>
    </div>
  );
}

function StepRow({ step }: { step: Subtask }) {
  const Icon =
    step.status === 'done' ? CheckCircle2 :
    step.status === 'error' || step.status === 'cancelled' ? XCircle :
    step.status === 'in_progress' || step.status === 'assigned' ? Loader2 :
    Circle;
  const color =
    step.status === 'done' ? 'var(--state-ok)' :
    step.status === 'error' || step.status === 'cancelled' ? 'var(--state-error)' :
    step.status === 'in_progress' || step.status === 'assigned' ? 'var(--accent)' :
    'var(--fg-faint)';
  const spinning = step.status === 'in_progress' || step.status === 'assigned';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 11, color: 'var(--fg-secondary)',
      fontFamily: 'var(--font-mono)',
    }}>
      <Icon
        size={11}
        style={{
          color,
          animation: spinning ? 'brr-spin 1s linear infinite' : undefined,
        }}
      />
      <span style={{
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {step.title}
      </span>
      {step.persona_name && (
        <span style={{ color: 'var(--fg-muted)', fontSize: 9 }}>
          {step.persona_name}
        </span>
      )}
    </div>
  );
}
