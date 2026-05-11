'use client';

import { useEffect, useState, useCallback } from 'react';
import { use as usePromise } from 'react';
import Link from 'next/link';
import { ArrowLeft, Edit2, Save, X } from 'lucide-react';
import { Markdown } from '@/components/Markdown';
import type { CustomPage } from '@/lib/custom-pages';

export default function CustomPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = usePromise(params);
  const [page, setPage] = useState<CustomPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/custom-pages/${encodeURIComponent(slug)}`);
      if (res.status === 404) { setNotFound(true); return; }
      const data = await res.json();
      setPage(data.page);
      setDraftTitle(data.page.title);
      setDraftContent(data.page.content);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { refresh(); }, [refresh]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/custom-pages/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: draftTitle, content: draftContent }),
      });
      if (res.ok) {
        const data = await res.json();
        setPage(data.page);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="brr-os-empty" style={{ padding: 24 }}>Loading…</div>;
  }
  if (notFound) {
    return (
      <div className="brr-os-empty" style={{ padding: 24, flexDirection: 'column', gap: 12 }}>
        <p>Page not found.</p>
        <Link href="/custom" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Back to pages
        </Link>
      </div>
    );
  }
  if (!page) return null;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <Link href="/custom" style={{ color: 'var(--fg-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ArrowLeft size={14} /> pages
        </Link>
        <span style={{ color: 'var(--fg-faint)' }}>/</span>
        <code style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{slug}</code>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {editing ? (
            <>
              <button type="button" onClick={save} disabled={saving} style={primaryButton}>
                <Save size={12} /> {saving ? 'saving…' : 'save'}
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setDraftTitle(page.title); setDraftContent(page.content); }}
                style={ghostButton}
              >
                <X size={12} /> cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} style={ghostButton}>
              <Edit2 size={12} /> edit
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            placeholder="Title"
            style={{ ...inputStyle, fontSize: 22, fontWeight: 600 }}
          />
          <textarea
            value={draftContent}
            onChange={e => setDraftContent(e.target.value)}
            placeholder="Markdown content"
            rows={24}
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 13,
              lineHeight: 1.6,
              resize: 'vertical',
              minHeight: 320,
            }}
          />
        </div>
      ) : (
        <>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--fg)', margin: 0, marginBottom: 16 }}>
            {page.title}
          </h1>
          <div style={{ color: 'var(--fg-secondary)', fontSize: 14, lineHeight: 1.65 }}>
            {page.content.trim() ? (
              <Markdown content={page.content} />
            ) : (
              <p style={{ color: 'var(--fg-muted)', fontStyle: 'italic' }}>
                Empty page. Click <strong>edit</strong> to add content, or have a persona POST markdown to{' '}
                <code>/api/custom-pages/{slug}</code>.
              </p>
            )}
          </div>
          <div style={{ marginTop: 28, fontSize: 11, color: 'var(--fg-muted)' }}>
            Last updated {new Date(page.updated_at).toLocaleString()}
            {page.author_persona_id && ` · authored by ${page.author_persona_id}`}
          </div>
        </>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const primaryButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--accent)',
  color: 'var(--accent-fg)',
  border: '1px solid var(--accent)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};

const ghostButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  color: 'var(--fg-muted)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
