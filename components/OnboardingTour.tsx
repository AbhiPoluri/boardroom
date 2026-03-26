'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

const STORAGE_KEY = 'boardroom:onboarding-done';

interface Step {
  title: string;
  description: string;
  path: string | null;
  // CSS selector or named area for spotlight highlight
  highlight: string | null;
  // Fallback fixed bounds (top/left/width/height) if selector not found or named area
  highlightBounds?: { top: string; left: string; width: string; height: string };
  isOverlay?: boolean; // full-screen centered card, no spotlight
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Boardroom',
    description:
      'AI Agent Orchestration Platform. Spawn agents, run pipelines, and manage your entire fleet from one place.',
    path: null,
    highlight: null,
    isOverlay: true,
  },
  {
    title: 'Agent Fleet',
    description:
      'This is your command center. Every agent you spawn appears here with live status, cost tracking, and terminal output. Click any card to see details.',
    path: '/',
    highlight: '[data-tour="agent-grid"]',
    highlightBounds: { top: '100px', left: '420px', width: 'calc(100% - 420px)', height: 'calc(100% - 120px)' },
  },
  {
    title: 'Spawn Agents',
    description:
      'Click here to launch a new agent. Choose from Claude Code, Codex, or OpenCode. Assign a task, pick a model, and optionally enable git isolation.',
    path: '/',
    highlight: '[data-tour="spawn-btn"]',
    highlightBounds: { top: '10px', left: 'calc(100% - 130px)', width: '120px', height: '36px' },
  },
  {
    title: 'IDE Workspace',
    description:
      'Browse files, edit code, review diffs, and manage PRs — all in one view. The right panel shows active agents working on this repo.',
    path: '/workspace',
    highlight: null,
    highlightBounds: { top: '60px', left: '0', width: '100%', height: 'calc(100% - 60px)' },
  },
  {
    title: 'Dashboard',
    description:
      'Monitor fleet health, costs, token usage, and pipeline status. All widgets update in real-time.',
    path: '/dashboard',
    highlight: null,
    highlightBounds: { top: '60px', left: '0', width: '100%', height: 'calc(100% - 60px)' },
  },
  {
    title: 'Visual Pipelines',
    description:
      'Build multi-step workflows with a drag-and-drop DAG editor. Chain agents with evaluator loops, conditional routing, and output passing.',
    path: '/workflows',
    highlight: null,
    highlightBounds: { top: '60px', left: '0', width: '100%', height: 'calc(100% - 60px)' },
  },
  {
    title: 'Marketplace',
    description:
      'Browse 100+ skills, MCP servers, and agent personas. Search, preview, and install with one click.',
    path: '/marketplace',
    highlight: null,
    highlightBounds: { top: '60px', left: '0', width: '100%', height: 'calc(100% - 60px)' },
  },
  {
    title: "You're ready!",
    description: 'Start by spawning your first agent or exploring the marketplace.',
    path: '/',
    highlight: null,
    isOverlay: true,
  },
];

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-1.5 justify-center mt-5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`inline-block rounded-full transition-all duration-300 ${
            i < current
              ? 'w-1.5 h-1.5 bg-emerald-400'
              : i === current
              ? 'w-4 h-1.5 bg-emerald-400'
              : 'w-1.5 h-1.5 bg-zinc-700'
          }`}
        />
      ))}
    </div>
  );
}

function SpotlightHighlight({
  bounds,
}: {
  bounds: { top: string; left: string; width: string; height: string };
}) {
  return (
    <div
      className="fixed z-[201] rounded-lg pointer-events-none"
      style={{
        top: bounds.top,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
        boxShadow:
          '0 0 0 9999px rgba(0,0,0,0.62), 0 0 0 2px rgba(52,211,153,0.7)',
        border: '2px solid rgba(52,211,153,0.6)',
        transition: 'all 200ms ease',
      }}
    />
  );
}

interface OnboardingTourProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

