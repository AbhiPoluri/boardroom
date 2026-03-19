'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, ChevronDown, ChevronUp, Zap, Terminal, CheckCircle, Trash2, RotateCcw, GitMerge, X, Check, Eye } from 'lucide-react';
import { Markdown } from '@/components/Markdown';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  events?: OrchestratorEvent[];
}

interface OrchestratorEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'done' | 'error';
  content?: string;
  tool?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

interface ChatBoxProps {
  // intentionally empty — ChatBox is now layout-level and manages its own state
}

function ToolCallPill({ event, result }: { event: OrchestratorEvent; result?: OrchestratorEvent }) {
  const [expanded, setExpanded] = useState(false);

  const toolLabel: Record<string, string> = {
    spawn_agent: 'spawn agent',
    resume_agent: 'resume agent',
    kill_agent: 'kill agent',
  };

  const toolIcon: Record<string, React.ReactNode> = {
    spawn_agent: <Zap className="w-3 h-3" />,
    resume_agent: <RotateCcw className="w-3 h-3" />,
    kill_agent: <span className="text-xs">✕</span>,
  };

  const label = toolLabel[event.tool || ''] || event.tool || 'tool';
  const icon = toolIcon[event.tool || ''] || <Terminal className="w-3 h-3" />;

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono bg-zinc-800/80 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
      >
        <span className="text-emerald-400">{icon}</span>
        <span>{label}</span>
        {expanded ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
      </button>
      {expanded && (
        <div className="mt-1 ml-2 border-l border-zinc-700 pl-3 space-y-1">
          {event.input && (
            <div className="text-xs font-mono text-zinc-500">
              <span className="text-zinc-600">input: </span>
              <span className="text-zinc-400">{JSON.stringify(event.input, null, 0)}</span>
            </div>
          )}
          {result?.result !== undefined && (
            <div className="text-xs font-mono text-zinc-500">
              <span className="text-zinc-600">result: </span>
              <span className="text-zinc-400">{JSON.stringify(result.result, null, 0)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[75%] px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono">
          {msg.content}
        </div>
      </div>
    );
  }

  const toolUseEvents = (msg.events || []).filter(e => e.type === 'tool_use');
  const toolResultEvents = (msg.events || []).filter(e => e.type === 'tool_result');

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%] space-y-1">
        {toolUseEvents.map((ev, i) => (
          <ToolCallPill
            key={i}
            event={ev}
            result={toolResultEvents.find(r => r.tool === ev.tool)}
          />
        ))}
        {msg.content && (
          <div className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm font-mono">
            <Markdown content={msg.content} />
          </div>
        )}
        {msg.events?.some(e => e.type === 'error') && (
          <div className="px-3 py-2 rounded text-xs font-mono text-red-400 bg-red-950/30 border border-red-900">
            {msg.events.find(e => e.type === 'error')?.error}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="px-3 py-2 rounded-lg bg-emerald-950/40 border border-emerald-900/60 flex items-center gap-2">
        <span className="text-xs font-mono text-emerald-400">orchestrator working</span>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1.2s' }} />
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1.2s' }} />
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1.2s' }} />
        </div>
      </div>
    </div>
  );
}

interface PushRequest {
  id: string;
  agent_id: string;
  agent_name: string;
  branch: string;
  base_branch: string;
  summary: string;
  changed_files_json: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
}

function PushRequestCard({ pr, onAction }: { pr: PushRequest; onAction: (id: string, action: 'approve' | 'reject') => void }) {
  const [showFiles, setShowFiles] = useState(false);
  const files = JSON.parse(pr.changed_files_json || '[]');

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitMerge className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-mono text-amber-300 font-medium">push request #{pr.id.slice(0, 6)}</span>
        </div>
        <span className="text-[9px] font-mono text-zinc-600">
          {new Date(pr.created_at).toLocaleTimeString()}
        </span>
      </div>

      <div className="text-[11px] font-mono text-zinc-300">{pr.summary}</div>

      <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
        <span className="text-zinc-400">{pr.agent_name}</span>
        <span>·</span>
        <span>{pr.branch} → {pr.base_branch}</span>
        {files.length > 0 && (
          <>
            <span>·</span>
            <button onClick={() => setShowFiles(!showFiles)} className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200">
              <Eye className="w-2.5 h-2.5" />
              {files.length} file{files.length !== 1 ? 's' : ''}
            </button>
          </>
        )}
      </div>

      {showFiles && files.length > 0 && (
        <div className="ml-1 border-l border-zinc-800 pl-2 space-y-0.5">
          {files.map((f: { path: string; status: string }, i: number) => (
            <div key={i} className="text-[10px] font-mono flex items-center gap-1.5">
              <span className={f.status === 'added' ? 'text-emerald-400' : f.status === 'deleted' ? 'text-red-400' : 'text-amber-400'}>
                {f.status === 'added' ? '+' : f.status === 'deleted' ? '-' : '~'}
              </span>
              <span className="text-zinc-400 truncate">{f.path}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onAction(pr.id, 'approve')}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/20 transition-colors"
        >
          <Check className="w-3 h-3" /> approve & merge
        </button>
        <button
          onClick={() => onAction(pr.id, 'reject')}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono bg-red-600/10 text-red-400 hover:bg-red-600/20 border border-red-500/20 transition-colors"
        >
          <X className="w-3 h-3" /> reject
        </button>
      </div>
    </div>
  );
}

const INITIAL_MESSAGE: ChatMessage = { role: 'assistant', content: 'boardroom ready. tell me what to build.' };

export function ChatBox({}: ChatBoxProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [pushRequests, setPushRequests] = useState<PushRequest[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load history from DB on mount
  useEffect(() => {
    fetch('/api/chat')
      .then(r => r.json())
      .then(data => {
        if (data.messages?.length > 0) {
          setMessages(data.messages);
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true));
  }, []);

  // Poll for pending push requests
  useEffect(() => {
    const fetchPRs = () => {
      fetch('/api/push-requests?status=pending')
        .then(r => r.json())
        .then(data => setPushRequests(data.requests || []))
        .catch(() => {});
    };
    fetchPRs();
    const iv = setInterval(fetchPRs, 10000);
    return () => clearInterval(iv);
  }, []);

  const handlePushAction = useCallback(async (id: string, action: 'approve' | 'reject') => {
    try {
      const res = await fetch('/api/push-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (data.status) {
        setPushRequests(prev => prev.filter(pr => pr.id !== id));
      }
    } catch {}
  }, []);

  // Poll for new messages every 3s (picks up messages from API/CLI)
  useEffect(() => {
    if (loading) return; // don't poll while streaming
    const interval = setInterval(() => {
      fetch('/api/chat')
        .then(r => r.json())
        .then(data => {
          if (data.messages?.length > 0) {
            setMessages(prev => {
              if (data.messages.length !== prev.length) return data.messages;
              // Check if last message content changed
              const lastNew = data.messages[data.messages.length - 1];
              const lastOld = prev[prev.length - 1];
              if (lastNew?.content !== lastOld?.content) return data.messages;
              return prev;
            });
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [loading]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const clearHistory = useCallback(async () => {
    await fetch('/api/chat', { method: 'DELETE' });
    setMessages([INITIAL_MESSAGE]);
  }, []);

  const cancelMessage = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setLoading(true);

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    // Placeholder assistant message (will be filled by stream)
    const assistantMsg: ChatMessage = { role: 'assistant', content: '', events: [] };
    setMessages(prev => [...prev, assistantMsg]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: '',
            events: [{ type: 'error', error: err.error || 'Request failed' }],
          };
          return updated;
        });
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event: OrchestratorEvent = JSON.parse(raw);

            setMessages(prev => {
              const updated = [...prev];
              const last = { ...updated[updated.length - 1] };

              if (event.type === 'text') {
                last.content = (last.content || '') + (event.content || '');
              } else if (event.type === 'tool_use' || event.type === 'tool_result') {
                last.events = [...(last.events || []), event];
                // (agent grid auto-polls every 2s — no explicit refresh needed)
              } else if (event.type === 'error') {
                last.events = [...(last.events || []), event];
              }

              updated[updated.length - 1] = last;
              return updated;
            });
          } catch {}
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled — leave the partial response, just mark done
      } else {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: '',
            events: [{ type: 'error', error: err instanceof Error ? err.message : 'Network error' }],
          };
          return updated;
        });
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800/50 bg-zinc-900/30">
        {loading ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-mono text-zinc-600">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              working
            </span>
            <button
              onClick={cancelMessage}
              className="flex items-center gap-1 text-[10px] font-mono text-zinc-600 hover:text-red-400 transition-colors"
              title="Abort request"
            >
              <X className="w-3 h-3" /> abort
            </button>
          </div>
        ) : (
          <button
            onClick={clearHistory}
            className="p-1 text-zinc-700 hover:text-zinc-400 transition-colors"
            title="Clear chat history"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0">
        {/* Pending push requests */}
        {pushRequests.length > 0 && (
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-[10px] font-mono text-amber-400 uppercase tracking-wider">
              <GitMerge className="w-3 h-3" />
              {pushRequests.length} pending push request{pushRequests.length !== 1 ? 's' : ''}
            </div>
            {pushRequests.map(pr => (
              <PushRequestCard key={pr.id} pr={pr} onAction={handlePushAction} />
            ))}
          </div>
        )}
        {!historyLoaded ? (
          <div className="text-center text-zinc-700 font-mono text-xs animate-pulse py-4">loading history…</div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))
        )}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 p-3 flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="tell the orchestrator what to do..."
          rows={1}
          disabled={loading}
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500 disabled:opacity-50 max-h-32 overflow-auto"
          style={{ minHeight: '38px' }}
          onInput={e => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 128) + 'px';
          }}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="flex-shrink-0 p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
