'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal, X } from 'lucide-react';
import { ChatBox } from '@/components/ChatBox';
import { ActivePlanPanel } from '@/components/ActivePlanPanel';

interface FloatingChatDockProps {
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  prCount?: number;
}

const IDLE_COLLAPSE_MS = 6000;

export function FloatingChatDock({ expanded, onExpandedChange, prCount = 0 }: FloatingChatDockProps) {
  const dockRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [hasInnerFocus, setHasInnerFocus] = useState(false);

  // Outside click collapses
  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: MouseEvent) => {
      if (!dockRef.current?.contains(e.target as Node)) onExpandedChange(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [expanded, onExpandedChange]);

  // Escape collapses
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExpandedChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, onExpandedChange]);

  // Idle auto-collapse: when expanded but unhovered and no inner focus
  useEffect(() => {
    if (!expanded) return;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (hovered || hasInnerFocus) return;
    idleTimer.current = setTimeout(() => onExpandedChange(false), IDLE_COLLAPSE_MS);
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [expanded, hovered, hasInnerFocus, onExpandedChange]);

  // Track focus inside the dock without re-rendering on every keystroke
  useEffect(() => {
    const node = dockRef.current;
    if (!node) return;
    const onFocusIn = () => setHasInnerFocus(true);
    const onFocusOut = () => {
      setHasInnerFocus(node.contains(document.activeElement));
    };
    node.addEventListener('focusin', onFocusIn);
    node.addEventListener('focusout', onFocusOut);
    return () => {
      node.removeEventListener('focusin', onFocusIn);
      node.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const focusComposer = () => {
    setTimeout(() => {
      const el = dockRef.current?.querySelector(
        'textarea[placeholder*="orchestrator"]'
      ) as HTMLTextAreaElement | null;
      el?.focus();
    }, 80);
  };

  const expand = () => {
    onExpandedChange(true);
    focusComposer();
  };

  const idle = !hovered && !hasInnerFocus;

  return (
    <div
      ref={dockRef}
      data-tour="composer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] hidden md:block pointer-events-auto"
      style={{
        opacity: expanded ? 1 : idle ? 0.55 : 1,
        transition: 'opacity 220ms cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      {expanded ? (
        <div
          className="flex flex-col bg-[var(--br-bg-card)]/95 backdrop-blur-xl border border-[var(--br-border)] rounded-2xl shadow-[0_24px_48px_rgba(0,0,0,0.45)] overflow-hidden"
          style={{
            width: 'min(560px, calc(100vw - 48px))',
            height: 'min(620px, calc(100vh - 96px))',
            animation: 'brrDockUp 240ms cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--br-border)]/60 flex-shrink-0">
            <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--br-text-secondary)] uppercase tracking-[0.14em]">
              <Terminal className="w-3 h-3" />
              orchestrator
              {prCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[9px] tracking-wider normal-case">
                  {prCount} PR{prCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              onClick={() => onExpandedChange(false)}
              className="p-1 rounded text-[var(--br-text-muted)] hover:text-[var(--br-text-secondary)] hover:bg-[var(--br-bg-hover)] transition-colors"
              title="Collapse (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ActivePlanPanel />
          <div className="flex-1 min-h-0">
            <ChatBox />
          </div>
        </div>
      ) : (
        <button
          onClick={expand}
          className="group flex items-center gap-2 pl-3 pr-3.5 py-2.5 rounded-full bg-[var(--br-bg-card)]/85 backdrop-blur-md border border-[var(--br-border)] shadow-[0_8px_28px_rgba(0,0,0,0.35)] hover:bg-[var(--br-bg-card)] hover:border-[var(--br-border-strong,var(--br-border))] transition-colors"
          title="Open orchestrator (⌘/)"
        >
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--br-accent)]/15 text-[var(--br-accent)]">
            <Terminal className="w-3 h-3" />
          </span>
          <span className="font-mono text-[12px] text-[var(--br-text-secondary)] group-hover:text-[var(--br-text-primary)] transition-colors">
            ask the orchestrator…
          </span>
          {prCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[9px] font-mono tracking-wider">
              {prCount} PR{prCount !== 1 ? 's' : ''}
            </span>
          )}
          <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono text-[var(--br-text-muted)] bg-[var(--br-bg-hover)] tracking-wider">
            ⌘/
          </span>
        </button>
      )}
      <style jsx>{`
        @keyframes brrDockUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
