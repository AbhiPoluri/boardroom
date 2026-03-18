'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Search } from 'lucide-react';
import type { Log, LogStream } from '@/types';

interface LogViewerProps {
  agentId: string;
  initialLogs?: Log[];
  agentStatus?: string;
  summary?: string | null;
  agentTask?: string;
}

const streamColors: Record<LogStream, string> = {
  stdout: 'text-zinc-100',
  stderr: 'text-red-400',
  system: 'text-amber-400',
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23);
}

export function LogViewer({ agentId, initialLogs = [], agentStatus, summary, agentTask }: LogViewerProps) {
  const [logs, setLogs] = useState<Log[]>(initialLogs);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const esRef = useRef<EventSource | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isTerminal = ['done', 'error', 'killed'].includes(agentStatus || '');

  useEffect(() => {
    // Don't connect SSE for completed agents
    if (isTerminal) return;

    let es: EventSource;

    const connect = () => {
      es = new EventSource(`/api/stream/${agentId}`);
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'initial') {
            setLogs(msg.logs);
          } else if (msg.type === 'log') {
            setLogs((prev) => {
              // Deduplicate by id
              if (prev.some((l) => l.id === msg.log.id)) return prev;
              return [...prev, msg.log];
            });
          }
          // status events don't need UI updates here - the parent polls
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Reconnect after 3s
        setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      es?.close();
      esRef.current = null;
    };
  }, [agentId, isTerminal]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-500">logs</span>
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
            }`}
          />
          <span className="text-xs font-mono text-zinc-600">
            {isTerminal ? 'agent completed' : connected ? 'live' : 'reconnecting...'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Search className="w-3 h-3 text-zinc-600 flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="search logs... (⌘f)"
            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-zinc-700"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-zinc-600 hover:text-zinc-400 transition-colors flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-600">
            {searchQuery
              ? `${logs.filter(l => l.content.toLowerCase().includes(searchQuery.toLowerCase())).length} / ${logs.length}`
              : `${logs.length} lines`}
          </span>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${
              autoScroll
                ? 'border-emerald-800 text-emerald-400 bg-emerald-950/30'
                : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
            }`}
          >
            {autoScroll ? 'auto-scroll on' : 'auto-scroll off'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-950/30 border-b border-red-900 text-xs text-red-400 font-mono">
          {error}
        </div>
      )}

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-zinc-950 font-mono text-xs p-3 space-y-0.5"
        style={{ minHeight: 0 }}
      >
        {logs.length === 0 ? (
          isTerminal ? (
            <div className="space-y-3">
              {agentTask && (
                <div>
                  <div className="text-zinc-600 uppercase tracking-wider text-[10px] mb-1">Task</div>
                  <div className="text-zinc-300">{agentTask}</div>
                </div>
              )}
              {summary ? (
                <div>
                  <div className="text-zinc-600 uppercase tracking-wider text-[10px] mb-1">Summary</div>
                  <div className="text-zinc-300 whitespace-pre-wrap">{summary}</div>
                </div>
              ) : (
                <div className="text-zinc-600 italic">no logs recorded</div>
              )}
            </div>
          ) : (
            <div className="text-zinc-600 italic">waiting for output...</div>
          )
        ) : (
          logs
            .filter(log => !searchQuery || log.content.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((log) => (
              <div key={log.id} className="flex gap-3 leading-5 group">
                <span className="text-zinc-700 shrink-0 select-none">
                  {formatTimestamp(log.timestamp)}
                </span>
                <span className={`shrink-0 w-12 text-right ${streamColors[log.stream]}/50`}>
                  [{log.stream}]
                </span>
                <span className={`${streamColors[log.stream]} break-all whitespace-pre-wrap`}>
                  {log.content}
                </span>
              </div>
            ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
