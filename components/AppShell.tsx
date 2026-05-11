'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { FloatingChatDock } from '@/components/FloatingChatDock';
import { ProjectSwitcher } from '@/components/ProjectSwitcher';
import { ToastContainer } from '@/components/Toast';
import { toast } from '@/lib/toast';
import { useTheme } from '@/components/ThemeProvider';
import { useProjects } from '@/lib/use-projects';
import {
  FileText, Workflow, Home, Sparkles, SquareCode, Plus, Search, Wrench,
  LayoutDashboard, Bell, Users, ListTodo, Inbox, GitPullRequest,
} from 'lucide-react';

function RingMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

// Agentic-OS nav: home · personas · planning · workflows · review · marketplace · settings.
// Older surfaces (fleet, dashboard, library, workspace) still exist at their
// old routes; reach them via cmd-k.
const NAV_ITEMS = [
  { href: '/', icon: Home, label: 'os' },
  { href: '/personas', icon: Users, label: 'personas' },
  { href: '/planning', icon: Sparkles, label: 'planning' },
  { href: '/workflows', icon: Workflow, label: 'workflows' },
  { href: '/review', icon: GitPullRequest, label: 'review' },
  { href: '/marketplace', icon: FileText, label: 'marketplace' },
  { href: '/settings', icon: Wrench, label: 'settings' },
];

const SECONDARY_NAV = [
  { href: '/fleet', icon: LayoutDashboard, label: 'fleet' },
  { href: '/dashboard', icon: LayoutDashboard, label: 'dashboard' },
  { href: '/workspace', icon: SquareCode, label: 'workspace' },
  { href: '/configs', icon: FileText, label: 'library' },
];

