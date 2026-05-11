'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, ListTodo, Sparkles, RefreshCw, Inbox, ChevronRight, ChevronLeft, Trash2 } from 'lucide-react';
import { PersonaCard } from '@/components/PersonaCard';
import { TaskCard } from '@/components/TaskCard';
import { TaskComposer } from '@/components/TaskComposer';
import { InboxPanel } from '@/components/InboxPanel';
import { PlanGroupCard } from '@/components/PlanGroupCard';
import { OnboardingModal } from '@/components/OnboardingModal';
import { toast } from '@/lib/toast';
import type { Persona, BoardTaskWithPersona, PlanWithSubtasks } from '@/lib/db';

const COLUMNS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'open',        label: 'open',        statuses: ['open', 'pending', 'staged'] },
  { key: 'in_progress', label: 'in progress', statuses: ['in_progress', 'assigned'] },
  { key: 'blocked',     label: 'blocked',     statuses: ['blocked'] },
  { key: 'done',        label: 'done',        statuses: ['done'] },
];

interface DispatcherStatus {
  running: boolean;
  lastTickAt: number;
  autoPersonas: number;
  idleAuto: number;
}

export default function OSHome() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [tasks, setTasks] = useState<BoardTaskWithPersona[]>([]);
  const [plans, setPlans] = useState<PlanWithSubtasks[]>([]);
  const [dispatcher, setDispatcher] = useState<DispatcherStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [bumpInbox, setBumpInbox] = useState(0);
  const [inboxCollapsed, setInboxCollapsed] = useState<boolean>(false);
  const [inboxCount, setInboxCount] = useState<number>(0);

  // Persist collapse state across reloads.
  useEffect(() => {
    try {
      const v = localStorage.getItem('brr-os-inbox-collapsed');
      if (v === '1') setInboxCollapsed(true);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('brr-os-inbox-collapsed', inboxCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [inboxCollapsed]);

  // Poll the count on collapse so the strip stays accurate.
  useEffect(() => {
    if (!inboxCollapsed) return;
    let cancelled = false;
    const tick = () => {
      fetch('/api/pending-questions?count=1')
        .then(r => r.json())
        .then(d => { if (!cancelled) setInboxCount(d.count || 0); })
        .catch(() => {});
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [inboxCollapsed]);

  const refreshPersonas = useCallback(async () => {
    try {
      const r = await fetch('/api/personas');
      const d = await r.json();
      setPersonas(d.personas || []);
    } catch { /* ignore */ }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const r = await fetch('/api/tasks');
      const d = await r.json();
      setTasks(d.tasks || []);
    } catch { /* ignore */ }
  }, []);

  const refreshPlans = useCallback(async () => {
    try {
      const r = await fetch('/api/plans');
      const d = await r.json();
      setPlans(d.plans || []);
    } catch { /* ignore */ }
  }, []);

  const refreshDispatcher = useCallback(async () => {
    try {
      const r = await fetch('/api/dispatcher/status');
      const d = await r.json();
      setDispatcher(d);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    Promise.all([refreshPersonas(), refreshTasks(), refreshPlans(), refreshDispatcher()])
      .finally(() => setLoading(false));
    const iv = setInterval(() => {
      refreshPersonas();
      refreshTasks();
      refreshPlans();
      refreshDispatcher();
    }, 4000);
    return () => clearInterval(iv);
  }, [refreshPersonas, refreshTasks, refreshPlans, refreshDispatcher]);

  const handleCreateTask = async (input: {
    title: string; description: string; persona_id: string | null;
    required_skills: string[]; priority: number;
  }) => {
    const r = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      toast.error('failed to add task');
      return;
    }
    refreshTasks();
    if (input.persona_id) {
      // If user pre-assigned, kick off assignment too.
      const created = await r.json();
      if (created.id) {
        await fetch(`/api/tasks/${created.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'assign', persona_id: input.persona_id }),
        });
        refreshTasks();
        refreshPersonas();
      }
    }
  };

  const handleAssign = async (taskId: string, personaId: string) => {
    const r = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'assign', persona_id: personaId }),
    });
    if (!r.ok) { toast.error('assign failed'); return; }
    toast.success('assigned');
    refreshTasks();
    refreshPersonas();
  };

  const handleStatus = async (taskId: string, status: string) => {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    refreshTasks();
  };

  const handleDelete = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    refreshTasks();
  };

  const handleWake = async (persona: Persona) => {
    const task = prompt(`What should ${persona.name} work on?`);
    if (!task) return;
    const r = await fetch(`/api/personas/${persona.id}/wake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task }),
    });
    if (!r.ok) { toast.error('wake failed'); return; }
    toast.success(`${persona.name} is on it`);
    refreshPersonas();
  };

  const handleSleep = async (persona: Persona) => {
    await fetch(`/api/personas/${persona.id}/wake`, { method: 'DELETE' });
    refreshPersonas();
  };

  const handlePickup = async () => {
    const autoCount = personas.filter(p => p.autonomy === 'auto').length;
    if (autoCount === 0) {
      toast.info('no personas in auto-pickup — toggle one in /personas first');
      return;
    }
    const idleAuto = personas.filter(p => p.autonomy === 'auto' && p.status === 'idle').length;
    if (idleAuto === 0) {
      toast.info(`${autoCount} auto-personas, but all are busy`);
      return;
    }
    const r = await fetch('/api/dispatcher/pickup', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (typeof d.pickups === 'number') {
      toast.info(d.pickups === 0 ? 'no open tasks match auto-personas\' skills' : `picked up ${d.pickups}`);
    }
    refreshPersonas();
    refreshTasks();
  };

  // Group tasks by column. Plan-subtasks get bucketed under their plan; orphan
  // tasks render flat. A plan only appears in ONE column based on the most
  // active subtask state — i.e., if any subtask is in_progress/assigned, the
  // plan goes in IN PROGRESS even if other subtasks are still staged.
  const planColumnFor = (p: PlanWithSubtasks): string => {
    const sts = p.subtasks.map(t => t.status || 'open');
    if (sts.some(s => s === 'in_progress' || s === 'assigned')) return 'in_progress';
    if (sts.some(s => s === 'blocked')) return 'blocked';
    if (sts.some(s => s === 'open' || s === 'staged' || s === 'pending')) return 'open';
    if (sts.some(s => s === 'done')) return 'done';
    return 'open';
  };

  const cancelledCount = tasks.filter(t => t.status === 'cancelled').length;

  const tasksByCol = COLUMNS.map(col => {
    const orphans = tasks.filter(
      t => !t.plan_id && col.statuses.includes(t.status || 'open'),
    );
    const planCards = plans
      .filter(p => planColumnFor(p) === col.key)
      .map(p => ({
        plan: p,
        // Show subtasks that are "currently relevant" for this column rather
        // than only the ones whose status maps to it — gives the user the
        // full active picture (next-up + currently running) when expanded.
        subtasks: col.key === 'in_progress'
          ? p.subtasks.filter(t => ['in_progress', 'assigned', 'open', 'staged', 'pending'].includes(t.status || 'open'))
          : p.subtasks.filter(t => col.statuses.includes(t.status || 'open')),
      }));
    return { ...col, orphans, planCards };
  });

  return (
    <>
    <OnboardingModal />
    <div className={`brr-os-shell ${inboxCollapsed ? 'inbox-collapsed' : ''}`}>
      <aside className="brr-os-pane brr-os-pane--left" data-tour="personas-pane">
        <div className="brr-os-pane-head">
          <span className="brr-os-pane-title">
            <Users className="w-3 h-3" strokeWidth={1.75} /> personas
          </span>
          <span className="brr-os-pane-count">{personas.length}</span>
        </div>
        <div className="brr-os-pane-body">
          {personas.length === 0 ? (
            <div className="brr-os-empty">
              {loading ? 'loading…' : 'no personas yet — visit /personas'}
            </div>
          ) : personas.map(p => (
            <PersonaCard
              key={p.id}
              persona={p}
              onWake={handleWake}
              onSleep={handleSleep}
            />
          ))}
        </div>
        <div className="brr-os-pane-foot">
          <DispatcherIndicator status={dispatcher} />
          <button
            type="button"
            className="brr-btn brr-btn--ghost"
            onClick={handlePickup}
            title="run dispatcher now"
            style={{ marginLeft: 'auto' }}
          >
            <Sparkles className="w-3 h-3" strokeWidth={1.5} />
            now
          </button>
          <a href="/personas" className="brr-btn brr-btn--ghost">manage</a>
        </div>
      </aside>

      <main className="brr-os-pane brr-os-pane--center" data-tour="task-board">
        <div className="brr-os-pane-head">
          <span className="brr-os-pane-title">
            <ListTodo className="w-3 h-3" strokeWidth={1.75} /> task board
          </span>
          {cancelledCount > 0 && (
            <button
              type="button"
              className="brr-btn brr-btn--ghost"
              onClick={async () => {
                if (!confirm(`Remove ${cancelledCount} cancelled task${cancelledCount === 1 ? '' : 's'} from the board?`)) return;
                const r = await fetch('/api/tasks/cancelled', { method: 'DELETE' });
                const d = await r.json();
                toast.success(`removed ${d.removed} cancelled task${d.removed === 1 ? '' : 's'}`);
                refreshTasks();
              }}
              title={`Remove ${cancelledCount} cancelled task${cancelledCount === 1 ? '' : 's'}`}
              style={{ marginLeft: 'auto' }}
            >
              <Trash2 className="w-3 h-3" strokeWidth={1.5} /> clear cancelled ({cancelledCount})
            </button>
          )}
          <button
            type="button"
            className="brr-btn brr-btn--ghost"
            onClick={() => { refreshTasks(); refreshPersonas(); }}
            title="refresh"
            style={{ marginLeft: cancelledCount > 0 ? undefined : 'auto' }}
          >
            <RefreshCw className="w-3 h-3" strokeWidth={1.5} />
          </button>
        </div>

        <div style={{ padding: '0 16px 12px' }}>
          <TaskComposer personas={personas} onCreate={handleCreateTask} />
        </div>

        <div className="brr-os-board">
          {tasksByCol.map(col => {
            const total = col.orphans.length + col.planCards.length;
            return (
              <div key={col.key} className="brr-os-board-col">
                <div className="brr-os-board-col-head">
                  <span>{col.label}</span>
                  <span className="brr-os-board-col-count">{total}</span>
                </div>
                <div className="brr-os-board-col-body">
                  {total === 0 ? (
                    <div className="brr-os-board-col-empty">—</div>
                  ) : (
                    <>
                      {col.planCards.map(({ plan, subtasks }) => (
                        <PlanGroupCard
                          key={plan.id}
                          plan={plan}
                          visibleSubtasks={subtasks}
                          personas={personas}
                          onAssign={handleAssign}
                          onUpdateStatus={handleStatus}
                          onDeleteTask={handleDelete}
                        />
                      ))}
                      {col.orphans.map(t => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          personas={personas}
                          onAssign={handleAssign}
                          onUpdateStatus={handleStatus}
                          onDelete={handleDelete}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {inboxCollapsed ? (
        <aside
          className="brr-os-pane brr-os-pane--right brr-os-pane--inbox-rail"
          onClick={() => setInboxCollapsed(false)}
          role="button"
          tabIndex={0}
          title={`open inbox${inboxCount ? ` (${inboxCount} pending)` : ''}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setInboxCollapsed(false);
            }
          }}
        >
          <Inbox className="w-3 h-3" strokeWidth={1.75} />
          {inboxCount > 0 && <span className="brr-os-inbox-rail-count">{inboxCount}</span>}
          <ChevronLeft className="w-3 h-3" strokeWidth={1.75} style={{ marginTop: 'auto', opacity: 0.6 }} />
        </aside>
      ) : (
        <aside className="brr-os-pane brr-os-pane--right">
          <InboxPanel
            refreshKey={bumpInbox}
            onResolved={() => {
              setBumpInbox(k => k + 1);
              refreshPersonas();
              refreshTasks();
              refreshPlans();
            }}
            onCollapse={() => setInboxCollapsed(true)}
          />
        </aside>
      )}
    </div>
    </>
  );
}

function DispatcherIndicator({ status }: { status: DispatcherStatus | null }) {
  if (!status) return null;
  const tone = status.autoPersonas === 0 ? 'off' : status.idleAuto > 0 ? 'on' : 'busy';
  const label =
    status.autoPersonas === 0 ? 'auto: off' :
    status.idleAuto > 0 ? `auto · ${status.idleAuto} ready` :
    'auto · all busy';
  return (
    <span className="brr-os-dispatcher" data-tone={tone} title={
      status.autoPersonas === 0
        ? 'no personas in auto-pickup mode — toggle a persona to auto in /personas'
        : `${status.autoPersonas} auto-personas, ${status.idleAuto} idle. dispatcher last ran ${status.lastTickAt ? Math.round((Date.now() - status.lastTickAt) / 1000) + 's' : 'never'} ago.`
    }>
      <span className="brr-os-dispatcher-dot" />
      <span>{label}</span>
    </span>
  );
}
