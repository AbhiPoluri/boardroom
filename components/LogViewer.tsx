'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Log, LogStream } from '@/types';

interface LogViewerProps {
  agentId: string;
  initialLogs?: Log[];
}

const streamColors: Record<LogStream, string> = {
  stdout: 'text-zinc-100',
  stderr: 'text-red-400',
  system: 'text-amber-400',
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23);
}

export function LogViewer({ agentId, initialLogs = [] }: LogViewerProps) {
  const [logs, setLogs] = useState<Log[]>(initialLogs);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const esRef = useRef<EventSource | null>(null);

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
  }, [agentId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-500">logs</span>
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
            }`}
          />
          <span className="text-xs font-mono text-zinc-600">
            {connected ? 'live' : 'reconnecting...'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-600">{logs.length} lines</span>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-xs font-mono px-2 py-0.5 rounded border ${
              autoScroll
                ? 'border-emerald-800 text-emerald-400 bg-emerald-950/30'
                : 'border-zinc-800 text-zinc-500'
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
          <div className="text-zinc-600 italic">waiting for output...</div>
        ) : (
          logs.map((log) => (
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
