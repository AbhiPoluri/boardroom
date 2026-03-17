'use client';

import React, { useState, useEffect, useRef } from 'react';

interface LogEntry {
  id?: string | number;
  timestamp: number;
  agent_name?: string;
  stream: string;
  content: string;
}

interface Props {
  limit?: number;
}

const streamColor: Record<string, string> = {
  stdout: 'text-zinc-400',
  stderr: 'text-red-400',
  system: 'text-blue-400',
};

const AGENT_COLORS = [
  'text-purple-400',
  'text-emerald-400',
  'text-amber-400',
  'text-cyan-400',
  'text-pink-400',
  'text-indigo-400',
];

function getAgentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return AGENT_COLORS[hash % AGENT_COLORS.length];
}

export default function OrchestratorLogs({ limit = 50 }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLogs = () => {
      fetch(`/api/orchestrator-logs?limit=${limit}`)
        .then(r => r.json())
        .then(d => setLogs(d.logs || []))
        .catch(() => {});
    };
    fetchLogs();
    const iv = setInterval(fetchLogs, 15000);
    return () => clearInterval(iv);
  }, [limit]);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="max-h-[300px] overflow-y-auto font-mono text-xs space-y-0 p-2 bg-zinc-950 rounded-lg">
      {logs.length === 0 && (
        <div className="text-zinc-600 text-center py-4 text-[11px]">no logs yet</div>
      )}
      {logs.map((log, i) => (
        <div key={log.id ?? i} className="flex gap-2 hover:bg-zinc-800/50 px-1 py-0.5 rounded items-baseline">
          <span className="text-zinc-700 flex-shrink-0 w-[68px] text-[10px]">
            {new Date(log.timestamp).toLocaleTimeString('en-US', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
          {log.agent_name && (
            <span className={`flex-shrink-0 max-w-[90px] truncate text-[10px] ${getAgentColor(log.agent_name)}`}>
              {log.agent_name}
            </span>
          )}
          <span className={`${streamColor[log.stream] || 'text-zinc-400'} break-all leading-relaxed text-[11px]`}>
            {log.content}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
