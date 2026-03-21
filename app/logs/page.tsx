'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { SubNav } from '@/components/SubNav';
import {
  RefreshCw, Download, ChevronsDown,
  Search, X, Filter, ScrollText,
} from 'lucide-react';

interface LogEntry {
  id: string | number;
  timestamp: number;
  agent_name?: string;
  agent_id?: string;
  stream: string;
  content: string;
}

interface LogStats {
  total: number;
  by_stream: Record<string, number>;
  top_agents: Array<{ name: string; count: number }>;
}

interface SearchResult {
  id: number;
  agent_id: string;
  agent_name: string;
  timestamp: number;
  stream: string;
  content: string;
}

const STREAM_COLORS: Record<string, { badge: string; text: string; dot: string }> = {
  stdout: { badge: 'bg-zinc-800 border-zinc-700 text-zinc-400', text: 'text-zinc-300', dot: 'bg-zinc-400' },
  stderr: { badge: 'bg-red-950 border-red-900 text-red-400', text: 'text-red-300', dot: 'bg-red-400' },
  system: { badge: 'bg-blue-950 border-blue-900 text-blue-400', text: 'text-blue-300', dot: 'bg-blue-400' },
};

const AGENT_COLORS = [
  'text-purple-400', 'text-emerald-400', 'text-amber-400',
  'text-cyan-400', 'text-pink-400', 'text-indigo-400',
];

const AGENT_BG_COLORS = [
  'bg-purple-950 border-purple-800', 'bg-emerald-950 border-emerald-800',
  'bg-amber-950 border-amber-800', 'bg-cyan-950 border-cyan-800',
  'bg-pink-950 border-pink-800', 'bg-indigo-950 border-indigo-800',
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return hash;
}

function getAgentColor(name: string): string {
  return AGENT_COLORS[hashName(name) % AGENT_COLORS.length];
}

