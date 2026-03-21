'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Trash2, Terminal, LayoutGrid, ExternalLink, RotateCcw, SquareCode } from 'lucide-react';
import { GitBadge } from '@/components/GitPanel';
import type { Agent } from '@/types';

function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

interface TokenInfo {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface AgentGridProps {
  agents: Agent[];
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onSpawn: () => void;
  onResume: (id: string, task: string) => void;
  agentTokens?: Record<string, TokenInfo>;
  selectedAgentIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const STATUS_COLORS: Record<string, string> = {
  spawning: 'text-amber-400 bg-amber-400',
  running:  'text-emerald-400 bg-emerald-400',
  idle:     'text-blue-400 bg-blue-400',
  done:     'text-zinc-500 bg-zinc-500',
  error:    'text-red-400 bg-red-400',
  killed:   'text-zinc-700 bg-zinc-700',
};

const STATUS_BORDER: Record<string, string> = {
  spawning: 'border-amber-900/60',
  running:  'border-emerald-900/60',
  idle:     'border-blue-900/60',
  done:     'border-zinc-800',
  error:    'border-red-900/60',
  killed:   'border-zinc-800/40',
};

interface LogEntry {
  id: number;
  stream: string;
  content: string;
  timestamp: number;
}

function useAgentLogs(agentId: string, active: boolean, terminalMode: boolean) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const lastIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/agents/${agentId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const newLogs: LogEntry[] = data.logs || [];
        if (!cancelled) {
          setLogs(newLogs);
          if (newLogs.length) lastIdRef.current = newLogs[newLogs.length - 1].id;
        }
      } catch {}
    };

    fetchLogs();
    // Poll only when active or in terminal mode; otherwise one-shot fetch is enough
    if (!active && !terminalMode) return () => { cancelled = true; };
    const interval = setInterval(fetchLogs, active ? 3000 : 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [agentId, active, terminalMode]);

  return logs;
}

