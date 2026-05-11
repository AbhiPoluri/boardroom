'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, FileText, Trash2 } from 'lucide-react';
import type { CustomPage } from '@/lib/custom-pages';

export default function CustomPagesIndex() {
  const [pages, setPages] = useState<CustomPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/custom-pages');
      const data = await res.json();
      setPages(data.pages ?? []);
    } catch {
      // ignore — initial state already empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newSlug.trim() || !newTitle.trim()) return;
    const res = await fetch('/api/custom-pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: newSlug.trim(), title: newTitle.trim(), content: '' }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Failed to create page');
      return;
    }
    setNewSlug('');
    setNewTitle('');
    setCreating(false);
    refresh();
  }

  async function handleDelete(slug: string) {
    if (!confirm(`Delete /custom/${slug}?`)) return;
    await fetch(`/api/custom-pages/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div className="brr-os-pane brr-os-pane--right" data-tour="custom-list" style={{ height: '100%', overflowY: 'auto' }}>
      <div className="brr-os-pane-head">
        <span className="brr-os-pane-title">
          <FileText size={14} />
          Custom pages
        </span>
        <span className="brr-os-pane-count">{pages.length}</span>
        <button
          type="button"
          onClick={() => setCreating(v => !v)}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-line)',
            borderRadius: 6,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          <Plus size={12} />
          {creating ? 'cancel' : 'new page'}
        </button>
      </div>

      <div className="brr-os-pane-body">
        {creating && (
          <form
            onSubmit={handleCreate}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg-raised)',
              marginBottom: 8,
            }}
          >
            <input
              value={newSlug}
              onChange={e => setNewSlug(e.target.value)}
              placeholder="slug (e.g. release-notes)"
              autoFocus
              style={inputStyle}
            />
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Title"
              style={inputStyle}
            />
            {error && <div style={{ fontSize: 11, color: 'var(--state-error)' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={primaryButton}>Create</button>
              <button type="button" onClick={() => { setCreating(false); setError(null); }} style={ghostButton}>Cancel</button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="brr-os-empty">Loading…</div>
        ) : pages.length === 0 ? (
          <div className="brr-os-empty">
            <FileText size={20} />
            <p>No custom pages yet. Personas can create them via <code>POST /api/custom-pages</code>.</p>
          </div>
        ) : (
          pages.map(p => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg-raised)',
              }}
            >
              <Link
                href={`/custom/${p.slug}`}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  color: 'inherit',
                  textDecoration: 'none',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{p.title}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>/custom/{p.slug}</span>
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(p.slug)}
                title="Delete"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--fg-muted)',
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  fontFamily: 'inherit',
};

const primaryButton: React.CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--accent-fg)',
  border: '1px solid var(--accent)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};

const ghostButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--fg-muted)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