function getAgentBadge(name: string): string {
  const idx = hashName(name) % AGENT_BG_COLORS.length;
  return `${AGENT_COLORS[idx]} ${AGENT_BG_COLORS[idx]}`;
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function formatShortTs(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

type ViewMode = 'live' | 'search';

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [streamFilter, setStreamFilter] = useState<string>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('live');

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const [logsRes, statsRes] = await Promise.all([
        fetch('/api/orchestrator-logs?limit=500'),
        fetch('/api/orchestrator-logs?stats=1'),
      ]);
      const logsData = await logsRes.json();
      const statsData = await statsRes.json();
      setLogs(logsData.logs || []);
      setStats(statsData.stats || null);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh || viewMode !== 'live') return;
    const iv = setInterval(fetchLogs, 5000);
    return () => clearInterval(iv);
  }, [autoRefresh, fetchLogs, viewMode]);

  useEffect(() => {
    if (autoScroll && bottomRef.current && viewMode === 'live') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, viewMode]);

  // Keyboard shortcut: / to focus search, Escape to clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        setViewMode('search');
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') {
        if (viewMode === 'search') {
          setViewMode('live');
          setSearchQuery('');
          setSearchResults([]);
          setSearched(false);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewMode]);

  const allAgents = Array.from(new Set(logs.map(l => l.agent_name).filter(Boolean))) as string[];

  const filtered = logs.filter(log => {
    if (streamFilter !== 'all' && log.stream !== streamFilter) return false;
    if (agentFilter !== 'all' && log.agent_name !== agentFilter) return false;
    return true;
  });

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results || []);
      setSearched(true);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const exportLogs = () => {
    const entries = viewMode === 'search' && searched ? searchResults : filtered;
    const lines = entries.map(l =>
      `[${formatTs(l.timestamp)}] [${l.stream}]${l.agent_name ? ` [${l.agent_name}]` : ''} ${l.content}`
    ).join('\n');
    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boardroom-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderLogRow = (log: LogEntry | SearchResult, i: number) => {
    const s = STREAM_COLORS[log.stream] || STREAM_COLORS.stdout;
    return (
      <div
        key={('id' in log ? log.id : undefined) ?? i}
        className="flex items-start gap-3 px-4 py-1 hover:bg-zinc-900/60 group border-b border-zinc-900/30 last:border-0"
      >
        {/* Timestamp */}
        <span className="text-zinc-700 flex-shrink-0 w-[90px] text-[11px] font-mono pt-0.5 select-none">
          {formatTs(log.timestamp)}
        </span>
        {/* Stream dot */}
        <span className={`mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} title={log.stream} />
        {/* Agent name */}
        {log.agent_name ? (
          <Link
            href={`/agents/${'agent_id' in log ? log.agent_id : ''}`}
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 max-w-[120px] truncate hover:brightness-125 transition-all ${getAgentBadge(log.agent_name)}`}
          >
            {log.agent_name}
          </Link>
        ) : (
          <span className="flex-shrink-0 w-[120px]" />
        )}
        {/* Content */}
        <span className={`${s.text} break-all leading-relaxed text-[11px] font-mono flex-1`}>
          {log.content}
        </span>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <SubNav tabs={[{ label: 'agents', href: '/', active: false }, { label: 'logs', href: '/logs', active: true }]} />
          <h1 className="font-mono text-sm text-zinc-100">logs</h1>
          {stats && (
            <span className="text-[10px] font-mono text-zinc-600">{stats.total.toLocaleString()} total</span>
          )}
        </div>

        {/* View mode tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
          <button
            onClick={() => { setViewMode('live'); setSearched(false); setSearchResults([]); }}
            className={`px-3 py-1 rounded text-[11px] font-mono transition-colors ${
              viewMode === 'live'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            live
          </button>
          <button
            onClick={() => { setViewMode('search'); setTimeout(() => searchInputRef.current?.focus(), 50); }}
            className={`px-3 py-1 rounded text-[11px] font-mono transition-colors flex items-center gap-1.5 ${
              viewMode === 'search'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Search className="w-3 h-3" />
            search
          </button>
        </div>

        <div className="flex items-center gap-2">
          {viewMode === 'live' && (
            <button
              onClick={() => setAutoRefresh(r => !r)}
              className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                autoRefresh
                  ? 'bg-emerald-950 border-emerald-800 text-emerald-400'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
              {autoRefresh ? 'live' : 'paused'}
            </button>
          )}
          <button
            onClick={exportLogs}
            className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Download className="w-3 h-3" />
            export
          </button>
        </div>
      </div>

      {/* Filter / Search bar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-zinc-800/60 bg-zinc-950/40">
        {viewMode === 'live' ? (
          <>
            {/* Stream filter chips */}
            <div className="flex items-center gap-1">
              <Filter className="w-3 h-3 text-zinc-700 mr-1" />
              {['all', 'stdout', 'stderr', 'system'].map((s) => {
                const active = streamFilter === s;
                const sc = STREAM_COLORS[s];
                return (
                  <button
                    key={s}
                    onClick={() => setStreamFilter(s)}
                    className={`text-[10px] font-mono px-2 py-1 rounded-full transition-colors ${
                      active
                        ? s === 'all'
                          ? 'bg-zinc-700 text-zinc-200'
                          : `${sc?.badge || 'bg-zinc-700 text-zinc-200'}`
                        : 'text-zinc-600 hover:text-zinc-400'
                    }`}
                  >
                    {s === 'all' ? 'all' : s}
                    {s !== 'all' && stats?.by_stream?.[s] !== undefined && (
                      <span className="ml-1 text-zinc-600">{stats.by_stream[s]}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Divider */}
            <div className="w-px h-4 bg-zinc-800" />

            {/* Agent filter */}
            {allAgents.length > 0 && (
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="font-mono text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400 rounded px-2 py-1 focus:outline-none focus:border-zinc-600"
              >
                <option value="all">all agents</option>
                {allAgents.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            )}

            {/* Quick search (filters live logs inline) */}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] font-mono text-zinc-700">
                {filtered.length === logs.length ? `${logs.length}` : `${filtered.length}/${logs.length}`} entries
              </span>
              <span className="text-[10px] font-mono text-zinc-800">press / to search</span>
            </div>
          </>
        ) : (
          /* Search mode */
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="search across all agent logs..."
                className="w-full pl-8 pr-8 py-1.5 font-mono text-xs bg-zinc-900 border border-zinc-700 text-zinc-200 rounded-lg focus:outline-none focus:border-zinc-500 placeholder:text-zinc-600"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setSearchResults([]); setSearched(false); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={handleSearch}
              disabled={searchQuery.trim().length < 2 || searching}
              className="px-3 py-1.5 text-xs font-mono rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white transition-colors"
            >
              {searching ? 'searching...' : 'search'}
            </button>
            <div className="ml-auto flex items-center gap-2">
              {searched && (
                <span className="text-[10px] font-mono text-zinc-500">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                </span>
              )}
              <span className="text-[10px] font-mono text-zinc-800">esc to go back</span>
            </div>
          </div>
        )}
      </div>

      {/* Stats bar (live mode only) */}
      {viewMode === 'live' && stats && stats.top_agents?.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 border-b border-zinc-800/40 bg-zinc-950/30">
          <span className="text-[10px] font-mono text-zinc-700">top agents:</span>
          {stats.top_agents.slice(0, 5).map((a) => (
            <button
              key={a.name}
              onClick={() => setAgentFilter(agentFilter === a.name ? 'all' : a.name)}
              className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                agentFilter === a.name
                  ? getAgentBadge(a.name)
                  : 'border-transparent text-zinc-600 hover:text-zinc-400'
              }`}
            >
              <span className={getAgentColor(a.name)}>{a.name}</span>
              <span className="text-zinc-700">{a.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Log list */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'live' ? (
          loading ? (
            <div className="flex items-center justify-center h-full">
              <span className="font-mono text-sm text-zinc-700 animate-pulse">loading logs...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <ScrollText className="w-10 h-10 text-zinc-800 mb-4" />
              <p className="font-mono text-sm text-zinc-600">no logs yet</p>
              <p className="font-mono text-xs text-zinc-700 mt-1">logs appear here when agents run</p>
            </div>
          ) : (
            <div className="py-1">
              {filtered.map((log, i) => renderLogRow(log, i))}
              <div ref={bottomRef} />
            </div>
          )
        ) : (
          /* Search results */
          !searched ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <Search className="w-10 h-10 text-zinc-800 mb-4" />
              <p className="font-mono text-sm text-zinc-600">search across all agent logs</p>
              <p className="font-mono text-xs text-zinc-700 mt-1">enter a query and hit enter or click search</p>
            </div>
          ) : searching ? (
            <div className="flex items-center justify-center h-full">
              <span className="font-mono text-sm text-zinc-700 animate-pulse">searching...</span>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <Search className="w-10 h-10 text-zinc-800 mb-4" />
              <p className="font-mono text-sm text-zinc-600">no results</p>
              <p className="font-mono text-xs text-zinc-700 mt-1">try a different query</p>
            </div>
          ) : (
            <div className="py-1">
              {searchResults.map((r, i) => (
                <div
                  key={r.id ?? i}
                  className="flex items-start gap-3 px-4 py-1.5 hover:bg-zinc-900/60 group border-b border-zinc-900/30 last:border-0"
                >
                  <span className="text-zinc-700 flex-shrink-0 w-[90px] text-[11px] font-mono pt-0.5 select-none">
                    {formatTs(r.timestamp)}
                  </span>
                  <span className={`mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0 ${STREAM_COLORS[r.stream]?.dot || 'bg-zinc-400'}`} title={r.stream} />
                  {r.agent_name ? (
                    <Link
                      href={`/agents/${r.agent_id}`}
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 max-w-[120px] truncate hover:brightness-125 transition-all ${getAgentBadge(r.agent_name)}`}
                    >
                      {r.agent_name}
                    </Link>
                  ) : (
                    <span className="flex-shrink-0 w-[120px]" />
                  )}
                  <span className={`${STREAM_COLORS[r.stream]?.text || 'text-zinc-300'} break-all leading-relaxed text-[11px] font-mono flex-1`}>
                    {r.content}
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-zinc-800/60 bg-zinc-950/50">
        <span className="text-[10px] font-mono text-zinc-700">
          {viewMode === 'live'
            ? autoRefresh ? 'refreshing every 5s' : 'refresh paused'
            : searched ? `${searchResults.length} results` : 'ready to search'
          }
        </span>
        {viewMode === 'live' && (
          <button
            onClick={() => {
              setAutoScroll(a => !a);
              if (!autoScroll && bottomRef.current) {
                bottomRef.current.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
              autoScroll
                ? 'bg-zinc-800 border-zinc-600 text-zinc-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-600 hover:text-zinc-400'
            }`}
          >
            <ChevronsDown className="w-3 h-3" />
            auto-scroll {autoScroll ? 'on' : 'off'}
          </button>
        )}
      </div>
    </div>
  );
}
