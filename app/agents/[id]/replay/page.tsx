'use client';

import { useState, useEffect, useCallback, useRef, use } from 'react';
import Link from 'next/link';
import { FileText, Terminal, Brain, Cog, Play, Pause, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import type { Agent, Log } from '@/types';

interface AgentPageProps {
  params: Promise<{ id: string }>;
}

type EventType = 'file_read' | 'file_edit' | 'command' | 'thinking' | 'system';

interface TimelineEvent {
  index: number;
  type: EventType;
  relativeMs: number;
  content: string;
  raw: Log;
}

function classifyEvent(log: Log): EventType {
  const c = log.content;
  if (log.stream === 'system') return 'system';
  if (/\b(Read|cat)\b/.test(c)) return 'file_read';
  if (/\b(Edit|Write)\b/.test(c)) return 'file_edit';
  if (/\b(Bash|shell|command|Running|npm|npx|git )\b/.test(c)) return 'command';
  return 'thinking';
}

const EVENT_ICON: Record<EventType, React.ReactNode> = {
  file_read: <FileText className="w-3.5 h-3.5 text-blue-400" />,
  file_edit: <FileText className="w-3.5 h-3.5 text-amber-400" />,
  command: <Terminal className="w-3.5 h-3.5 text-emerald-400" />,
  thinking: <Brain className="w-3.5 h-3.5 text-zinc-500" />,
  system: <Cog className="w-3.5 h-3.5 text-zinc-600" />,
};

const EVENT_COLOR: Record<EventType, string> = {
  file_read: 'border-blue-500/30 bg-blue-500/5',
  file_edit: 'border-amber-500/30 bg-amber-500/5',
  command: 'border-emerald-500/30 bg-emerald-500/5',
  thinking: 'border-zinc-700 bg-zinc-900/20',
  system: 'border-zinc-800 bg-zinc-950/30',
};

const EVENT_LABEL: Record<EventType, string> = {
  file_read: 'read',
  file_edit: 'edit',
  command: 'cmd',
  thinking: 'think',
  system: 'sys',
};

const EVENT_LABEL_COLOR: Record<EventType, string> = {
  file_read: 'text-blue-400',
  file_edit: 'text-amber-400',
  command: 'text-emerald-400',
  thinking: 'text-zinc-500',
  system: 'text-zinc-600',
};

function formatRelTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem}s`;
}

function TimelineRow({ event, visible }: { event: TimelineEvent; visible: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lines = event.content.split('\n').filter(Boolean);
  const preview = lines.slice(0, 2).join('\n');
  const hasMore = lines.length > 2;

  return (
    <div
      className={`transition-all duration-200 ${visible ? 'opacity-100' : 'opacity-20 pointer-events-none'}`}
    >
      <div className={`flex gap-3 rounded-lg border px-3 py-2 ${EVENT_COLOR[event.type]}`}>
        {/* Time */}
        <div className="w-14 flex-shrink-0 pt-0.5">
          <span className="font-mono text-[10px] text-zinc-600">{formatRelTime(event.relativeMs)}</span>
        </div>
        {/* Icon + label */}
        <div className="flex flex-col items-center gap-1 w-10 flex-shrink-0 pt-0.5">
          {EVENT_ICON[event.type]}
          <span className={`font-mono text-[9px] uppercase tracking-wider ${EVENT_LABEL_COLOR[event.type]}`}>
            {EVENT_LABEL[event.type]}
          </span>
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0">
          <pre
            className="font-mono text-[11px] text-zinc-300 whitespace-pre-wrap break-words leading-relaxed"
            style={{ maxHeight: expanded ? 'none' : undefined }}
          >
            {expanded ? event.content : preview}
          </pre>
          {hasMore && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 mt-1 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {expanded ? 'collapse' : `+${lines.length - 2} more lines`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReplayPage({ params }: AgentPageProps) {
  const { id } = use(params);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrubPos, setScrubPos] = useState(100);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setAgent(data.agent);
      const logs: Log[] = data.logs || [];
      if (logs.length === 0) { setLoading(false); return; }

      const startTs = logs[0].timestamp;
      const built: TimelineEvent[] = logs.map((log, i) => ({
        index: i,
        type: classifyEvent(log),
        relativeMs: log.timestamp - startTs,
        content: log.content,
        raw: log,
      }));
      setEvents(built);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-play: advance scrubber every 500ms
  useEffect(() => {
    if (playing) {
      playRef.current = setInterval(() => {
        setScrubPos(p => {
          if (p >= 100) { setPlaying(false); return 100; }
          return Math.min(100, p + (100 / Math.max(events.length, 1)));
        });
      }, 500);
    } else {
      if (playRef.current) clearInterval(playRef.current);
    }
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [playing, events.length]);

  const visibleCount = Math.ceil((scrubPos / 100) * events.length);
  const visibleEvents = events.slice(0, visibleCount);

  // Stats
  const totalDurationMs = events.length > 0 ? events[events.length - 1].relativeMs : 0;
  const filesRead = events.filter(e => e.type === 'file_read').length;
  const filesEdited = events.filter(e => e.type === 'file_edit').length;
  const commands = events.filter(e => e.type === 'command').length;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-zinc-600 font-mono text-sm animate-pulse">loading replay...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto pl-20 pr-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/agents/${id}`} className="text-zinc-600 hover:text-zinc-400 font-mono text-sm transition-colors">
              ← agent
            </Link>
            <span className="text-zinc-700">/</span>
            <span className="font-mono text-sm text-zinc-300">{agent?.name || id}</span>
            {agent && <StatusBadge status={agent.status} />}
            <span className="font-mono text-xs text-zinc-600">replay</span>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto w-full px-6 py-6 flex flex-col gap-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'duration', value: formatRelTime(totalDurationMs) },
            { label: 'files read', value: String(filesRead) },
            { label: 'files edited', value: String(filesEdited) },
            { label: 'commands', value: String(commands) },
          ].map(stat => (
            <div key={stat.label} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
              <div className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-1">{stat.label}</div>
              <div className="font-mono text-lg text-zinc-200">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Scrubber */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex items-center gap-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (scrubPos >= 100) { setScrubPos(0); setPlaying(true); }
              else setPlaying(p => !p);
            }}
            className="font-mono text-xs border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 flex-shrink-0"
          >
            {playing ? <Pause className="w-3 h-3 mr-1.5" /> : <Play className="w-3 h-3 mr-1.5" />}
            {playing ? 'pause' : scrubPos >= 100 ? 'replay' : 'play'}
          </Button>
          <input
            type="range"
            min={0}
            max={100}
            value={scrubPos}
            onChange={e => { setPlaying(false); setScrubPos(Number(e.target.value)); }}
            className="flex-1 accent-emerald-500"
          />
          <span className="font-mono text-xs text-zinc-500 w-24 text-right">
            {visibleCount} / {events.length} events
          </span>
        </div>

        {/* Timeline */}
        {events.length === 0 ? (
          <div className="py-16 text-center font-mono text-sm text-zinc-600">no log events to replay</div>
        ) : (
          <div className="space-y-2">
            {events.map((event, i) => (
              <TimelineRow key={event.index} event={event} visible={i < visibleCount} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
