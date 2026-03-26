'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChatBox } from '@/components/ChatBox';
import { PtyTerminal } from '@/components/PtyTerminal';
import { ToastContainer } from '@/components/Toast';
import { toast } from '@/lib/toast';
import { useTheme } from '@/components/ThemeProvider';
import {
  Terminal, PanelLeftClose, FileText,
  Workflow, Home,
  GripHorizontal, SquareCode, Plus, Search, Wrench,
  LayoutDashboard, Keyboard, Palette,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/workspace', icon: SquareCode, label: 'workspace' },
  { href: '/', icon: Home, label: 'fleet' },
  { href: '/dashboard', icon: LayoutDashboard, label: 'dashboard' },
  { href: '/workflows', icon: Workflow, label: 'pipelines' },
  { href: '/configs', icon: FileText, label: 'library' },
  { href: '/settings', icon: Wrench, label: 'settings' },
];

const QUICK_ACTIONS = [
  { label: 'spawn with persona', hint: 'new', href: '/configs?new=1', icon: Plus },
  { label: 'new workflow', hint: 'new', href: '/workflows?new=1', icon: Plus },
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
  // theme dropdown removed — now cycles on click
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme, cycleThemes, getThemeLabel, getThemeAccent } = useTheme();
  const dragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevPathname = useRef<string | null>(null);

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

  // Play whoosh on navigation (pathname changes)
  useEffect(() => {
    prevPathname.current = pathname;
  }, [pathname]);

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
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === '/') {
        e.preventDefault();
        setChatOpen(true);
        setTimeout(() => {
          const chatInput = document.querySelector('textarea[placeholder*="orchestrator"]') as HTMLTextAreaElement;
          chatInput?.focus();
        }, 100);
      }

      if (mod && !e.shiftKey && e.key === 'k') {
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

      // Cmd/Ctrl+Shift+N — open spawn modal
      if (mod && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        // Dispatch a custom event that page.tsx can listen to
        window.dispatchEvent(new CustomEvent('boardroom:spawn'));
      }

      // Cmd/Ctrl+Shift+K — kill all running agents
      if (mod && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        fetch('/api/agents')
          .then(r => r.json())
          .then(data => {
            const running = (data.agents || []).filter(
              (a: { status: string }) => a.status === 'running' || a.status === 'spawning'
            );
            if (running.length === 0) {
              toast.info('no running agents to kill');
              return;
            }
            Promise.all(
              running.map((a: { id: string }) => fetch(`/api/agents/${a.id}`, { method: 'DELETE' }))
            ).then(() => {
              toast.success(`killed ${running.length} agent${running.length !== 1 ? 's' : ''}`);
            }).catch(() => {
              toast.error('failed to kill some agents');
            });
          })
          .catch(() => toast.error('failed to fetch agents'));
      }

      // Cmd+Shift+D — navigate to /dashboard
      if (mod && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        router.push('/dashboard');
      }

      // Cmd+Shift+W — navigate to /workspace
      if (mod && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        router.push('/workspace');
      }

      // Cmd+Shift+F — navigate to / (fleet)
      if (mod && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        router.push('/');
      }

      if (e.key === 'Escape') {
        setCmdPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);

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
    <div className="noise-bg h-screen flex overflow-hidden bg-[var(--br-bg-primary)]">
      {/* Left: persistent orchestrator chat (collapsible) — hidden on workspace (has its own), hidden on mobile */}
      {pathname === '/workspace' ? null : chatOpen ? (
        <div ref={panelRef} className="hidden md:flex w-[420px] flex-shrink-0 border-r border-[var(--br-border)] h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--br-border)] flex-shrink-0">
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--br-text-secondary)]">
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
                className={`p-1 rounded transition-colors ${termOpen ? 'text-[var(--br-accent)] bg-[var(--br-accent)]/10' : 'text-[var(--br-text-muted)] hover:text-[var(--br-text-secondary)]'}`}
                title={termOpen ? 'Hide terminal' : 'Show terminal'}
              >
                <Terminal className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setChatOpen(false)} className="text-[var(--br-text-muted)] hover:text-[var(--br-text-secondary)] transition-colors" title="Collapse panel">
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
                className="flex-shrink-0 h-2 border-y border-[var(--br-border)] bg-[var(--br-bg-secondary)]/50 cursor-row-resize flex items-center justify-center hover:bg-[var(--br-bg-hover)] transition-colors group"
              >
                <GripHorizontal className="w-4 h-3 text-[var(--br-text-muted)] group-hover:text-[var(--br-text-secondary)]" />
              </div>
            </>
          )}

          {/* Chat (bottom) */}
          <ChatBox />
        </div>
      ) : pathname === '/workspace' ? null : (
        <button
          onClick={() => setChatOpen(true)}
          className="hidden md:flex w-10 flex-shrink-0 border-r border-[var(--br-border)] flex-col items-center justify-center gap-2 hover:bg-[var(--br-bg-secondary)] transition-colors group"
          title="Open chat"
        >
          <Terminal className="w-4 h-4 text-[var(--br-text-muted)] group-hover:text-[var(--br-text-secondary)]" />
          {prCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-amber-500 text-[8px] font-mono text-black font-bold flex items-center justify-center">
              {prCount}
            </span>
          )}
          <span
            className="text-[10px] font-mono text-[var(--br-text-muted)] group-hover:text-[var(--br-text-secondary)]"
            style={{ writingMode: 'vertical-rl' as const }}
          >
            orchestrator
          </span>
        </button>
      )}

      {/* Right: nav + page content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Persistent nav bar */}
        <nav className="flex-shrink-0 flex items-center justify-between border-b border-[var(--br-border)] bg-[var(--br-bg-primary)]/80 backdrop-blur-sm overflow-x-auto">
          <div className="flex items-center gap-1 px-4 py-2 flex-shrink-0">
            <span className="font-mono text-xs font-bold text-[var(--br-text-secondary)] mr-3 tracking-tight">boardroom</span>
            {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
              const active = href === '/'
                ? pathname === '/' || pathname.startsWith('/logs')
                : href === '/workflows'
                ? pathname.startsWith('/workflows') || pathname.startsWith('/cron')
                : href === '/configs'
                ? pathname.startsWith('/configs') || pathname.startsWith('/skills') || pathname.startsWith('/marketplace')
                : href === '/settings'
                ? pathname.startsWith('/settings') || pathname.startsWith('/setup') || pathname.startsWith('/api-docs') || pathname.startsWith('/branches')
                : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-label={label}
                  className={`text-[11px] font-mono flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all duration-200 hover:scale-[1.02] flex-shrink-0 ${
                    active
                      ? 'bg-[var(--br-bg-hover)] text-[var(--br-text-primary)] shadow-[0_0_12px_rgba(52,211,153,0.15)]'
                      : 'text-[var(--br-text-muted)] hover:text-[var(--br-text-secondary)] hover:bg-[var(--br-bg-secondary)]'
                  }`}
                >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">{label}</span>
                </Link>
              );
            })}
          </div>
          <div className="flex items-center flex-shrink-0">
            {/* Theme toggle — cycles through themes on click */}
            <button
              onClick={() => {
                const list = cycleThemes.length > 0 ? cycleThemes : ['dark'];
                const idx = list.indexOf(theme);
                const next = list[(idx + 1) % list.length];
                setTheme(next);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[var(--br-text-muted)] hover:text-[var(--br-text-secondary)] hover:bg-[var(--br-bg-secondary)] transition-colors text-[11px] font-mono"
              title={`Theme: ${getThemeLabel(theme)} (click to cycle)`}
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: getThemeAccent(theme) }} />
              <span className="hidden md:inline">{getThemeLabel(theme)}</span>
            </button>
            <button
              onClick={() => { setCmdSearch(''); setCmdSelected(0); setCmdPaletteOpen(true); setTimeout(() => cmdInputRef.current?.focus(), 30); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[var(--br-text-muted)] hover:text-[var(--br-text-secondary)] hover:bg-[var(--br-bg-secondary)] transition-colors text-[11px] font-mono"
              title="Command palette (⌘K)"
            >
              <Search className="w-3 h-3" />
              <span className="hidden md:inline">⌘K</span>
            </button>
          </div>
        </nav>

        {/* Page content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden animate-fade-in">
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
            className="relative w-full max-w-md bg-[var(--br-bg-card)]/90 backdrop-blur-xl border border-[var(--br-border)] rounded-xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--br-border)]">
              <Search className="w-3.5 h-3.5 text-[var(--br-text-muted)] flex-shrink-0" />
              <input
                ref={cmdInputRef}
                value={cmdSearch}
                onChange={e => { setCmdSearch(e.target.value); setCmdSelected(0); }}
                onKeyDown={handleCmdKeyDown}
                placeholder="navigate or search..."
                className="flex-1 bg-transparent outline-none font-mono text-sm text-[var(--br-text-primary)] placeholder:text-[var(--br-text-muted)]"
              />
              <span className="text-[10px] font-mono text-[var(--br-text-muted)] flex-shrink-0">esc</span>
            </div>
            {/* Items */}
            <div className="max-h-80 overflow-y-auto py-1">
              {filteredItems.length === 0 ? (
                <div className="px-4 py-3 text-[11px] font-mono text-[var(--br-text-muted)]">no results</div>
              ) : filteredItems.map((item, i) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.href + item.label}
                    onClick={() => handleCmdSelect(item.href)}
                    onMouseEnter={() => setCmdSelected(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                      i === cmdSelected ? 'bg-[var(--br-accent)]/10 text-[var(--br-accent)]' : 'text-[var(--br-text-secondary)] hover:text-[var(--br-text-primary)]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="font-mono text-[12px] flex-1">{item.label}</span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                      i === cmdSelected ? 'bg-[var(--br-accent)]/20 text-[var(--br-accent)]' : 'bg-[var(--br-bg-hover)] text-[var(--br-text-muted)]'
                    }`}>
                      {item.hint}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Keyboard shortcuts section */}
            {!cmdSearch.trim() && (
              <div className="border-t border-[var(--br-border)] px-3 py-2">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Keyboard className="w-3 h-3 text-[var(--br-text-muted)]" />
                  <span className="text-[9px] font-mono text-[var(--br-text-muted)] uppercase tracking-wider">shortcuts</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {[
                    ['⌘⇧N', 'spawn agent'],
                    ['⌘⇧K', 'kill all agents'],
                    ['⌘⇧F', 'fleet'],
                    ['⌘⇧W', 'workspace'],
                    ['⌘⇧D', 'dashboard'],
                    ['⌘K', 'command palette'],
                    ['⌘/', 'orchestrator chat'],
                  ].map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2 py-0.5">
                      <span className="text-[9px] font-mono text-[var(--br-text-secondary)] bg-[var(--br-bg-hover)] px-1.5 py-0.5 rounded flex-shrink-0">{key}</span>
                      <span className="text-[10px] font-mono text-[var(--br-text-muted)]">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}
