'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PtyTerminal } from '@/components/PtyTerminal';
import {
  Terminal, Zap, RotateCcw, X, ChevronDown, ChevronRight,
  Monitor, List,
} from 'lucide-react';

const ORCHESTRATOR_ID = '__orchestrator__';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  events?: OrchestratorEvent[];
  created_at?: number;
}

interface OrchestratorEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'done' | 'error';
  content?: string;
  tool?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

const TOOL_COLORS: Record<string, string> = {
  spawn_agent: 'text-emerald-400',
  resume_agent: 'text-blue-400',
  kill_agent: 'text-red-400',
};

const TOOL_ICONS: Record<string, React.ReactNode> = {
  spawn_agent: <Zap className="w-3 h-3" />,
  resume_agent: <RotateCcw className="w-3 h-3" />,
  kill_agent: <X className="w-3 h-3" />,
};

function ToolBlock({ event, result }: { event: OrchestratorEvent; result?: OrchestratorEvent }) {
  const [expanded, setExpanded] = useState(false);
  const tool = event.tool || 'unknown';
  const color = TOOL_COLORS[tool] || 'text-amber-400';
  const icon = TOOL_ICONS[tool] || <Terminal className="w-3 h-3" />;

  const input = event.input || {};
  const summary = tool === 'spawn_agent'
    ? `${input.name || 'agent'} — ${(input.task as string || '').slice(0, 80)}${(input.task as string || '').length > 80 ? '...' : ''}`
    : tool === 'resume_agent'
    ? `${input.id || ''} — ${(input.task as string || '').slice(0, 60)}`
    : tool === 'kill_agent'
    ? `${input.id || ''}`
    : JSON.stringify(input).slice(0, 80);

  const resultData = result?.result as Record<string, unknown> | undefined;
  const resultSummary = resultData
    ? tool === 'spawn_agent' && resultData.id
      ? `id: ${(resultData.id as string).slice(0, 8)}…`
      : JSON.stringify(resultData).slice(0, 120)
    : result?.error
    ? `error: ${result.error}`
    : null;

  return (
    <div className="group">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-start gap-2 w-full text-left py-0.5 hover:bg-zinc-900/50 rounded px-1 -mx-1"
      >
        <span className={`flex-shrink-0 mt-0.5 ${color}`}>{icon}</span>
        <span className={`flex-shrink-0 font-bold ${color}`}>{tool.replace(/_/g, ' ')}</span>
        <span className="text-zinc-500 truncate flex-1">{summary}</span>
        {resultSummary && (
          <span className="text-zinc-700 flex-shrink-0 text-[10px] mt-0.5">
            {expanded ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />}
          </span>
        )}
      </button>
      {expanded && (
        <div className="ml-5 pl-3 border-l border-zinc-800 space-y-1 py-1">
          {event.input && (
            <div>
              <span className="text-zinc-600">input </span>
              <span className="text-zinc-400 break-all">{JSON.stringify(event.input, null, 2)}</span>
            </div>
          )}
          {result?.result !== undefined && (
            <div>
              <span className="text-zinc-600">result </span>
              <span className="text-emerald-400/70 break-all">{JSON.stringify(result.result, null, 2)}</span>
            </div>
          )}
          {result?.error && (
            <div>
              <span className="text-zinc-600">error </span>
              <span className="text-red-400 break-all">{result.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TurnBlock({ msg }: { msg: ChatMessage }) {
  const [collapsed, setCollapsed] = useState(false);
  const isUser = msg.role === 'user';

  const toolUses = (msg.events || []).filter(e => e.type === 'tool_use');
  const toolResults = (msg.events || []).filter(e => e.type === 'tool_result');
  const errors = (msg.events || []).filter(e => e.type === 'error');

  return (
    <div className="border-b border-zinc-900/60">
      <button
        onClick={() => setCollapsed(c => !c)}
        className={`w-full flex items-center gap-2 px-4 py-1.5 text-left hover:bg-zinc-900/30 ${
          isUser ? 'bg-zinc-900/20' : ''
        }`}
      >
        <span className={`text-[10px] font-mono w-[60px] flex-shrink-0 ${isUser ? 'text-blue-500' : 'text-emerald-500'}`}>
          {isUser ? '> user' : '< orch'}
        </span>
        <span className={`text-xs font-mono truncate flex-1 ${isUser ? 'text-zinc-300' : 'text-zinc-500'}`}>
          {isUser
            ? msg.content
            : toolUses.length > 0
            ? `${toolUses.length} tool call${toolUses.length > 1 ? 's' : ''} + ${msg.content ? 'response' : 'no text'}`
            : msg.content?.slice(0, 100) || '(empty)'
          }
        </span>
        <span className="text-zinc-800 text-[10px]">
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>
      {!collapsed && (
        <div className="px-4 pb-2 space-y-1">
          {isUser ? (
            <div className="text-sm font-mono text-zinc-200 whitespace-pre-wrap pl-[68px]">
              {msg.content}
            </div>
          ) : (
            <div className="pl-[68px] space-y-1 text-xs font-mono">
              {toolUses.map((ev, i) => (
                <ToolBlock key={i} event={ev} result={toolResults.find(r => r.tool === ev.tool)} />
              ))}
              {msg.content && (
                <div className="text-zinc-300 whitespace-pre-wrap leading-relaxed text-[12px]">
                  {msg.content}
                </div>
              )}
              {errors.map((e, i) => (
                <div key={i} className="text-red-400 bg-red-950/20 rounded px-2 py-1">
                  {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ViewMode = 'terminal' | 'turns';

export default function OrchestratorPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('turns');
  const [isActive, setIsActive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/chat');
      const data = await res.json();
      if (data.messages?.length > 0) {
        setMessages(data.messages);
      }
    } catch {}
    setLoading(false);
  }, []);

  // Check if orchestrator is actively running (has recent PTY activity)
  useEffect(() => {
    const checkActive = async () => {
      try {
        const res = await fetch(`/api/stream/pty/${ORCHESTRATOR_ID}`);
        // If we get a response, there might be PTY data
        if (res.ok) setIsActive(true);
        res.body?.cancel();
      } catch {}
    };
    checkActive();
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  useEffect(() => {
    if (!autoRefresh || viewMode !== 'turns') return;
    const iv = setInterval(fetchHistory, 8000);
    return () => clearInterval(iv);
  }, [autoRefresh, fetchHistory, viewMode]);

  useEffect(() => {
    if (autoScroll && bottomRef.current && viewMode === 'turns') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll, viewMode]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  const turnCount = messages.length;
  const toolCallCount = messages.reduce(
    (n, m) => n + (m.events || []).filter(e => e.type === 'tool_use').length, 0
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-sm text-zinc-100 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-500" />
            orchestrator
          </h1>
          <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-600">
            <span>{turnCount} turns</span>
            <span>{toolCallCount} tool calls</span>
          </div>
        </div>

        {/* View mode tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
          <button
            onClick={() => setViewMode('terminal')}
            className={`px-3 py-1 rounded text-[11px] font-mono transition-colors flex items-center gap-1.5 ${
              viewMode === 'terminal'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Monitor className="w-3 h-3" />
            terminal
          </button>
          <button
            onClick={() => setViewMode('turns')}
            className={`px-3 py-1 rounded text-[11px] font-mono transition-colors flex items-center gap-1.5 ${
              viewMode === 'turns'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <List className="w-3 h-3" />
            turns
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'terminal' ? (
        <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
          <PtyTerminal agentId={ORCHESTRATOR_ID} isActive={isActive} />
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto bg-zinc-950"
            style={{ minHeight: 0 }}
          >
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <span className="font-mono text-sm text-zinc-700 animate-pulse">loading...</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <Terminal className="w-10 h-10 text-zinc-800 mb-4" />
                <p className="font-mono text-sm text-zinc-600">no orchestrator activity yet</p>
                <p className="font-mono text-xs text-zinc-700 mt-1">send a message in the chat panel to get started</p>
                <button
                  onClick={() => setViewMode('terminal')}
                  className="mt-4 px-3 py-1.5 rounded-lg text-xs font-mono bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  open terminal
                </button>
              </div>
            ) : (
              <div>
                <div className="px-4 py-2 border-b border-zinc-900/60 text-[10px] font-mono text-zinc-700">
                  orchestrator session — {messages.filter(m => m.role === 'user').length} user messages, {toolCallCount} agent operations
                </div>
                {messages.map((msg, i) => (
                  <TurnBlock key={i} msg={msg} />
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-zinc-800/60 bg-zinc-950/50">
            <span className="text-[10px] font-mono text-zinc-700">
              {autoRefresh ? 'refreshing every 3s' : 'refresh paused'}
            </span>
            <span className="text-[10px] font-mono text-zinc-700">{messages.length} messages</span>
          </div>
        </>
      )}
    </div>
  );
}
