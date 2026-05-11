'use client';

import { useEffect, useState } from 'react';
import { Inbox, MessageCircleQuestion, ChevronRight } from 'lucide-react';
import type { PendingQuestionWithAgent } from '@/lib/db';

interface InboxPanelProps {
  refreshKey?: number;
  onResolved?: () => void;
  onCollapse?: () => void;
}

export function InboxPanel({ refreshKey, onResolved, onCollapse }: InboxPanelProps) {
  const [questions, setQuestions] = useState<PendingQuestionWithAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    fetch('/api/pending-questions')
      .then(r => r.json())
      .then(d => setQuestions(d.questions || []))
      .catch(() => setQuestions([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, [refreshKey]);

  return (
    <div className="brr-os-inbox">
      <div className="brr-os-pane-head">
        <span className="brr-os-pane-title"><Inbox className="w-3 h-3" strokeWidth={1.75} /> inbox</span>
        <span className="brr-os-pane-count" style={{ marginLeft: 'auto' }}>{questions.length}</span>
        {onCollapse && (
          <button
            type="button"
            className="brr-btn brr-btn--ghost"
            onClick={onCollapse}
            title="collapse inbox"
            style={{ padding: '2px 6px' }}
          >
            <ChevronRight className="w-3 h-3" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="brr-os-inbox-list">
        {loading ? (
          <div className="brr-os-inbox-empty">loading…</div>
        ) : questions.length === 0 ? (
          <div className="brr-os-inbox-empty">
            <MessageCircleQuestion className="w-4 h-4" strokeWidth={1.5} />
            <span>nothing pending — your team is unblocked</span>
          </div>
        ) : (
          questions.map(q => (
            <QuestionItem
              key={q.id}
              q={q}
              onResolved={() => {
                refresh();
                onResolved?.();
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function QuestionItem({ q, onResolved }: { q: PendingQuestionWithAgent; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [customAnswer, setCustomAnswer] = useState('');
  const options: string[] = q.options_json ? safeParse(q.options_json) : [];

  const resolve = async (choice: string) => {
    if (!choice.trim() || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/pending-questions/${q.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
      onResolved();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await fetch(`/api/pending-questions/${q.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      onResolved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brr-os-inbox-item">
      <div className="brr-os-inbox-item-head">
        <span className="brr-os-inbox-from">{q.agent_name || 'agent'}</span>
        <span className="brr-os-inbox-time">{relTime(q.created_at)}</span>
      </div>
      <div className="brr-os-inbox-question">{q.question}</div>

      {options.length > 0 ? (
        <div className="brr-os-inbox-options">
          {options.map(opt => (
            <button
              key={opt}
              type="button"
              className={`brr-btn ${opt === q.default_choice ? 'brr-btn--primary' : 'brr-btn--ghost'}`}
              disabled={busy}
              onClick={() => resolve(opt)}
              style={{ fontSize: 11 }}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <div className="brr-os-inbox-freeform">
          <input
            value={customAnswer}
            onChange={e => setCustomAnswer(e.target.value)}
            placeholder="type your answer…"
            className="brr-os-inbox-input"
            onKeyDown={e => {
              if (e.key === 'Enter') resolve(customAnswer);
            }}
          />
          <button
            type="button"
            className="brr-btn brr-btn--primary"
            disabled={busy || !customAnswer.trim()}
            onClick={() => resolve(customAnswer)}
            style={{ fontSize: 11 }}
          >
            send
          </button>
        </div>
      )}

      <div className="brr-os-inbox-foot">
        <button
          type="button"
          className="brr-btn brr-btn--ghost"
          disabled={busy}
          onClick={cancel}
          style={{ fontSize: 10 }}
        >
          dismiss
        </button>
      </div>
    </div>
  );
}

function safeParse(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 60 / 60_000)}h`;
  return `${Math.floor(diff / 24 / 60 / 60_000)}d`;
}
