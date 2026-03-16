'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, ChevronDown, ChevronUp, Zap, Terminal, CheckCircle, Trash2, RotateCcw } from 'lucide-react';

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
          <div className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm font-mono whitespace-pre-wrap">
            {msg.content}
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
      <div className="px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1.2s' }} />
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1.2s' }} />
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1.2s' }} />
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    }, 3000);
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

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
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
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: '',
          events: [{ type: 'error', error: err instanceof Error ? err.message : 'Network error' }],
        };
        return updated;
      });
    } finally {
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
    <div className="flex flex-col h-full bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50">
        <Terminal className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">orchestrator</span>
        {loading ? (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-mono text-zinc-600">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            working
          </span>
        ) : (
          <button
            onClick={clearHistory}
            className="ml-auto p-1 text-zinc-700 hover:text-zinc-400 transition-colors"
            title="Clear chat history"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0">
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