const QUICK_ACTIONS = [
  { label: 'spawn with persona', hint: 'new', href: '/configs?new=1', icon: Plus },
  { label: 'new pipeline', hint: 'new', href: '/workflows?new=1', icon: Plus },
  { label: 'new cron job', hint: 'new', href: '/cron?new=1', icon: Plus },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/os');
  if (href === '/personas') return pathname.startsWith('/personas');
  if (href === '/workflows') return pathname.startsWith('/workflows') || pathname.startsWith('/cron');
  if (href === '/marketplace') return (
    pathname.startsWith('/marketplace') || pathname.startsWith('/skills') || pathname.startsWith('/configs')
  );
  if (href === '/settings') return (
    pathname.startsWith('/settings') || pathname.startsWith('/setup') || pathname.startsWith('/api-docs') || pathname.startsWith('/branches')
  );
  return pathname.startsWith(href);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [dockExpanded, setDockExpanded] = useState(false);
  const [prCount, setPrCount] = useState(0);
  const [latestPendingPrId, setLatestPendingPrId] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [cmdSearch, setCmdSearch] = useState('');
  const [cmdSelected, setCmdSelected] = useState(0);
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme, cycleThemes, getThemeLabel, getThemeAccent } = useTheme();
  const { active: activeProject, projects, setActive: setActiveProject, refresh: refreshProjects } = useProjects();

  useEffect(() => {
    const fetchCount = () => {
      // One call returns both the count (via length) and the latest id we
      // need for the bell deep-link, so we fetch the list directly instead
      // of doing a separate ?count=1 round trip.
      fetch('/api/push-requests?status=pending')
        .then(r => r.json())
        .then(d => {
          const list = d.requests || [];
          setPrCount(list.length);
          setLatestPendingPrId(list[0]?.id ?? null);
        })
        .catch(() => {});
      fetch('/api/pending-questions?count=1')
        .then(r => r.json())
        .then(d => setQuestionCount(d.count || 0))
        .catch(() => {});
    };
    fetchCount();
    const iv = setInterval(fetchCount, 8000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === '/') {
        e.preventDefault();
        setDockExpanded(true);
        setTimeout(() => {
          const chatInput = document.querySelector('textarea[placeholder*="orchestrator"]') as HTMLTextAreaElement;
          chatInput?.focus();
        }, 120);
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

      if (mod && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('boardroom:spawn'));
      }

      if (mod && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        fetch('/api/agents')
          .then(r => r.json())
          .then(data => {
            const running = (data.agents || []).filter(
              (a: { status: string }) => a.status === 'running' || a.status === 'spawning'
            );
            if (running.length === 0) { toast.info('no running agents to kill'); return; }
            Promise.all(
              running.map((a: { id: string }) => fetch(`/api/agents/${a.id}`, { method: 'DELETE' }))
            ).then(() => {
              toast.success(`killed ${running.length} agent${running.length !== 1 ? 's' : ''}`);
            }).catch(() => toast.error('failed to kill some agents'));
          })
          .catch(() => toast.error('failed to fetch agents'));
      }

      if (mod && e.shiftKey && e.key === 'D') { e.preventDefault(); router.push('/dashboard'); }
      if (mod && e.shiftKey && e.key === 'W') { e.preventDefault(); router.push('/workspace'); }
      if (mod && e.shiftKey && e.key === 'F') { e.preventDefault(); router.push('/fleet'); }
      if (mod && e.shiftKey && e.key === 'O') { e.preventDefault(); router.push('/'); }
      if (mod && e.shiftKey && e.key === 'P') { e.preventDefault(); router.push('/personas'); }
      if (e.key === 'Escape') setCmdPaletteOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);

  const allItems = [
    ...NAV_ITEMS.map(item => ({ ...item, hint: 'go', isNav: true })),
    ...SECONDARY_NAV.map(item => ({ ...item, hint: 'go', isNav: true })),
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
    <div className="brr-app">
      <main className="brr-main">
        {/* Top nav — wordmark + mono items + right cluster */}
        <nav className="brr-nav">
          <div className="brr-nav-left">
            <span className="brr-wordmark">
              <span
                className="brr-wordmark-mark"
                style={{
                  background: 'transparent',
                  color: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RingMark size={14} />
              </span>
              <span>boardroom</span>
            </span>
            <ProjectSwitcher
              active={activeProject}
              projects={projects}
              onActiveChange={(id) => { void setActiveProject(id); }}
              onProjectsChange={() => { void refreshProjects(); }}
            />
            {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-label={label}
                  className={`brr-nav-item ${active ? 'is-active' : ''}`}
                >
                  <Icon className="w-3 h-3" strokeWidth={1.75} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
          <div className="brr-nav-right">
            <Link
              href="/"
              className="brr-nav-item"
              title={questionCount > 0 ? `${questionCount} pending question${questionCount === 1 ? '' : 's'}` : 'inbox'}
            >
              <Inbox className="w-3 h-3" strokeWidth={1.75} />
              {questionCount > 0 && <span className="brr-pr-dot">{questionCount}</span>}
            </Link>
            <Link
              href={prCount > 0 && latestPendingPrId ? `/review?id=${latestPendingPrId}` : '/review'}
              className="brr-nav-item"
              title={prCount > 0 ? `${prCount} pending push request${prCount === 1 ? '' : 's'} — open most recent` : 'review queue'}
            >
              <Bell className="w-3 h-3" strokeWidth={1.75} />
              {prCount > 0 && <span className="brr-pr-dot">{prCount}</span>}
            </Link>
            <button
              className="brr-nav-item"
              type="button"
              title={`Theme: ${getThemeLabel(theme)} (click to cycle)`}
              onClick={() => {
                const list = cycleThemes.length > 0 ? cycleThemes : ['claude', 'dark'];
                const idx = list.indexOf(theme);
                const next = list[(idx + 1) % list.length];
                setTheme(next);
              }}
            >
              <span
                className="brr-theme-dot"
                style={{ background: getThemeAccent(theme) }}
              />
              <span>{getThemeLabel(theme).toLowerCase()}</span>
            </button>
            <button
              onClick={() => { setCmdSearch(''); setCmdSelected(0); setCmdPaletteOpen(true); setTimeout(() => cmdInputRef.current?.focus(), 30); }}
              className="brr-nav-item"
              title="Command palette (⌘K)"
              type="button"
            >
              <Search className="w-3 h-3" strokeWidth={1.75} />
              <span>⌘K</span>
            </button>
          </div>
        </nav>

        {/* Page content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {children}
        </div>
      </main>

      {/* ⌘K palette */}
      {cmdPaletteOpen && (
        <div className="brr-cmdk-backdrop" onClick={() => setCmdPaletteOpen(false)}>
          <div className="brr-cmdk" onClick={e => e.stopPropagation()}>
            <div className="brr-cmdk-input-row">
              <Search className="w-3 h-3" style={{ color: 'var(--fg-muted)' }} strokeWidth={1.75} />
              <input
                ref={cmdInputRef}
                value={cmdSearch}
                onChange={e => { setCmdSearch(e.target.value); setCmdSelected(0); }}
                onKeyDown={handleCmdKeyDown}
                placeholder="navigate or search…"
              />
              <span style={{ font: '500 9px var(--font-mono)', color: 'var(--fg-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>esc</span>
            </div>
            <div className="brr-cmdk-list">
              {filteredItems.length === 0 ? (
                <div style={{ padding: '14px', color: 'var(--fg-muted)', fontSize: 11 }}>no results</div>
              ) : filteredItems.map((item, i) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.href + item.label}
                    onClick={() => handleCmdSelect(item.href)}
                    onMouseEnter={() => setCmdSelected(i)}
                    className={`brr-cmdk-item ${i === cmdSelected ? 'is-on' : ''}`}
                    type="button"
                  >
                    <Icon className="w-3 h-3" strokeWidth={1.75} />
                    <span>{item.label}</span>
                    <span className="brr-cmdk-item-hint">{item.hint}</span>
                  </button>
                );
              })}
            </div>
            {!cmdSearch.trim() && (
              <div className="brr-cmdk-shortcuts">
                <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>N</kbd> spawn agent</span>
                <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>K</kbd> kill all</span>
                <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd> fleet</span>
                <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>W</kbd> workspace</span>
                <span><kbd>⌘</kbd><kbd>/</kbd> orchestrator</span>
                <span><kbd>⌘</kbd><kbd>K</kbd> palette</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating orchestrator chat — hidden on surfaces that have their own composer */}
      {pathname !== '/workspace'
        && !pathname.startsWith('/personas/')
        && pathname !== '/planning'
        && pathname !== '/workflows'
        && (
        <FloatingChatDock
          expanded={dockExpanded}
          onExpandedChange={setDockExpanded}
          prCount={prCount}
        />
      )}

      <ToastContainer />
    </div>
  );
}
