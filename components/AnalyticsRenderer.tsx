'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * Renders a custom page whose content is a JSON payload describing analytics
 * stats + optional sections. No JSX/MDX eval — the schema is fixed and every
 * field renders via known React components.
 *
 * Payload shape (all fields optional except `stats`):
 *
 * {
 *   "summary": "One paragraph at the top, plain text.",
 *   "stats": [
 *     { "label": "Followers", "value": 333, "delta_pct": 10, "delta_dir": "up", "note": "past 7 days" }
 *   ],
 *   "sections": [
 *     { "heading": "Top posts", "kind": "table",
 *       "columns": ["Title", "Impressions", "Reactions"],
 *       "rows": [["My post", 120, 4], ...]
 *     },
 *     { "heading": "Weekly activity", "kind": "bullets",
 *       "items": ["1 post this week", "0 comments"]
 *     },
 *     { "heading": "Notes", "kind": "text",
 *       "body": "Free-form paragraph(s)."
 *     }
 *   ],
 *   "updated_label": "as of 2026-05-10"
 * }
 */

type Stat = {
  label: string;
  value: string | number;
  delta_pct?: number;
  delta_dir?: 'up' | 'down' | 'flat';
  note?: string;
};

type Section =
  | { heading: string; kind: 'table'; columns: string[]; rows: (string | number | null)[][] }
  | { heading: string; kind: 'bullets'; items: string[] }
  | { heading: string; kind: 'text'; body: string };

interface AnalyticsPayload {
  summary?: string;
  stats?: Stat[];
  sections?: Section[];
  updated_label?: string;
}

export function AnalyticsRenderer({ raw }: { raw: string }) {
  let data: AnalyticsPayload;
  try {
    data = JSON.parse(raw) as AnalyticsPayload;
  } catch (err) {
    return (
      <div style={{
        padding: 16,
        border: '1px solid var(--state-error)',
        background: 'color-mix(in srgb, var(--state-error) 12%, transparent)',
        borderRadius: 8,
        color: 'var(--fg)',
      }}>
        <strong>Invalid analytics payload</strong>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
          Expected JSON matching the AnalyticsPayload shape. Parse error:
        </div>
        <pre style={{ fontSize: 11, color: 'var(--state-error)', marginTop: 8, whiteSpace: 'pre-wrap' }}>
          {(err as Error).message}
        </pre>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {data.summary && (
        <p style={{ color: 'var(--fg-secondary)', fontSize: 15, lineHeight: 1.6, margin: 0 }}>
          {data.summary}
        </p>
      )}

      {data.stats && data.stats.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}>
          {data.stats.map((s, i) => (
            <StatCard key={i} stat={s} />
          ))}
        </div>
      )}

      {data.sections?.map((section, i) => (
        <SectionView key={i} section={section} />
      ))}

      {data.updated_label && (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8 }}>
          {data.updated_label}
        </div>
      )}
    </div>
  );
}

function StatCard({ stat }: { stat: Stat }) {
  const dir = stat.delta_dir ?? (
    typeof stat.delta_pct === 'number'
      ? (stat.delta_pct > 0 ? 'up' : stat.delta_pct < 0 ? 'down' : 'flat')
      : 'flat'
  );
  const Icon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;
  const tone = dir === 'up' ? 'var(--state-ok)' : dir === 'down' ? 'var(--state-error)' : 'var(--fg-muted)';
  return (
    <div style={{
      padding: 16,
      border: '1px solid var(--border)',
      background: 'var(--bg-raised)',
      borderRadius: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {stat.label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.1 }}>
        {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
      </div>
      {(typeof stat.delta_pct === 'number' || stat.note) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--fg-secondary)' }}>
          {typeof stat.delta_pct === 'number' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: tone }}>
              <Icon size={12} />
              {Math.abs(stat.delta_pct)}%
            </span>
          )}
          {stat.note && <span style={{ color: 'var(--fg-muted)' }}>{stat.note}</span>}
        </div>
      )}
    </div>
  );
}

function SectionView({ section }: { section: Section }) {
  return (
    <div>
      <h2 style={{
        fontSize: 13,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: 'var(--fg-muted)',
        fontWeight: 600,
        margin: 0,
        marginBottom: 10,
      }}>
        {section.heading}
      </h2>
      {section.kind === 'table' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-raised)' }}>
                {section.columns.map((c, i) => (
                  <th key={i} style={{
                    textAlign: 'left',
                    padding: '8px 12px',
                    fontWeight: 600,
                    color: 'var(--fg-secondary)',
                    fontSize: 12,
                    borderBottom: '1px solid var(--border)',
                  }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, i) => (
                <tr key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-faint)' }}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ padding: '8px 12px', color: 'var(--fg)' }}>
                      {cell == null
                        ? <span style={{ color: 'var(--fg-muted)' }}>—</span>
                        : typeof cell === 'number'
                          ? cell.toLocaleString()
                          : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.kind === 'bullets' && (
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--fg-secondary)', fontSize: 14, lineHeight: 1.7 }}>
          {section.items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      )}
      {section.kind === 'text' && (
        <p style={{ margin: 0, color: 'var(--fg-secondary)', fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
          {section.body}
        </p>
      )}
    </div>
  );
}