function AgentCard({ agent, onKill, onDelete, onResume, tokens, allAgents = [], selected = false, onToggleSelect }: { agent: Agent; onKill: (id: string) => void; onDelete: (id: string) => void; onResume: (id: string, task: string) => void; tokens?: TokenInfo; allAgents?: Agent[]; selected?: boolean; onToggleSelect?: (id: string) => void }) {
  const router = useRouter();
  const [terminalMode, setTerminalMode] = useState(false);
  const [resumeMode, setResumeMode] = useState(false);
  const [resumeTask, setResumeTask] = useState('');
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const isActive = agent.status === 'running' || agent.status === 'spawning';
  const isWorkflow = agent.name.startsWith('wf-');
  const depIds = agent.depends_on ? agent.depends_on.split(',').filter(Boolean) : [];
  const depNames = depIds.map(id => {
    const dep = allAgents.find(a => a.id === id);
    return dep?.name || id.slice(0, 6);
  });
  const statusColor = STATUS_COLORS[agent.status] || 'text-zinc-500 bg-zinc-500';
  const [dotText, dotBg] = statusColor.split(' ');
  const borderColor = STATUS_BORDER[agent.status] || 'border-zinc-800';

  const logs = useAgentLogs(agent.id, isActive, terminalMode);

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (terminalMode && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, terminalMode]);

  const cardHeight = 220;

  return (
    <div
      className={`group relative flex flex-col bg-zinc-900 border rounded-xl overflow-hidden transition-all duration-200 ${
        selected ? 'border-emerald-600' : `${borderColor} hover:border-zinc-600`
      }`}
      style={{ height: cardHeight }}
    >
      {/* Active pulse */}
      {isActive && !terminalMode && (
        <span className="absolute top-3 right-10 flex h-2.5 w-2.5 pointer-events-none">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
        </span>
      )}

      {/* Selection checkbox — visible on hover or when selected */}
      {onToggleSelect && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(agent.id); }}
          className={`absolute top-2 left-2 z-10 w-4 h-4 rounded border flex items-center justify-center transition-all ${
            selected
              ? 'bg-emerald-600 border-emerald-500 opacity-100'
              : 'bg-zinc-800 border-zinc-600 opacity-0 group-hover:opacity-100'
          }`}
          title={selected ? 'Deselect' : 'Select'}
          aria-label={selected ? 'Deselect agent' : 'Select agent'}
        >
          {selected && <span className="text-white text-[8px] leading-none">✓</span>}
        </button>
      )}

      {/* Top controls (always visible) */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 flex-shrink-0">
        {/* Type + status */}
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 ${dotText}`}>
          {agent.type}
        </span>
        {isWorkflow && (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-950 border border-purple-800/50 text-purple-400">
            wf
          </span>
        )}
        <span className={`flex items-center gap-1 text-[10px] font-mono ${dotText}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dotBg} ${isActive ? 'animate-pulse' : ''}`} />
          {agent.status}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Terminal toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); setTerminalMode(m => !m); }}
          className={`p-1 rounded transition-colors ${terminalMode ? 'text-emerald-400 bg-emerald-950/50' : 'text-zinc-600 hover:text-zinc-300'}`}
          title={terminalMode ? 'Show card' : 'Show terminal'}
        >
          {terminalMode ? <LayoutGrid className="w-3.5 h-3.5" /> : <Terminal className="w-3.5 h-3.5" />}
        </button>

        {/* Kill (only for active agents) */}
        {isActive && (
          <button
            onClick={(e) => { e.stopPropagation(); onKill(agent.id); }}
            className="p-1 rounded text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
            title="Kill agent"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Resume + Delete (only for finished agents) */}
        {!isActive && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setResumeMode(m => !m); setTimeout(() => resumeInputRef.current?.focus(), 50); }}
              className={`p-1 rounded transition-colors ${resumeMode ? 'text-emerald-400 bg-emerald-950/50' : 'text-zinc-600 hover:text-zinc-300'}`}
              title="Give new task"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(agent.id); }}
              className="p-1 rounded text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-all"
              title="Remove agent"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Resume input — shown when ↺ is clicked on a finished agent */}
      {resumeMode && !isActive && (
        <div className="mx-2 mb-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <input
            ref={resumeInputRef}
            value={resumeTask}
            onChange={(e) => setResumeTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && resumeTask.trim()) {
                onResume(agent.id, resumeTask.trim());
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
        /* ── TERMINAL MODE ── */
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
                className={
                  log.stream === 'stderr' ? 'text-red-400' :
                  log.stream === 'system' ? 'text-amber-500/80' :
                  'text-zinc-300'
                }
              >
                <span className="text-zinc-700 select-none mr-1.5">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                {log.content}
              </div>
            ))
          )}
          {isActive && (
            <div className="text-emerald-500 mt-1 animate-pulse">▋</div>
          )}
        </div>
      ) : (
        /* ── CARD MODE ── */
        <div
          className="flex-1 flex flex-col px-3 pb-2.5 cursor-pointer min-h-0"
          onClick={() => router.push(`/agents/${agent.id}`)}
        >
          {/* Name + task */}
          <div className="text-sm font-mono font-medium text-zinc-200 truncate mb-0.5">
            {agent.name || agent.id.slice(0, 8)}
          </div>
          <div className="text-[11px] font-mono text-zinc-500 truncate leading-relaxed mb-2" title={agent.task}>
            {agent.task}
          </div>

          {/* Log snippet */}
          <div className="flex-1 bg-black/50 rounded-lg p-2 font-mono text-[10px] text-zinc-600 overflow-hidden">
            {logs.length === 0 ? (
              isActive ? (
                <span className="italic text-zinc-700">waiting for output…</span>
              ) : agent.last_log ? (
                <span className="truncate text-zinc-500 leading-relaxed block">
                  {stripAnsi(agent.last_log)}
                </span>
              ) : agent.task ? (
                <span className="truncate text-zinc-600 leading-relaxed block italic">
                  {agent.task.length > 120 ? agent.task.slice(0, 120) + '…' : agent.task}
                </span>
              ) : (
                <span className="italic text-zinc-700">no logs</span>
              )
            ) : (
              logs.slice(-8).map((log, i) => (
                <div key={log.id} className={`truncate leading-relaxed ${i === logs.slice(-8).length - 1 ? 'text-zinc-400' : ''}`}>
                  {stripAnsi(log.content)}
                </div>
              ))
            )}
          </div>

          {/* Dependencies */}
          {depNames.length > 0 && (
            <div className="flex items-center gap-1 mt-1 flex-shrink-0 flex-wrap">
              <span className="text-[9px] font-mono text-zinc-700">deps:</span>
              {depNames.map((name, i) => (
                <span key={i} className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-500">
                  {name}
                </span>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-1.5 flex-shrink-0">
            <span className="text-[10px] font-mono text-zinc-700">
              {relativeTime(agent.created_at)}
            </span>
            <div className="flex items-center gap-2">
              {agent.repo && <GitBadge agentId={agent.id} />}
              {tokens && tokens.cost_usd > 0 && (
                <span className="text-[10px] font-mono text-emerald-400/70">
                  ${tokens.cost_usd.toFixed(4)}
                </span>
              )}
              {tokens && (tokens.input_tokens > 0 || tokens.output_tokens > 0) && (
                <span className="text-[10px] font-mono text-blue-400/70" title={`in: ${tokens.input_tokens.toLocaleString()} / out: ${tokens.output_tokens.toLocaleString()}`}>
                  {formatTokens(tokens.input_tokens + tokens.output_tokens)} tok
                </span>
              )}
              {agent.repo && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    localStorage.setItem('boardroom:workspace-repo', agent.repo!);
                    window.location.href = '/workspace';
                  }}
                  className="text-[8px] font-mono text-zinc-600 hover:text-blue-400 transition-colors flex items-center gap-0.5"
                  title={`Open ${agent.repo} in workspace`}
                >
                  <SquareCode className="w-3 h-3" />
                </button>
              )}
              <ExternalLink className="w-3 h-3 text-zinc-700 group-hover:text-zinc-500 transition-colors" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SpawnCard({ onSpawn }: { onSpawn: () => void }) {
  return (
    <button
      onClick={onSpawn}
      className="group flex flex-col items-center justify-center bg-zinc-900/50 border border-dashed border-zinc-700 rounded-xl hover:border-emerald-700 hover:bg-zinc-900 transition-all duration-200"
      style={{ height: 220 }}
    >
      <div className="flex items-center justify-center w-10 h-10 rounded-full border border-zinc-700 group-hover:border-emerald-600 transition-colors mb-2">
        <Plus className="w-5 h-5 text-zinc-600 group-hover:text-emerald-400 transition-colors" />
      </div>
      <span className="text-xs font-mono text-zinc-600 group-hover:text-zinc-400 transition-colors">
        spawn agent
      </span>
    </button>
  );
}

export function AgentGrid({ agents, onKill, onDelete, onSpawn, onResume, agentTokens, allAgents, selectedAgentIds, onToggleSelect }: AgentGridProps & { allAgents?: Agent[] }) {
  return (
    <div
      className="grid gap-3 content-start"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
    >
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          onKill={onKill}
          onDelete={onDelete}
          onResume={onResume}
          tokens={agentTokens?.[agent.id]}
          allAgents={allAgents || agents}
          selected={selectedAgentIds?.has(agent.id) ?? false}
          onToggleSelect={onToggleSelect}
        />
      ))}
      <SpawnCard onSpawn={onSpawn} />
    </div>
  );
}
