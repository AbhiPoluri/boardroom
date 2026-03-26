'use client';

import { useState, useEffect } from 'react';
import {
  SlidersHorizontal, Save, Key, Database, Download, Shield,
  CheckCircle2, XCircle, HelpCircle, Palette,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { SubNav } from '@/components/SubNav';
import { useRestartTour } from '@/components/OnboardingTour';
import { useTheme, DEFAULT_COLORS } from '@/components/ThemeProvider';

function SectionCard({
  icon: Icon,
  title,
  badge,
  children,
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-[var(--br-bg-card)]/40 border-[var(--br-border)]">
      <CardContent className="px-5 py-4">
        <div className="flex items-center gap-2.5 mb-4">
          <Icon className="w-4 h-4 text-[var(--br-text-secondary)] flex-shrink-0" />
          <h2 className="font-mono text-sm text-[var(--br-text-primary)]">{title}</h2>
          {badge && (
            <Badge variant="outline" className="text-[9px] font-mono text-[var(--br-text-muted)] border-[var(--br-border)] ml-1">
              {badge}
            </Badge>
          )}
        </div>
        <div className="space-y-3">{children}</div>
      </CardContent>
    </Card>
  );
}

function RuntimeSettingsCard() {
  const [rateLimit, setRateLimit] = useState<number | ''>('');
  const [maxAgents, setMaxAgents] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: { rateLimit: number; maxAgents: number }) => {
        setRateLimit(data.rateLimit);
        setMaxAgents(data.maxAgents);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rateLimit: rateLimit === '' ? undefined : rateLimit,
          maxAgents: maxAgents === '' ? undefined : maxAgents,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { rateLimit: number; maxAgents: number };
        setRateLimit(data.rateLimit);
        setMaxAgents(data.maxAgents);
        setSaveStatus('saved');
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus('idle'), 2500);
    }
  };

  return (
    <SectionCard icon={SlidersHorizontal} title="runtime settings" badge="live">
      <p className="text-[11px] font-mono text-[var(--br-text-muted)]">
        These values override env vars at runtime and are persisted to the database.
      </p>
      <div className="space-y-3 mt-1">
        <div className="flex items-center gap-4">
          <label className="text-[12px] font-mono text-[var(--br-text-secondary)] min-w-[200px]">
            Rate limit (requests/min)
          </label>
          <input
            type="number"
            min={1}
            value={rateLimit}
            onChange={e => setRateLimit(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
            className="w-24 px-2 py-1 rounded-md bg-[var(--br-bg-primary)] border border-[var(--br-border)] text-[12px] font-mono text-[var(--br-text-primary)] focus:outline-none focus:border-[var(--br-text-muted)]"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="text-[12px] font-mono text-[var(--br-text-secondary)] min-w-[200px]">
            Max concurrent agents
          </label>
          <input
            type="number"
            min={1}
            value={maxAgents}
            onChange={e => setMaxAgents(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
            className="w-24 px-2 py-1 rounded-md bg-[var(--br-bg-primary)] border border-[var(--br-border)] text-[12px] font-mono text-[var(--br-text-primary)] focus:outline-none focus:border-[var(--br-text-muted)]"
          />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--br-bg-hover)] hover:bg-[var(--br-bg-hover)] border border-[var(--br-border)] text-[11px] font-mono text-[var(--br-text-secondary)] transition-colors disabled:opacity-50"
        >
          <Save className="w-3 h-3" />
          {saving ? 'saving...' : 'save'}
        </button>
        {saveStatus === 'saved' && (
          <span className="text-[11px] font-mono text-emerald-400">saved</span>
        )}
        {saveStatus === 'error' && (
          <span className="text-[11px] font-mono text-red-400">error saving</span>
        )}
      </div>
    </SectionCard>
  );
}

function ApiKeyCard() {
  const [status, setStatus] = useState<'loading' | 'set' | 'unset'>('loading');

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: { apiKeySet?: boolean }) => {
        setStatus(data.apiKeySet ? 'set' : 'unset');
      })
      .catch(() => setStatus('unset'));
  }, []);

  return (
    <SectionCard icon={Key} title="api key">
      <p className="text-[11px] font-mono text-[var(--br-text-muted)]">
        Set <code className="text-[var(--br-text-secondary)]">BOARDROOM_API_KEY</code> in your environment to require authentication on all API requests.
      </p>
      <div className="flex items-center gap-2.5 mt-2">
        {status === 'loading' ? (
          <span className="text-[11px] font-mono text-[var(--br-text-muted)]">checking...</span>
        ) : status === 'set' ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="text-[12px] font-mono text-emerald-400">API key is set</span>
            <Badge variant="outline" className="text-[9px] font-mono text-[var(--br-text-muted)] border-[var(--br-border)] ml-1">auth enabled</Badge>
          </>
        ) : (
          <>
            <XCircle className="w-3.5 h-3.5 text-[var(--br-text-muted)] flex-shrink-0" />
            <span className="text-[12px] font-mono text-[var(--br-text-muted)]">No API key configured</span>
            <Badge variant="outline" className="text-[9px] font-mono text-amber-500/70 border-amber-500/30 ml-1">auth disabled</Badge>
          </>
        )}
      </div>
      <p className="text-[11px] font-mono text-[var(--br-text-muted)] mt-1.5">
        The key value is never exposed through the UI. Restart the server after changing the env var.
      </p>
    </SectionCard>
  );
}

