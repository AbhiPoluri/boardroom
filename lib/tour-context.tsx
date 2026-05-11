'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Interactive guided tour. Walks the user through real pages, spotlighting
 * the UI element each step describes via a data-tour attribute the
 * TourSpotlight component reads. Routes change as the tour advances.
 */

export interface TourStep {
  id: string;
  route: string;
  /** value of the [data-tour="..."] attribute on the element to highlight.
   *  Omit for a centered "welcome / done" card with no spotlight target. */
  target?: string;
  title: string;
  body: React.ReactNode;
  /** preferred tooltip placement relative to the spotlighted element. */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/',
    title: 'Welcome to Boardroom',
    body: (
      <>
        Quick tour of the real surfaces — about a minute. You can <strong>exit</strong> any time, your work stays intact.
      </>
    ),
    placement: 'center',
  },
  {
    id: 'personas-pane',
    route: '/',
    target: 'personas-pane',
    title: 'Your team lives here',
    body: 'Personas are named workers — each runs on a specific CLI runtime (claude/hermes/codex/opencode), shown by the colored pill next to their name.',
    placement: 'right',
  },
  {
    id: 'task-board',
    route: '/',
    target: 'task-board',
    title: 'The task board',
    body: 'Four columns — Open, In Progress, Blocked, Done. Tasks flow left to right as personas pick them up and complete them.',
    placement: 'left',
  },
  {
    id: 'composer',
    route: '/',
    target: 'composer',
    title: 'Type tasks here',
    body: 'Hit / to focus the composer from anywhere. Type a task description, pick a persona (or leave blank for auto-dispatch), and submit.',
    placement: 'top',
  },
  {
    id: 'personas-editor',
    route: '/personas',
    target: 'personas-list',
    title: 'Edit personas',
    body: 'Adjust skills, system prompt, model, autonomy, and runtime. The runtime badge next to each name shows which CLI fires when they wake.',
    placement: 'right',
  },
  {
    id: 'planning',
    route: '/planning',
    target: 'plans-list',
    title: 'Plans for multi-step work',
    body: 'A plan chains N subtasks across N personas. Sequential plans with auto_merge accumulate file edits into one final result.',
    placement: 'right',
  },
  {
    id: 'review',
    route: '/review',
    target: 'review-queue',
    title: 'Push request queue',
    body: 'Every finished task opens a PR here. Batch-approve, revert, or let the conflict resolver auto-merge.',
    placement: 'right',
  },
  {
    id: 'custom-pages',
    route: '/custom',
    target: 'custom-list',
    title: 'Custom pages (Slice 3)',
    body: (
      <>
        Personas can author pages at <code>/custom/[slug]</code>. Two kinds today — markdown or analytics — more coming.
      </>
    ),
    placement: 'right',
  },
  {
    id: 'workflows',
    route: '/workflows',
    title: 'Workflows on cron',
    body: 'Wrap a plan in a cron schedule. Each tick spawns a fresh plan run — handy for recurring research drops.',
    placement: 'center',
  },
  {
    id: 'done',
    route: '/',
    title: 'You\'re ready',
    body: (
      <>
        That\'s the surface area. Hit the <strong>?</strong> in the top-right anytime to reopen this tour or the long-form tutorial.
      </>
    ),
    placement: 'center',
  },
];

interface TourContextValue {
  active: boolean;
  step: number;
  totalSteps: number;
  currentStep: TourStep | null;
  start: () => void;
  next: () => void;
  prev: () => void;
  goto: (id: string) => void;
  exit: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used inside <TourProvider>');
  return ctx;
}

const STORAGE_KEY = 'brr-tour-state';

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);

  // Persist tour state across route navigations (the provider remounts
  // sometimes during Next route changes; in-memory state would reset).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { active: boolean; step: number };
        if (parsed.active && typeof parsed.step === 'number') {
          setActive(true);
          setStep(parsed.step);
        }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ active, step })); } catch { /* ignore */ }
  }, [active, step]);

  const goToStep = useCallback((idx: number) => {
    if (idx < 0 || idx >= TOUR_STEPS.length) return;
    setStep(idx);
    const target = TOUR_STEPS[idx].route;
    if (typeof window !== 'undefined' && window.location.pathname !== target) {
      router.push(target);
    }
  }, [router]);

  const value: TourContextValue = {
    active,
    step,
    totalSteps: TOUR_STEPS.length,
    currentStep: active ? TOUR_STEPS[step] ?? null : null,
    start: () => {
      setStep(0);
      setActive(true);
      router.push(TOUR_STEPS[0].route);
    },
    next: () => {
      if (step >= TOUR_STEPS.length - 1) {
        setActive(false);
        return;
      }
      goToStep(step + 1);
    },
    prev: () => goToStep(step - 1),
    goto: (id) => {
      const idx = TOUR_STEPS.findIndex(s => s.id === id);
      if (idx >= 0) goToStep(idx);
    },
    exit: () => {
      setActive(false);
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    },
  };

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