export function OnboardingTour({ forceOpen, onClose }: OnboardingTourProps = {}) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [fading, setFading] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [highlightBounds, setHighlightBounds] = useState<{
    top: string;
    left: string;
    width: string;
    height: string;
  } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (forceOpen) {
      setStep(0);
      setVisible(true);
      return;
    }
    if (typeof window !== 'undefined') {
      const done = localStorage.getItem(STORAGE_KEY);
      if (!done) {
        setVisible(true);
      }
    }
  }, [forceOpen]);

  // Resolve highlight bounds from selector or fallback
  useEffect(() => {
    const current = STEPS[step];
    if (!visible || current.isOverlay || !current.highlightBounds) {
      setHighlightBounds(null);
      return;
    }

    const tryResolve = () => {
      if (current.highlight) {
        const el = document.querySelector(current.highlight);
        if (el) {
          const rect = el.getBoundingClientRect();
          setHighlightBounds({
            top: `${rect.top - 6}px`,
            left: `${rect.left - 6}px`,
            width: `${rect.width + 12}px`,
            height: `${rect.height + 12}px`,
          });
          return;
        }
      }
      // Fallback to approximate fixed bounds
      setHighlightBounds(current.highlightBounds!);
    };

    tryResolve();
  }, [step, visible, navigating]);

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, '1');
    setFading(true);
    setTimeout(() => {
      setVisible(false);
      setFading(false);
      onClose?.();
    }, 200);
  }, [onClose]);

  const goToStep = useCallback(
    (nextStep: number) => {
      const current = STEPS[nextStep];
      setFading(true);

      const doNav = () => {
        setStep(nextStep);

        if (current.path !== null) {
          setNavigating(true);
          router.push(current.path);
          // Wait for page to settle
          setTimeout(() => {
            setNavigating(false);
            setFading(false);
          }, 550);
        } else {
          setFading(false);
        }
      };

      setTimeout(doNav, 150);
    },
    [router]
  );

  const goNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      goToStep(step + 1);
    } else {
      dismiss();
    }
  }, [step, goToStep, dismiss]);

  const goBack = useCallback(() => {
    if (step > 0) {
      goToStep(step - 1);
    }
  }, [step, goToStep]);

  if (!visible) return null;

  const current = STEPS[step];
  const isCentered = !!current.isOverlay;
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  const cardPositionClass = isCentered
    ? 'inset-0 flex items-center justify-center'
    : 'inset-0 flex items-end justify-center pb-10 sm:items-center';

  return (
    <>
      {/* Backdrop — only show solid backdrop on overlay steps; spotlight handles it for others */}
      {isCentered && (
        <div
          className="fixed inset-0 z-[200] pointer-events-auto"
          style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(2px)' }}
          onClick={dismiss}
          aria-hidden="true"
        />
      )}

      {/* Spotlight highlight for non-overlay steps */}
      {!isCentered && highlightBounds && (
        <SpotlightHighlight bounds={highlightBounds} />
      )}

      {/* Non-overlay fallback full backdrop when no highlight resolved yet */}
      {!isCentered && !highlightBounds && (
        <div
          className="fixed inset-0 z-[200] pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.62)' }}
          aria-hidden="true"
        />
      )}

      {/* Tour card */}
      <div
        className={`fixed z-[202] pointer-events-auto transition-opacity duration-150 ${
          fading || navigating ? 'opacity-0' : 'opacity-100'
        } ${cardPositionClass}`}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="w-full max-w-[440px] mx-4 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6"
          style={{ boxShadow: '0 0 60px rgba(52,211,153,0.08), 0 25px 50px rgba(0,0,0,0.7)' }}
        >
          {/* Header row */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest">
              {step + 1} / {STEPS.length}
            </span>
            <button
              onClick={dismiss}
              className="text-zinc-600 hover:text-zinc-400 transition-colors text-lg leading-none"
              aria-label="Close tour"
            >
              ×
            </button>
          </div>

          {/* Content */}
          <h2
            className={`font-mono font-semibold text-zinc-100 mb-2 ${
              isCentered ? 'text-xl' : 'text-base'
            }`}
          >
            {current.title}
          </h2>
          <p className="font-mono text-[12px] text-zinc-400 leading-relaxed">
            {current.description}
          </p>

          {/* Progress dots */}
          <StepDots total={STEPS.length} current={step} />

          {/* Actions */}
          <div className="flex items-center justify-between mt-4 gap-2">
            <button
              onClick={dismiss}
              className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              skip tour
            </button>

            <div className="flex items-center gap-2">
              {!isFirst && (
                <button
                  onClick={goBack}
                  className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 text-zinc-400 hover:text-zinc-200 text-[12px] font-mono transition-colors"
                >
                  back
                </button>
              )}
              <button
                onClick={goNext}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-mono transition-colors"
              >
                {isFirst ? 'start tour' : isLast ? 'get started' : 'next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Hook to programmatically restart the tour from anywhere (e.g. settings page). */
export function useRestartTour() {
  return useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
      window.location.href = '/';
    }
  }, []);
}