function DataManagementCard() {
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'done' | 'error'>('idle');

  const handleExport = async () => {
    setExporting(true);
    setExportStatus('idle');
    try {
      const res = await fetch('/api/export');
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `boardroom-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setExportStatus('done');
      } else {
        setExportStatus('error');
      }
    } catch {
      setExportStatus('error');
    } finally {
      setExporting(false);
      setTimeout(() => setExportStatus('idle'), 3000);
    }
  };

  return (
    <SectionCard icon={Database} title="data management">
      <div className="space-y-4">
        <div>
          <p className="text-[12px] font-mono text-[var(--br-text-secondary)] mb-1">Export Data</p>
          <p className="text-[11px] font-mono text-[var(--br-text-muted)] mb-2.5">
            Download all agents, workflows, and logs as a JSON archive.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--br-bg-hover)] hover:bg-[var(--br-bg-hover)] border border-[var(--br-border)] text-[11px] font-mono text-[var(--br-text-secondary)] transition-colors disabled:opacity-50"
            >
              <Download className="w-3 h-3" />
              {exporting ? 'exporting...' : 'export data'}
            </button>
            {exportStatus === 'done' && (
              <span className="text-[11px] font-mono text-emerald-400">downloaded</span>
            )}
            {exportStatus === 'error' && (
              <span className="text-[11px] font-mono text-red-400">export failed</span>
            )}
          </div>
        </div>

        <Separator className="bg-[var(--br-border)]" />

        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-3.5 h-3.5 text-[var(--br-text-muted)] flex-shrink-0" />
            <p className="text-[12px] font-mono text-[var(--br-text-secondary)]">Agent Retention</p>
          </div>
          <p className="text-[11px] font-mono text-[var(--br-text-muted)]">
            Agents older than 30 days are auto-deleted. Active agents and those with open branches are excluded.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

function OnboardingCard() {
  const restartTour = useRestartTour();
  return (
    <SectionCard icon={HelpCircle} title="onboarding">
      <p className="text-[11px] font-mono text-[var(--br-text-muted)]">
        New here? The guided tour walks you through spawning agents, using the orchestrator chat, and exploring the rest of Boardroom.
      </p>
      <div className="mt-3">
        <button
          onClick={restartTour}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--br-bg-hover)] hover:bg-[var(--br-bg-hover)] border border-[var(--br-border)] text-[11px] font-mono text-[var(--br-text-secondary)] transition-colors"
        >
          <HelpCircle className="w-3 h-3" />
          restart tour
        </button>
      </div>
    </SectionCard>
  );
}

const BUILTIN_META = [
  { id: 'dark' as const, label: 'dark', desc: 'default dark', bg: '#18181b', accent: '#10b981', border: '#27272a' },
  { id: 'light' as const, label: 'light', desc: 'light mode', bg: '#f4f4f5', accent: '#059669', border: '#e4e4e7' },
  { id: 'midnight' as const, label: 'midnight', desc: 'deep blue', bg: '#111827', accent: '#6366f1', border: '#1e2642' },
  { id: 'emerald' as const, label: 'emerald', desc: 'green forest', bg: '#052e1c', accent: '#34d399', border: '#0d4a2e' },
];

const COLOR_FIELDS: { key: keyof import('@/components/ThemeProvider').ThemeColors; label: string }[] = [
  { key: '--br-bg-primary', label: 'Background' },
  { key: '--br-bg-secondary', label: 'Surface' },
  { key: '--br-bg-card', label: 'Card' },
  { key: '--br-bg-hover', label: 'Hover' },
  { key: '--br-border', label: 'Border' },
  { key: '--br-text-primary', label: 'Text' },
  { key: '--br-text-secondary', label: 'Text dim' },
  { key: '--br-text-muted', label: 'Text muted' },
  { key: '--br-accent', label: 'Accent' },
  { key: '--br-accent-hover', label: 'Accent hover' },
  { key: '--br-danger', label: 'Danger' },
  { key: '--br-warning', label: 'Warning' },
  { key: '--br-info', label: 'Info' },
];

function ThemeCard() {
  const { theme, setTheme, themes, cycleThemes, setCycleThemes, customThemes, saveCustomTheme, deleteCustomTheme, getThemeLabel, getThemeAccent } = useTheme();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editColors, setEditColors] = useState<import('@/components/ThemeProvider').ThemeColors>({ ...DEFAULT_COLORS });
  const [editId, setEditId] = useState<string | null>(null);

  const startNew = () => {
    setEditId(null);
    setEditName('');
    setEditColors({ ...DEFAULT_COLORS });
    setEditing(true);
  };

  const startEdit = (ct: import('@/components/ThemeProvider').CustomTheme) => {
    setEditId(ct.id);
    setEditName(ct.name);
    setEditColors({ ...ct.colors });
    setEditing(true);
  };

  const saveTheme = () => {
    const name = editName.trim() || 'custom';
    const id = editId || `custom-${Date.now()}`;
    saveCustomTheme({ id, name, colors: editColors });
    setTheme(id);
    setEditing(false);
  };

  return (
    <SectionCard icon={Palette} title="theme">
      <p className="text-[11px] font-mono text-[var(--br-text-muted)]">
        Choose a built-in theme or create your own.
      </p>

      {/* Built-in themes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        {BUILTIN_META.map(t => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={`relative flex flex-col gap-2 p-3 rounded-lg border-2 transition-all ${
              theme === t.id
                ? 'border-[var(--br-accent)]'
                : 'border-[var(--br-border)] hover:border-[var(--br-text-muted)]'
            }`}
          >
            <div className="w-full h-10 rounded-md flex items-end justify-end p-1.5" style={{ background: t.bg, border: `1px solid ${t.border}` }}>
              <span className="w-3 h-3 rounded-full" style={{ background: t.accent }} />
            </div>
            <div className="text-left">
              <p className="font-mono text-[11px] text-[var(--br-text-primary)]">{t.label}</p>
              <p className="font-mono text-[9px] text-[var(--br-text-muted)]">{t.desc}</p>
            </div>
            {theme === t.id && (
              <span className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center text-[8px] text-white" style={{ background: t.accent }}>✓</span>
            )}
          </button>
        ))}
      </div>

      {/* Custom themes */}
      {customThemes.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-mono text-[var(--br-text-muted)] uppercase tracking-wider mb-2">custom themes</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {customThemes.map(ct => (
              <div key={ct.id} className={`relative flex flex-col gap-2 p-3 rounded-lg border-2 transition-all cursor-pointer ${
                theme === ct.id ? 'border-[var(--br-accent)]' : 'border-[var(--br-border)] hover:border-[var(--br-text-muted)]'
              }`}>
                <button onClick={() => setTheme(ct.id)} className="w-full text-left">
                  <div className="w-full h-10 rounded-md flex items-end justify-end p-1.5" style={{ background: ct.colors['--br-bg-secondary'], border: `1px solid ${ct.colors['--br-border']}` }}>
                    <span className="w-3 h-3 rounded-full" style={{ background: ct.colors['--br-accent'] }} />
                  </div>
                  <p className="font-mono text-[11px] text-[var(--br-text-primary)] mt-2">{ct.name}</p>
                </button>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(ct)} className="font-mono text-[9px] text-[var(--br-text-muted)] hover:text-[var(--br-text-secondary)]">edit</button>
                  <button onClick={() => deleteCustomTheme(ct.id)} className="font-mono text-[9px] text-[var(--br-danger)] hover:underline">delete</button>
                </div>
                {theme === ct.id && (
                  <span className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center text-[8px] text-white" style={{ background: ct.colors['--br-accent'] }}>✓</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toggle cycle selector */}
      <div className="mt-4 p-3 rounded-lg border border-[var(--br-border)] bg-[var(--br-bg-secondary)]/50">
        <p className="font-mono text-[10px] text-[var(--br-text-muted)] uppercase tracking-wider mb-2">toggle cycle</p>
        <p className="font-mono text-[9px] text-[var(--br-text-muted)] mb-2">Select which themes the nav button cycles through.</p>
        <div className="flex flex-wrap gap-2">
          {themes.map(id => {
            const active = cycleThemes.includes(id);
            return (
              <button
                key={id}
                onClick={() => {
                  const next = active
                    ? cycleThemes.filter(t => t !== id)
                    : [...cycleThemes, id];
                  setCycleThemes(next.length > 0 ? next : [id]);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[10px] border transition-colors ${
                  active
                    ? 'border-[var(--br-accent)] bg-[var(--br-accent)]/10 text-[var(--br-text-primary)]'
                    : 'border-[var(--br-border)] text-[var(--br-text-muted)] hover:border-[var(--br-text-muted)]'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: getThemeAccent(id) }} />
                {getThemeLabel(id)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Create / Edit custom theme */}
      {!editing ? (
        <button onClick={startNew} className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-[var(--br-border)] hover:border-[var(--br-text-muted)] text-[11px] font-mono text-[var(--br-text-muted)] hover:text-[var(--br-text-secondary)] transition-colors">
          + create custom theme
        </button>
      ) : (
        <div className="mt-4 p-4 rounded-lg border border-[var(--br-border)] bg-[var(--br-bg-secondary)]">
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[12px] text-[var(--br-text-primary)] font-semibold">{editId ? 'edit theme' : 'new custom theme'}</p>
            <button onClick={() => setEditing(false)} className="font-mono text-[10px] text-[var(--br-text-muted)] hover:text-[var(--br-text-secondary)]">cancel</button>
          </div>

          {/* Name */}
          <div className="mb-3">
            <label className="font-mono text-[10px] text-[var(--br-text-muted)] uppercase tracking-wider">name</label>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="my theme"
              className="mt-1 w-full px-3 py-1.5 rounded-md bg-[var(--br-bg-primary)] border border-[var(--br-border)] font-mono text-[12px] text-[var(--br-text-primary)] placeholder:text-[var(--br-text-muted)] focus:outline-none focus:border-[var(--br-accent)]"
            />
          </div>

          {/* Color grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {COLOR_FIELDS.map(f => (
              <div key={f.key} className="flex items-center gap-2">
                <input
                  type="color"
                  value={editColors[f.key]}
                  onChange={e => setEditColors(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-7 h-7 rounded cursor-pointer border border-[var(--br-border)] bg-transparent"
                />
                <div>
                  <p className="font-mono text-[10px] text-[var(--br-text-secondary)]">{f.label}</p>
                  <p className="font-mono text-[8px] text-[var(--br-text-muted)]">{editColors[f.key]}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Preview strip */}
          <div className="mt-3 flex gap-1 h-8 rounded-md overflow-hidden border border-[var(--br-border)]">
            <div className="flex-1" style={{ background: editColors['--br-bg-primary'] }} />
            <div className="flex-1" style={{ background: editColors['--br-bg-secondary'] }} />
            <div className="flex-1" style={{ background: editColors['--br-bg-hover'] }} />
            <div className="flex-1" style={{ background: editColors['--br-accent'] }} />
            <div className="flex-1 flex items-center justify-center" style={{ background: editColors['--br-bg-primary'] }}>
              <span className="font-mono text-[8px]" style={{ color: editColors['--br-text-primary'] }}>Aa</span>
            </div>
          </div>

          {/* Save */}
          <button onClick={saveTheme} className="mt-3 flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-[var(--br-accent)] text-white font-mono text-[11px] font-semibold hover:opacity-90 transition-opacity">
            <Save className="w-3 h-3" />
            {editId ? 'update theme' : 'save & apply'}
          </button>
        </div>
      )}
    </SectionCard>
  );
}

export default function SettingsPage() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-[var(--br-border)] bg-[var(--br-bg-secondary)]/40">
        <SubNav tabs={[
          { label: 'setup', href: '/setup', active: false },
          { label: 'settings', href: '/settings', active: true },
          { label: 'api', href: '/api-docs', active: false },
          { label: 'branches', href: '/branches', active: false },
        ]} />
        <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--br-text-secondary)]" />
        <h1 className="font-mono text-sm text-[var(--br-text-primary)]">settings</h1>
        <Separator orientation="vertical" className="h-4" />
        <span className="text-[11px] font-mono text-[var(--br-text-muted)]">runtime configuration</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-3xl mx-auto space-y-4">
          <ThemeCard />
          <RuntimeSettingsCard />
          <ApiKeyCard />
          <DataManagementCard />
          <OnboardingCard />
        </div>
      </div>
    </div>
  );
}
