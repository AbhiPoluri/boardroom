'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Terminal, LayoutGrid, X, Trash2, RotateCcw, AlertCircle } from 'lucide-react';
import type { Agent } from '@/types';

interface TokenInfo {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface AgentCardProps {
  agent: Agent;
  onKill?: (id: string) => void;
  onDelete?: (id: string) => void;
  onResume?: (id: string, task: string) => void;
  tokens?: TokenInfo;
  allAgents?: Agent[];
}

// Strip ANSI escape codes and common TUI/spinner garbage
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

// Filter lines that are just spinners, progress bars, or whitespace
const SKIP_PATTERNS = [
  /^[\s\-_=|/\\⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏▁▂▃▄▅▆▇█░▒▓⠿●○◆◇▶▷◀◁·•*+\[\](){}⚙✓✗✘→←↑↓⇒]+$/,
  /^\s*$/,
  /^[\s]*(⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)/,
  /^\s*\[[\s#=>\-]*\]\s*\d*%?\s*$/,
];

function isMeaningfulLine(line: string): boolean {
  const stripped = stripAnsi(line).trim();
  if (!stripped) return false;
  for (const p of SKIP_PATTERNS) {
    if (p.test(stripped)) return false;
  }
  return true;
}

function truncateLine(line: string, maxLen = 72): string {
  const s = stripAnsi(line).trim();
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatElapsed(startMs: number): string {
  const secs = Math.floor((Date.now() - startMs) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function formatTimeAgo(tsMs: number): string {
  const secs = Math.floor((Date.now() - tsMs) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

interface LogEntry {
  id: number;
  stream: string;
  content: string;
  timestamp: number;
}

// Inline status dot component
function StatusDot({ status }: { status: string }) {
  const configs: Record<string, { color: string; pulse?: boolean; label: string }> = {
    running:  { color: 'bg-emerald-400', pulse: true,  label: 'running' },
    spawning: { color: 'bg-emerald-400', pulse: true,  label: 'spawning' },
    idle:     { color: 'bg-amber-400',   pulse: false, label: 'idle' },
    done:     { color: 'bg-zinc-500',    pulse: false, label: 'done' },
    error:    { color: 'bg-red-400',     pulse: false, label: 'error' },
    killed:   { color: 'bg-zinc-700',    pulse: false, label: 'killed' },
  };
  const cfg = configs[status] || configs.idle;
  return (
    <span className={`flex items-center gap-1 text-[10px] font-mono text-${status === 'running' || status === 'spawning' ? 'emerald' : status === 'idle' ? 'amber' : status === 'error' ? 'red' : 'zinc'}-400`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.color} ${cfg.pulse ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  );
}

export function AgentCard({ agent, onKill, onDelete, onResume, tokens, allAgents = [] }: AgentCardProps) {
  const router = useRouter();
  const [terminalMode, setTerminalMode] = useState(false);
  const [resumeMode, setResumeMode] = useState(false);
  const [resumeTask, setResumeTask] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [elapsed, setElapsed] = useState('');
  const [timeAgo, setTimeAgo] = useState('');
  const [branch, setBranch] = useState<string | null>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  const isActive = agent.status === 'running' || agent.status === 'spawning';
  const isWorkflow = agent.name.startsWith('wf-');
  const depIds = agent.depends_on ? agent.depends_on.split(',').filter(Boolean) : [];
  const depNames = depIds.map(id => {
    const dep = allAgents.find(a => a.id === id);
    return dep?.name || id.slice(0, 6);
  });
  const blockedBy = depIds.length > 0 ? allAgents.filter(a => depIds.includes(a.id) && ['running', 'spawning'].includes(a.status)) : [];

  // Live time counters
  useEffect(() => {
    const update = () => {
      setTimeAgo(formatTimeAgo(agent.created_at));
      if (isActive) setElapsed(formatElapsed(agent.created_at));
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [agent.created_at, isActive]);

  // Log polling
  useEffect(() => {
    let cancelled = false;

    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/agents/${agent.id}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setLogs(data.logs || []);
        }
      } catch {}
    };

    fetchLogs();
    if (!isActive && !terminalMode) return () => { cancelled = true; };
    const iv = setInterval(fetchLogs, isActive ? 3000 : 10000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [agent.id, isActive, terminalMode]);

  // Fetch git branch
  useEffect(() => {
    if (!agent.repo) return;
    fetch(`/api/agents/${agent.id}/git`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.branch) setBranch(data.branch);
      })
      .catch(() => {});
  }, [agent.id, agent.repo]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalMode && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, terminalMode]);

  // Compute preview lines (card mode)
  const previewLines = (() => {
    const stdoutLogs = logs.filter(l => l.stream === 'stdout' || l.stream === 'stderr');
    const meaningful = stdoutLogs
      .slice(-30)
      .map(l => truncateLine(l.content))
      .filter(isMeaningfulLine);
    return meaningful.slice(-4);
  })();

  const totalTokens = tokens ? tokens.input_tokens + tokens.output_tokens : 0;

  // Border accent by status
  const borderAccent: Record<string, string> = {
    running:  'border-emerald-900/60',
    spawning: 'border-emerald-900/40',
    idle:     'border-amber-900/40',
    done:     'border-zinc-800',
    error:    'border-red-900/60',
    killed:   'border-zinc-800/40',
  };

  return (
    <>
      {/* Slide animation keyframe injected once */}
      <style>{`
        @keyframes slide {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
          100% { transform: translateX(200%); }
        }
      `}</style>

      <div
        className={`group relative flex flex-col bg-zinc-900/80 border ${borderAccent[agent.status] || 'border-zinc-800'} rounded-xl overflow-hidden transition-all duration-200 hover:bg-zinc-900 hover:border-zinc-600 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30`}
        style={{ height: 220 }}
      >
        {/* Running progress bar */}
        {isActive && !terminalMode && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-emerald-500/20 overflow-hidden">
            <div
              className="h-full w-1/3 bg-emerald-400/70"
              style={{ animation: 'slide 2s ease-in-out infinite' }}
            />
          </div>
        )}

        {/* Header row */}
        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 flex-shrink-0">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
            {agent.type}
          </span>

          {isWorkflow && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-950 border border-purple-800/50 text-purple-400">
              wf
            </span>
          )}

          <StatusDot status={agent.status} />

          {agent.status === 'error' && (
            <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
          )}

          <div className="flex-1" />

          {/* Terminal toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); setTerminalMode(m => !m); }}
            className={`p-1 rounded transition-colors ${terminalMode ? 'text-emerald-400 bg-emerald-950/50' : 'text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100'}`}
            title={terminalMode ? 'Card view' : 'Terminal view'}
          >
            {terminalMode ? <LayoutGrid className="w-3.5 h-3.5" /> : <Terminal className="w-3.5 h-3.5" />}
          </button>

          {/* Kill (active only) */}
          {isActive && (
            <button
              onClick={(e) => { e.stopPropagation(); onKill?.(agent.id); }}
              className="p-1 rounded text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
              title="Kill agent"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Resume + Delete (finished agents) */}
          {!isActive && (
            <>
              {onResume && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setResumeMode(m => !m);
                    setTimeout(() => resumeInputRef.current?.focus(), 50);
                  }}
                  className={`p-1 rounded transition-colors ${resumeMode ? 'text-emerald-400 bg-emerald-950/50' : 'text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100'}`}
                  title="Resume with new task"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(agent.id); }}
                  className="p-1 rounded text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-all"
                  title="Remove agent"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* Resume input */}
        {resumeMode && !isActive && (
          <div className="mx-2 mb-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={resumeInputRef}
              value={resumeTask}
              onChange={(e) => setResumeTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && resumeTask.trim()) {
                  onResume?.(agent.id, resumeTask.trim());
                  setResumeTask('');
                  setResumeMode(false);
                } else if (e.key === 'Escape') {
                  setResumeMode(false);
                }
              }}
              placeholder="new task… (enter to run)"
              className="w-full bg-zinc-800 border border-emerald-800/60 rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-600"
            />
          </div>
        )}

        {terminalMode ? (
          /* Terminal mode — full scrollable log */
          <div
            ref={terminalRef}
            className="flex-1 mx-2 mb-2 bg-black rounded-lg overflow-y-auto p-2 font-mono text-[10px] leading-relaxed"
            onClick={(e) => e.stopPropagation()}
          >
            {logs.length === 0 ? (
              <span className="text-zinc-700 italic">no output yet…</span>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className={`break-words ${
                    log.stream === 'stderr' ? 'text-red-400' :
                    log.stream === 'system' ? 'text-amber-500/80' :
                    'text-zinc-300'
                  }`}
                >
                  <span className="text-zinc-700 select-none mr-1.5">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  {stripAnsi(log.content)}
                </div>
              ))
            )}
            {isActive && (
              <div className="text-emerald-500 mt-1 animate-pulse">▋</div>
            )}
          </div>
        ) : (
          /* Card mode */
          <div
            className="flex-1 flex flex-col px-3 pb-0 cursor-pointer min-h-0"
            onClick={() => router.push(`/agents/${agent.id}`)}
          >
            {/* Name + task */}
            <div className="text-sm font-mono font-semibold text-zinc-200 truncate mb-0.5">
              {agent.name || agent.id.slice(0, 8)}
            </div>
            <div className="text-[11px] font-mono text-zinc-500 line-clamp-2 leading-relaxed mb-1.5">
              {agent.task}
            </div>

            {/* Preview block */}
            <div className="flex-1 bg-zinc-950 border border-zinc-800/50 rounded-lg p-2 font-mono text-[10px] leading-relaxed overflow-hidden min-h-[52px]">
              {previewLines.length === 0 ? (
                <span className="italic text-zinc-700">
                  {isActive ? 'waiting for output…' : 'no logs'}
                </span>
              ) : (
                previewLines.map((line, i) => (
                  <div
                    key={i}
                    className={`truncate ${i === previewLines.length - 1 ? 'text-zinc-400' : 'text-zinc-600'}`}
                  >
                    {line}
                  </div>
                ))
              )}
              {isActive && previewLines.length > 0 && (
                <span className="text-emerald-500 animate-pulse">▋</span>
              )}
            </div>

            {/* Dependencies row */}
            {depNames.length > 0 && (
              <div className="flex items-center gap-1 mt-1 flex-shrink-0">
                <span className="text-[9px] font-mono text-zinc-700">deps:</span>
                {depNames.map((name, i) => (
                  <span key={i} className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                    blockedBy.some(a => a.name === name || a.id.startsWith(name))
                      ? 'bg-amber-950 text-amber-400 border border-amber-800/40'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {name}
                  </span>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between mt-1.5 pb-2 flex-shrink-0">
              <span className="text-[10px] font-mono text-zinc-700">{timeAgo}</span>
              <div className="flex items-center gap-2.5">
                {branch && (
                  <span className="text-[10px] font-mono text-purple-400/60 truncate max-w-[80px]" title={branch}>
                    ↗ {branch}
                  </span>
                )}
                {tokens && tokens.cost_usd > 0 && (
                  <span className="text-[10px] font-mono text-emerald-400/70">
                    ${tokens.cost_usd.toFixed(4)}
                  </span>
                )}
                {totalTokens > 0 && (
                  <span
                    className="text-[10px] font-mono text-blue-400/70"
                    title={`in: ${tokens!.input_tokens.toLocaleString()} / out: ${tokens!.output_tokens.toLocaleString()}`}
                  >
                    {formatTokens(totalTokens)} tok
                  </span>
                )}
                {isActive && elapsed && (
                  <span className="text-[10px] font-mono text-emerald-400">{elapsed}</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
