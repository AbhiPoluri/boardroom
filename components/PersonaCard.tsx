'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Square, Sparkles, ExternalLink } from 'lucide-react';
import type { Persona } from '@/lib/db';

interface PersonaCardProps {
  persona: Persona;
  onWake?: (persona: Persona) => void;
  onSleep?: (persona: Persona) => void;
  onSelect?: (persona: Persona) => void;
  selected?: boolean;
  compact?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'idle',
  working: 'working',
  needs_input: 'needs you',
  offline: 'offline',
  error: 'error',
};

const STATUS_DOT: Record<string, string> = {
  idle: '#7A8C9F',
  working: '#5C8A5C',
  needs_input: '#D29A3F',
  offline: '#5a5a5a',
  error: '#B5482A',
};

export function PersonaCard({ persona, onWake, onSleep, onSelect, selected, compact }: PersonaCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const skills: string[] = persona.skills_json ? safeParse(persona.skills_json) : [];
  const isWorking = persona.status === 'working' || persona.status === 'needs_input';

  const openDetail = () => router.push(`/personas/${encodeURIComponent(persona.id)}`);

  return (
    <div
      onClick={() => (onSelect ? onSelect(persona) : openDetail())}
      className={`brr-os-persona ${selected ? 'is-selected' : ''} ${compact ? 'is-compact' : ''}`}
      style={{
        borderColor: selected ? (persona.color || 'var(--accent)') : 'var(--border)',
      }}
    >
      <div className="brr-os-persona-row">
        <div
          className="brr-os-persona-avatar"
          style={{ background: persona.color || 'var(--accent-soft)' }}
        >
          {(persona.name || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="brr-os-persona-meta">
          <div className="brr-os-persona-name">{persona.name}</div>
          {persona.role && <div className="brr-os-persona-role">{persona.role}</div>}
        </div>
        <div className="brr-os-persona-status">
          <span className="brr-os-persona-dot" style={{ background: STATUS_DOT[persona.status] || '#888' }} />
          <span>{STATUS_LABEL[persona.status] || persona.status}</span>
        </div>
      </div>

      {!compact && skills.length > 0 && (
        <div className="brr-os-persona-skills">
          {skills.slice(0, 6).map(s => (
            <span key={s} className="brr-os-skill-pill">{s}</span>
          ))}
        </div>
      )}

      {!compact && (
        <div className="brr-os-persona-actions">
          {persona.autonomy === 'auto' && (
            <span className="brr-os-auto-badge">
              <Sparkles className="w-3 h-3" strokeWidth={1.5} />
              auto
            </span>
          )}
          <button
            type="button"
            className="brr-btn brr-btn--ghost"
            onClick={(e) => { e.stopPropagation(); openDetail(); }}
            title="open detail"
          >
            <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
            <span>open</span>
          </button>
          {!isWorking ? (
            <button
              type="button"
              className="brr-btn brr-btn--ghost"
              disabled={busy}
              onClick={async (e) => {
                e.stopPropagation();
                setBusy(true);
                try { await onWake?.(persona); } finally { setBusy(false); }
              }}
            >
              <Play className="w-3 h-3" strokeWidth={1.5} />
              <span>wake</span>
            </button>
          ) : (
            <button
              type="button"
              className="brr-btn brr-btn--ghost"
              disabled={busy}
              onClick={async (e) => {
                e.stopPropagation();
                setBusy(true);
                try { await onSleep?.(persona); } finally { setBusy(false); }
              }}
            >
              <Square className="w-3 h-3" strokeWidth={1.5} />
              <span>stop</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function safeParse(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}
