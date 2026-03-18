'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChatBox } from '@/components/ChatBox';
import { PtyTerminal } from '@/components/PtyTerminal';
import {
  Terminal, PanelLeftClose, FileText, DollarSign,
  Workflow, Clock, ScrollText, Home, Code2, GitBranch,
  GripHorizontal, Zap, SquareCode,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/workspace', icon: SquareCode, label: 'workspace' },
  { href: '/', icon: Home, label: 'fleet' },
  { href: '/configs', icon: FileText, label: 'agents' },
  { href: '/skills', icon: Zap, label: 'skills' },
  { href: '/costs', icon: DollarSign, label: 'costs' },
  { href: '/workflows', icon: Workflow, label: 'workflows' },
  { href: '/branches', icon: GitBranch, label: 'branches' },
  { href: '/cron', icon: Clock, label: 'cron' },
  { href: '/logs', icon: ScrollText, label: 'logs' },
  { href: '/api-docs', icon: Code2, label: 'api' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(true);
  const [termOpen, setTermOpen] = useState(false);
  const [termHeight, setTermHeight] = useState(280); // px
  const [prCount, setPrCount] = useState(0);
  const pathname = usePathname();
  const dragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      const y = ev.clientY - rect.top - 36; // offset for header
      setTermHeight(Math.max(100, Math.min(y, rect.height - 200)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    const fetchCount = () => {
      fetch('/api/push-requests?count=1')
        .then(r => r.json())
        .then(d => setPrCount(d.count || 0))
        .catch(() => {});
    };
    fetchCount();
    const iv = setInterval(fetchCount, 15000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setChatOpen(true);
        setTimeout(() => {
          const chatInput = document.querySelector('textarea[placeholder*="orchestrator"]') as HTMLTextAreaElement;
          chatInput?.focus();
        }, 100);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-[#0a0a0a]">
      {/* Left: persistent orchestrator chat (collapsible) */}
      {chatOpen ? (
        <div ref={panelRef} className="w-[420px] flex-shrink-0 border-r border-zinc-800 h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 flex-shrink-0">
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
              <Terminal className="w-3.5 h-3.5" />
              ORCHESTRATOR
              {prCount > 0 && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[9px] font-mono">
                  {prCount} PR{prCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setTermOpen(!termOpen)}
                className={`p-1 rounded transition-colors ${termOpen ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-600 hover:text-zinc-400'}`}
                title={termOpen ? 'Hide terminal' : 'Show terminal'}
              >
                <Terminal className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setChatOpen(false)} className="text-zinc-600 hover:text-zinc-400 transition-colors" title="Collapse panel">
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Terminal (top, optional) */}
          {termOpen && (
            <>
              <div className="flex-shrink-0 overflow-hidden" style={{ height: termHeight }}>
                <PtyTerminal agentId="__orchestrator__" isActive={true} fontSize={11} />
              </div>
              <div
                onMouseDown={onDragStart}
                className="flex-shrink-0 h-2 border-y border-zinc-800 bg-zinc-900/50 cursor-row-resize flex items-center justify-center hover:bg-zinc-800 transition-colors group"
              >
                <GripHorizontal className="w-4 h-3 text-zinc-700 group-hover:text-zinc-500" />
              </div>
            </>
          )}

          {/* Chat (bottom) */}
          <ChatBox />
        </div>
      ) : (
        <button
          onClick={() => setChatOpen(true)}
          className="w-10 flex-shrink-0 border-r border-zinc-800 flex flex-col items-center justify-center gap-2 hover:bg-zinc-900 transition-colors group"
          title="Open chat"
        >
          <Terminal className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400" />
          {prCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-amber-500 text-[8px] font-mono text-black font-bold flex items-center justify-center">
              {prCount}
            </span>
          )}
          <span
            className="text-[10px] font-mono text-zinc-600 group-hover:text-zinc-400"
            style={{ writingMode: 'vertical-rl' as const }}
          >
            orchestrator
          </span>
        </button>
      )}

      {/* Right: nav + page content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Persistent nav bar */}
        <nav className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs font-bold text-zinc-300 mr-3 tracking-tight">boardroom</span>
            {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-label={label}
                  className={`text-[11px] font-mono flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors ${
                    active
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
                  }`}
                >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Page content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
