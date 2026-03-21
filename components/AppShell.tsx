'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChatBox } from '@/components/ChatBox';
import { PtyTerminal } from '@/components/PtyTerminal';
import {
  Terminal, PanelLeftClose, FileText, DollarSign,
  Workflow, Clock, ScrollText, Home, Code2, GitBranch,
  GripHorizontal, Zap, SquareCode, Plus, Search, Wrench,
  LayoutDashboard,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/workspace', icon: SquareCode, label: 'workspace' },
  { href: '/', icon: Home, label: 'fleet' },
  { href: '/dashboard', icon: LayoutDashboard, label: 'dashboard' },
  { href: '/configs', icon: FileText, label: 'personas' },
  { href: '/skills', icon: Zap, label: 'skills' },
  { href: '/costs', icon: DollarSign, label: 'costs' },
  { href: '/workflows', icon: Workflow, label: 'workflows' },
  { href: '/branches', icon: GitBranch, label: 'branches' },
  { href: '/cron', icon: Clock, label: 'cron' },
  { href: '/logs', icon: ScrollText, label: 'logs' },
  { href: '/api-docs', icon: Code2, label: 'api' },
  { href: '/setup', icon: Wrench, label: 'setup' },
];

const QUICK_ACTIONS = [
  { label: 'spawn with persona', hint: 'new', href: '/configs?new=1', icon: Plus },
  { label: 'new workflow', hint: 'new', href: '/workflows?new=1', icon: Plus },
  { label: 'new skill', hint: 'new', href: '/skills?new=1', icon: Plus },
  { label: 'new cron job', hint: 'new', href: '/cron?new=1', icon: Plus },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(true);
  const [termOpen, setTermOpen] = useState(false);
  const [termHeight, setTermHeight] = useState(280); // px
  const [prCount, setPrCount] = useState(0);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [cmdSearch, setCmdSearch] = useState('');
  const [cmdSelected, setCmdSelected] = useState(0);
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const router = useRouter();
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdPaletteOpen(prev => {
          if (!prev) {
            setCmdSearch('');
            setCmdSelected(0);
            setTimeout(() => cmdInputRef.current?.focus(), 30);
          }
          return !prev;
        });
      }
      if (e.key === 'Escape') {
        setCmdPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const allItems = [
    ...NAV_ITEMS.map(item => ({ ...item, hint: 'go', isNav: true })),
    ...QUICK_ACTIONS.map(item => ({ ...item, isNav: false })),
  ];
  const filteredItems = cmdSearch.trim()
    ? allItems.filter(item => item.label.toLowerCase().includes(cmdSearch.toLowerCase()))
    : allItems;

  const handleCmdSelect = (href: string) => {
    setCmdPaletteOpen(false);
    router.push(href);
  };

  const handleCmdKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCmdSelected(s => Math.min(s + 1, filteredItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCmdSelected(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filteredItems[cmdSelected];
      if (item) handleCmdSelect(item.href);
    } else if (e.key === 'Escape') {
      setCmdPaletteOpen(false);
    }
  };

  return (
    <div className="h-screen flex overflow-hidden bg-[#0a0a0a]">
      {/* Left: persistent orchestrator chat (collapsible) — hidden on workspace (has its own), hidden on mobile */}
      {pathname === '/workspace' ? null : chatOpen ? (
        <div ref={panelRef} className="hidden md:flex w-[420px] flex-shrink-0 border-r border-zinc-800 h-full flex-col">
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
      ) : pathname === '/workspace' ? null : (
        <button
          onClick={() => setChatOpen(true)}
          className="hidden md:flex w-10 flex-shrink-0 border-r border-zinc-800 flex-col items-center justify-center gap-2 hover:bg-zinc-900 transition-colors group"
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
        <nav className="flex-shrink-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm overflow-x-auto">
          <div className="flex items-center gap-1 px-4 py-2 flex-shrink-0">
            <span className="font-mono text-xs font-bold text-zinc-300 mr-3 tracking-tight">boardroom</span>
            {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-label={label}
                  className={`text-[11px] font-mono flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors flex-shrink-0 ${
                    active
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
                  }`}
                >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">{label}</span>
                </Link>
              );
            })}
          </div>
          <button
            onClick={() => { setCmdSearch(''); setCmdSelected(0); setCmdPaletteOpen(true); setTimeout(() => cmdInputRef.current?.focus(), 30); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900 transition-colors text-[11px] font-mono flex-shrink-0"
            title="Command palette (⌘K)"
          >
            <Search className="w-3 h-3" />
            <span className="hidden md:inline">⌘K</span>
          </button>
        </nav>

        {/* Page content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {children}
        </div>
      </div>

      {/* Command palette modal */}
      {cmdPaletteOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-24"
          onClick={() => setCmdPaletteOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          {/* Palette */}
          <div
            className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
              <Search className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
              <input
                ref={cmdInputRef}
                value={cmdSearch}
                onChange={e => { setCmdSearch(e.target.value); setCmdSelected(0); }}
                onKeyDown={handleCmdKeyDown}
                placeholder="navigate or search..."
                className="flex-1 bg-transparent outline-none font-mono text-sm text-zinc-200 placeholder:text-zinc-600"
              />
              <span className="text-[10px] font-mono text-zinc-600 flex-shrink-0">esc</span>
            </div>
            {/* Items */}
            <div className="max-h-80 overflow-y-auto py-1">
              {filteredItems.length === 0 ? (
                <div className="px-4 py-3 text-[11px] font-mono text-zinc-600">no results</div>
              ) : filteredItems.map((item, i) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.href + item.label}
                    onClick={() => handleCmdSelect(item.href)}
                    onMouseEnter={() => setCmdSelected(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                      i === cmdSelected ? 'bg-emerald-500/10 text-emerald-300' : 'text-zinc-400 hover:text-zinc-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="font-mono text-[12px] flex-1">{item.label}</span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                      i === cmdSelected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-600'
                    }`}>
                      {item.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
