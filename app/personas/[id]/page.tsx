'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Send, Play, Square, Settings2, Sparkles, ChevronDown, ChevronUp, Copy, RotateCcw } from 'lucide-react';
import { PtyTerminal } from '@/components/PtyTerminal';
import { RuntimeBadge } from '@/components/RuntimeBadge';
import { toast } from '@/lib/toast';
import type { Persona } from '@/lib/db';

interface AgentSummary {
  id: string;
  name: string;
  status: string;
  task: string;
  created_at: number;
  updated_at: number;
}

interface LogEntry {
  id: number;
  agent_id: string;
  timestamp: number;
  stream: string;
  content: string;
}

const STATUS_DOT: Record<string, string> = {
  idle: '#7A8C9F',
  working: '#5C8A5C',
  needs_input: '#D29A3F',
  offline: '#5a5a5a',
  error: '#B5482A',
};

export default function PersonaDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const personaId = decodeURIComponent(params.id);

  const [persona, setPersona] = useState<Persona | null>(null);
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [hasPty, setHasPty] = useState(false);
  const [composer, setComposer] = useState('');
  const [busy, setBusy] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/personas/${personaId}`);
      if (!r.ok) return;
      const d = await r.json();
      const p: Persona = d.persona;
      setPersona(p);

      const agentId = p.current_agent_id || p.last_agent_id;
      if (agentId) {
        const ar = await fetch(`/api/agents/${agentId}`);
        if (ar.ok) {
          const ad = await ar.json();
          setAgent(ad.agent);
          setLogs(ad.logs || []);
          setHasPty(!!ad.hasPty);
        }
      } else {
        setAgent(null);
        setLogs([]);
        setHasPty(false);
      }
    } catch { /* ignore */ }
  }, [personaId]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, [refresh]);

  useEffect(() => {
    // Scroll to bottom when new logs arrive
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs.length]);

  const sendMessage = async () => {
    if (!composer.trim() || busy) return;
    setBusy(true);
    try {
      // If persona has no live agent, wake them with this message as the task.
      if (!persona?.current_agent_id) {
        const r = await fetch(`/api/personas/${personaId}/wake`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ task: composer }),
        });
        if (!r.ok) { toast.error('wake failed'); return; }
        toast.success(`${persona?.name || 'persona'} is on it`);
      } else {
        // Live agent — send via stdin.
        const r = await fetch(`/api/agents/${persona.current_agent_id}/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: composer }),
        });
        if (!r.ok) { toast.error('message failed'); return; }
        const d = await r.json();
        if (!d.delivered) toast.info('message logged but agent not actively reading stdin');
      }
      setComposer('');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    if (!confirm(`Stop ${persona?.name}'s current session?`)) return;
    await fetch(`/api/personas/${personaId}/wake`, { method: 'DELETE' });
    refresh();
  };

  if (!persona) {
    return (
      <div className="brr-os-empty" style={{ padding: 48 }}>
        loading persona…
      </div>
    );
  }

  return (
    <div className="brr-os-persona-detail">
      <div className="brr-os-persona-detail-head">
        <button
          type="button"
          className="brr-btn brr-btn--ghost"
          onClick={() => router.push('/personas')}
        >
          <ArrowLeft className="w-3 h-3" strokeWidth={1.75} /> back
        </button>
        <div
          className="brr-os-persona-avatar"
          style={{ background: persona.color || 'var(--accent-soft)', width: 36, height: 36, fontSize: 14 }}
        >
          {persona.name.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="brr-os-persona-detail-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{persona.name}</span>
            <RuntimeBadge agentType={persona.agent_type} />
          </div>
          {persona.role && <div className="brr-os-persona-detail-role">{persona.role}</div>}
        </div>

        <div className="brr-os-persona-detail-status">
          <span className="brr-os-persona-dot" style={{ background: STATUS_DOT[persona.status] || '#888' }} />
          {persona.status === 'needs_input' ? 'needs you' : persona.status}
        </div>

        {persona.autonomy === 'auto' && (
          <span className="brr-os-auto-badge">
            <Sparkles className="w-3 h-3" strokeWidth={1.5} />
            auto
          </span>
        )}

        {persona.current_agent_id && (
          <button
            type="button"
            className="brr-btn brr-btn--ghost"
            onClick={handleStop}
          >
            <Square className="w-3 h-3" strokeWidth={1.5} /> stop
          </button>
        )}

        <button
          type="button"
          className="brr-btn brr-btn--ghost"
          onClick={() => router.push(`/personas?edit=${encodeURIComponent(personaId)}`)}
          title="Edit persona"
        >
          <Settings2 className="w-3 h-3" strokeWidth={1.5} /> edit
        </button>

        {persona.claude_session_id && (
          <button
            type="button"
            className="brr-btn brr-btn--ghost"
            disabled={busy}
            title={`Reset claude conversation memory (current session: ${persona.claude_session_id.slice(0, 8)}…)`}
            onClick={async () => {
              if (!confirm(`Reset ${persona.name}'s claude session? They'll start fresh on the next task — losing conversation memory across past tasks.`)) return;
              setBusy(true);
              try {
                const r = await fetch(`/api/personas/${encodeURIComponent(personaId)}/reset-session`, { method: 'POST' });
                if (r.ok) {
                  toast.success(`reset ${persona.name}'s session`);
                  refresh();
                } else {
                  toast.error('reset failed');
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            <RotateCcw className="w-3 h-3" strokeWidth={1.5} /> reset session
          </button>
        )}
      </div>

      {agent?.task && (
        <PromptBlock
          label={persona.current_agent_id ? 'current task — full prompt sent to agent' : 'last task — full prompt sent to agent'}
          prompt={agent.task}
        />
      )}

      <div className="brr-os-persona-detail-body">
        {persona.current_agent_id && hasPty ? (
          <PtyTerminal agentId={persona.current_agent_id} isActive={true} />
        ) : (
          <div ref={logsRef} className="brr-os-agent-feed">
            {logs.length === 0 ? (
              <div className="brr-os-empty" style={{ padding: 32 }}>
                {persona.current_agent_id
                  ? 'agent starting up…'
                  : `${persona.name} is idle. Send a message below to wake them up.`}
              </div>
            ) : (
              <>
                {!persona.current_agent_id && (
                  <div className="brr-os-feed-history-banner">
                    last session — {persona.name} is currently idle
                  </div>
                )}
                {logs.map(l => <FeedEntry key={l.id} log={l} persona={persona} />)}
              </>
            )}
          </div>
        )}
      </div>

      <div className="brr-os-persona-detail-composer">
        <textarea
          value={composer}
          onChange={e => setComposer(e.target.value)}
          placeholder={
            persona.current_agent_id
              ? `message ${persona.name}…`
              : `wake ${persona.name} with a task…`
          }
          rows={2}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              sendMessage();
            }
          }}
        />
        <div className="brr-os-persona-detail-composer-foot">
          <span className="brr-os-composer-hint">⌘↩ send</span>
          <button
            type="button"
            className="brr-btn brr-btn--primary"
            onClick={sendMessage}
            disabled={busy || !composer.trim()}
          >
            {persona.current_agent_id ? <Send className="w-3 h-3" strokeWidth={1.75} /> : <Play className="w-3 h-3" strokeWidth={1.75} />}
            {persona.current_agent_id ? 'send' : 'wake'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function FeedEntry({ log, persona }: { log: LogEntry; persona: Persona }) {
  const stream = log.stream;
  const content = (log.content || '').trim();
  const ts = formatTs(log.timestamp);

  if (stream === 'agent_text') {
    return (
      <div className="brr-os-feed-msg brr-os-feed-msg--agent">
        <div className="brr-os-feed-meta">
          <span
            className="brr-os-feed-avatar"
            style={{ background: persona.color || 'var(--accent)' }}
          >
            {persona.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="brr-os-feed-author">{persona.name}</span>
          <span className="brr-os-feed-ts">{ts}</span>
        </div>
        <div className="brr-os-feed-body">{content}</div>
      </div>
    );
  }

  if (stream === 'tool_use') {
    const colonIdx = content.indexOf(':');
    const name = colonIdx >= 0 ? content.slice(0, colonIdx) : content;
    const input = colonIdx >= 0 ? content.slice(colonIdx + 1).trim() : '';
    return (
      <details className="brr-os-feed-tool">
        <summary>
          <span className="brr-os-feed-tool-tag">tool</span>
          <span className="brr-os-feed-tool-name">{name}</span>
          <span className="brr-os-feed-ts">{ts}</span>
        </summary>
        {input && <pre className="brr-os-feed-tool-body">{input}</pre>}
      </details>
    );
  }

  if (stream === 'tool_result') {
    return (
      <details className="brr-os-feed-tool brr-os-feed-tool--result">
        <summary>
          <span className="brr-os-feed-tool-tag">result</span>
          <span className="brr-os-feed-ts">{ts}</span>
        </summary>
        <pre className="brr-os-feed-tool-body">{content.slice(0, 2000)}</pre>
      </details>
    );
  }

  if (stream === 'system') {
    return (
      <div className="brr-os-feed-system">
        <span className="brr-os-feed-ts">{ts}</span>
        <span>{content}</span>
      </div>
    );
  }

  // stdout / stderr fallback
  return (
    <div className={`brr-os-log brr-os-log--${stream}`}>
      <span className="brr-os-log-ts">{ts}</span>
      <span className="brr-os-log-content">{content}</span>
    </div>
  );
}

/**
 * Collapsed by default to save vertical space, but the persona detail page is
 * the right place to inspect the full assembled prompt — including the team
 * activity block, persona history, and dependency context — when debugging
 * "why didn't the persona use my context?". Expanding shows the prompt
 * verbatim with whitespace preserved; the copy button grabs the whole thing.
 */
function PromptBlock({ label, prompt }: { label: string; prompt: string }) {
  // Default state is fully collapsed — a single header row, no preview text.
  // The agent's actual output below this block deserves the spotlight; click
  // expand to inspect the prompt when you actually need it.
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="brr-os-persona-detail-task" style={{ paddingBottom: open ? undefined : 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="brr-btn brr-btn--ghost"
          style={{ padding: '2px 6px', flex: 1, justifyContent: 'flex-start' }}
          title={open ? 'Hide prompt' : 'Show full assembled prompt'}
        >
          {open
            ? <><ChevronUp className="w-3 h-3" strokeWidth={1.5} /></>
            : <><ChevronDown className="w-3 h-3" strokeWidth={1.5} /></>}
          <span className="brr-os-eyebrow" style={{ marginLeft: 4 }}>{label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            {prompt.length.toLocaleString()} chars
          </span>
        </button>
        {open && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCopy(); }}
            className="brr-btn brr-btn--ghost"
            title="Copy full prompt"
            style={{ padding: '2px 6px' }}
          >
            <Copy className="w-3 h-3" strokeWidth={1.5} /> {copied ? 'copied' : 'copy'}
          </button>
        )}
      </div>
      {open && (
        <p style={{ maxHeight: 360, overflowY: 'auto', marginTop: 8 }}>
          {prompt}
        </p>
      )}
    </div>
  );
}
