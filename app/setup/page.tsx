'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  CheckCircle2, Circle, Copy, Check, Terminal,
  GitBranch, Package, Settings, Play, AlertTriangle,
  ChevronRight, Wrench, ExternalLink, Save, RotateCcw, Eye, EyeOff,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { SubNav } from '@/components/SubNav';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1 rounded text-zinc-600 hover:text-zinc-400 transition-colors flex-shrink-0"
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="mt-1.5 rounded-md bg-zinc-950 border border-zinc-800/60 overflow-hidden">
      {label && (
        <div className="px-3 py-1 border-b border-zinc-800/60 flex items-center justify-between">
          <span className="text-[10px] font-mono text-zinc-600">{label}</span>
          <CopyButton text={code} />
        </div>
      )}
      <div className={`flex items-start gap-2 px-3 py-2 ${!label ? 'pr-2' : ''}`}>
        <pre className="flex-1 text-[12px] font-mono text-zinc-300 whitespace-pre-wrap break-all leading-relaxed">{code}</pre>
        {!label && <CopyButton text={code} />}
      </div>
    </div>
  );
}

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
    <Card className="bg-zinc-900/40 border-zinc-800">
      <CardContent className="px-5 py-4">
        <div className="flex items-center gap-2.5 mb-4">
          <Icon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          <h2 className="font-mono text-sm text-zinc-100">{title}</h2>
          {badge && (
            <Badge variant="outline" className="text-[9px] font-mono text-zinc-500 border-zinc-700 ml-1">
              {badge}
            </Badge>
          )}
        </div>
        <div className="space-y-3">{children}</div>
      </CardContent>
    </Card>
  );
}

function Requirement({
  label,
  detail,
  status,
}: {
  label: string;
  detail?: string;
  status?: 'ok' | 'warn' | 'unknown';
}) {
  const icon =
    status === 'ok' ? (
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
    ) : status === 'warn' ? (
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
    ) : (
      <Circle className="w-3.5 h-3.5 text-zinc-700 flex-shrink-0 mt-0.5" />
    );

  return (
    <div className="flex items-start gap-2.5">
      {icon}
      <div>
        <span className="text-[12px] font-mono text-zinc-200">{label}</span>
        {detail && <p className="text-[11px] font-mono text-zinc-500 mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-mono text-zinc-400 mt-0.5">
        {number}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

interface CheckResult {
  node: string | null;
  git: string | null;
  claude: string | null;
  codex: string | null;
  opencode: string | null;
  loading: boolean;
  ran: boolean;
}

const ALL_CLIS = ['claude', 'codex', 'opencode'] as const;
type CliKey = typeof ALL_CLIS[number];

const CLI_META: Record<CliKey, { label: string; desc: string; install: string }> = {
  claude: {
    label: 'Claude Code',
    desc: 'Anthropic\'s agentic CLI for code generation and orchestration.',
    install: 'npm install -g @anthropic-ai/claude-code',
  },
  codex: {
    label: 'Codex',
    desc: 'OpenAI\'s coding agent CLI. Requires an OpenAI API key.',
    install: 'npm install -g @openai/codex',
  },
  opencode: {
    label: 'OpenCode',
    desc: 'Open-source coding agent. See opencode.ai for install instructions.',
    install: 'opencode',
  },
};

function CliCard({
  cliKey,
  check,
  enabled,
  onToggle,
}: {
  cliKey: CliKey;
  check: string | null;
  enabled: boolean;
  onToggle: () => void;
}) {
  const meta = CLI_META[cliKey];
  const installed = check != null && !String(check).startsWith('unknown') && !String(check).startsWith('not found') && !String(check).startsWith('error');

  return (
    <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/70 p-3 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-[var(--br-text-muted)] uppercase tracking-wider">{cliKey}</span>
          <span className="text-[12px] font-mono text-zinc-100">{meta.label}</span>
        </div>
        <button
          onClick={onToggle}
          className={`flex-shrink-0 relative inline-flex h-4 w-7 items-center rounded-full border transition-colors ${
            enabled ? 'bg-emerald-500/80 border-emerald-500/50' : 'bg-zinc-700 border-zinc-600'
          }`}
          title={enabled ? 'Disable' : 'Enable'}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-3.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      <p className="text-[11px] font-mono text-zinc-500 leading-relaxed">{meta.desc}</p>
      {check != null ? (
        <Badge
          variant="outline"
          className={`self-start text-[10px] font-mono ${
            installed
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
              : 'bg-zinc-800 text-zinc-500 border-zinc-700'
          }`}
        >
          {installed ? `installed · ${String(check)}` : 'not found'}
        </Badge>
      ) : (
        <Badge variant="outline" className="self-start text-[10px] font-mono bg-zinc-800 text-zinc-600 border-zinc-700">
          not checked
        </Badge>
      )}
      <div className="mt-0.5 rounded-md bg-zinc-900 border border-zinc-800/60 overflow-hidden">
        <div className="flex items-center gap-2 px-2.5 py-1.5 pr-2">
          <pre className="flex-1 text-[11px] font-mono text-zinc-400 whitespace-pre-wrap break-all leading-relaxed">{meta.install}</pre>
          <CopyButton text={meta.install} />
        </div>
      </div>
    </div>
  );
}

const ENABLED_CLIS_KEY = 'boardroom:enabled-clis';

interface ConfigState {
  apiKey: string;
  apiKeySet: boolean;
  rateLimit: string;
  maxAgents: string;
  dbPath: string;
  sandboxRepo: string;
  port: string;
}

function ConfigurationCard() {
  const [cfg, setCfg] = useState<ConfigState>({
    apiKey: '',
    apiKeySet: false,
    rateLimit: '10',
    maxAgents: '20',
    dbPath: '',
    sandboxRepo: '',
    port: '7391',
  });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [loaded, setLoaded] = useState(false);

  // Load current config on mount
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then((data: { apiKeySet?: boolean; rateLimit?: number; maxAgents?: number; dbPath?: string; sandboxRepo?: string; port?: number }) => {
        setCfg({
          apiKey: '',
          apiKeySet: !!data.apiKeySet,
          rateLimit: String(data.rateLimit ?? 10),
          maxAgents: String(data.maxAgents ?? 20),
          dbPath: data.dbPath ?? '',
          sandboxRepo: data.sandboxRepo ?? '',
          port: String(data.port ?? 7391),
        });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      const body: Record<string, unknown> = {
        rateLimit: parseInt(cfg.rateLimit, 10),
        maxAgents: parseInt(cfg.maxAgents, 10),
        dbPath: cfg.dbPath,
        sandboxRepo: cfg.sandboxRepo,
        port: parseInt(cfg.port, 10),
      };
      // Only send apiKey if the user typed something in the field
      if (cfg.apiKey.trim().length > 0) {
        body.apiKey = cfg.apiKey.trim();
      }
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json() as { apiKeySet?: boolean };
        setCfg(prev => ({ ...prev, apiKey: '', apiKeySet: !!data.apiKeySet }));
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }, [cfg]);

  const handleReset = useCallback(async () => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });
      if (res.ok) {
        const data = await res.json() as { apiKeySet?: boolean; rateLimit?: number; maxAgents?: number; dbPath?: string; sandboxRepo?: string; port?: number };
        setCfg({
          apiKey: '',
          apiKeySet: !!data.apiKeySet,
          rateLimit: String(data.rateLimit ?? 10),
          maxAgents: String(data.maxAgents ?? 20),
          dbPath: data.dbPath ?? '',
          sandboxRepo: data.sandboxRepo ?? '',
          port: String(data.port ?? 7391),
        });
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }, []);

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts?: { type?: string; placeholder?: string; hint?: string; restartNote?: boolean }
  ) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-mono text-zinc-400">{label}</label>
        {opts?.restartNote && (
          <span className="text-[10px] font-mono text-amber-400/70">restart required</span>
        )}
      </div>
      <input
        type={opts?.type || 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={opts?.placeholder}
        className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-[12px] font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
      />
      {opts?.hint && <p className="text-[10px] font-mono text-zinc-600">{opts.hint}</p>}
    </div>
  );

  if (!loaded) {
    return (
      <SectionCard icon={Settings} title="configuration" badge="config file">
        <p className="text-[12px] font-mono text-zinc-500">Loading...</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard icon={Settings} title="configuration" badge="~/.boardroom/config.json">
      <p className="text-[12px] font-mono text-zinc-400">
        Settings are saved to <code className="text-zinc-300">~/.boardroom/config.json</code> and override environment variables. Env vars still work for Docker deployments.
      </p>

      {/* API Key */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-mono text-zinc-400">API Key</label>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`text-[9px] font-mono ${
                cfg.apiKeySet
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : 'bg-zinc-800 text-zinc-500 border-zinc-700'
              }`}
            >
              {cfg.apiKeySet ? 'set' : 'not set'}
            </Badge>
          </div>
        </div>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={cfg.apiKey}
            onChange={e => setCfg(prev => ({ ...prev, apiKey: e.target.value }))}
            placeholder={cfg.apiKeySet ? '(leave blank to keep existing key)' : 'Enter API key to enable auth...'}
            className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 pr-8 text-[12px] font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowKey(p => !p)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-[10px] font-mono text-zinc-600">Leave empty to disable auth (dev mode).</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {field('Rate Limit (req/min)', cfg.rateLimit, v => setCfg(p => ({ ...p, rateLimit: v })), {
          type: 'number',
          placeholder: '10',
          hint: 'Max API requests per minute. DB settings override this.',
        })}
        {field('Max Agents', cfg.maxAgents, v => setCfg(p => ({ ...p, maxAgents: v })), {
          type: 'number',
          placeholder: '20',
          hint: 'Max concurrent agents allowed. DB settings override this.',
        })}
      </div>

      {field('Database Path', cfg.dbPath, v => setCfg(p => ({ ...p, dbPath: v })), {
        placeholder: '~/.boardroom/data.db',
        hint: 'Path to the SQLite database file.',
        restartNote: true,
      })}

      {field('Sandbox Repo', cfg.sandboxRepo, v => setCfg(p => ({ ...p, sandboxRepo: v })), {
        placeholder: '~/boardroom-sandbox',
        hint: 'Default working directory for workflow agents.',
      })}

      {field('Port', cfg.port, v => setCfg(p => ({ ...p, port: v })), {
        type: 'number',
        placeholder: '7391',
        restartNote: true,
      })}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-[11px] font-mono text-zinc-300 transition-colors disabled:opacity-50"
        >
          <Save className="w-3 h-3" />
          {saving ? 'saving...' : 'save config'}
        </button>
        <button
          onClick={handleReset}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-mono text-zinc-500 transition-colors disabled:opacity-50"
        >
          <RotateCcw className="w-3 h-3" />
          reset to defaults
        </button>
        {saveStatus === 'saved' && (
          <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
            <Check className="w-3 h-3" /> saved
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-[11px] font-mono text-red-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> failed to save
          </span>
        )}
      </div>
    </SectionCard>
  );
}

export default function SetupPage() {
  const [check, setCheck] = useState<CheckResult>({
    node: null,
    git: null,
    claude: null,
    codex: null,
    opencode: null,
    loading: false,
    ran: false,
  });

  const [enabledClis, setEnabledClis] = useState<CliKey[]>([...ALL_CLIS]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(ENABLED_CLIS_KEY);
      if (stored) setEnabledClis(JSON.parse(stored) as CliKey[]);
    } catch { /* ignore */ }
  }, []);

  const toggleCli = useCallback((key: CliKey) => {
    setEnabledClis(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      try { localStorage.setItem(ENABLED_CLIS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const runCheck = useCallback(async () => {
    setCheck({ node: null, git: null, claude: null, codex: null, opencode: null, loading: true, ran: false });
    try {
      const res = await fetch('/api/setup-check');
      if (res.ok) {
        const data = await res.json();
        const parse = (v: { installed?: boolean; version?: string } | string | null) => {
          if (!v || typeof v === 'string') return v;
          if (v.installed) return v.version || 'installed';
          return 'not found';
        };
        setCheck({
          node: parse(data.node),
          git: parse(data.git),
          claude: parse(data.claude),
          codex: parse(data.codex),
          opencode: parse(data.opencode),
          loading: false,
          ran: true,
        });
      } else {
        // API doesn't exist yet — show a fallback message
        setCheck({
          node: 'unknown (API not available)',
          git: 'unknown (API not available)',
          claude: 'unknown (API not available)',
          codex: 'unknown (API not available)',
          opencode: 'unknown (API not available)',
          loading: false,
          ran: true,
        });
      }
    } catch {
      setCheck({
        node: 'unknown (check your terminal)',
        git: 'unknown (check your terminal)',
        claude: 'unknown (check your terminal)',
        codex: 'unknown (check your terminal)',
        opencode: 'unknown (check your terminal)',
        loading: false,
        ran: true,
      });
    }
  }, []);

  const statusBadge = (val: string | null) => {
    if (!val) return null;
    const str = String(val);
    const isOk = !str.startsWith('unknown') && !str.startsWith('not found') && !str.startsWith('error');
    return (
      <Badge
        variant="outline"
        className={`text-[10px] font-mono ml-2 ${
          isOk
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
            : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
        }`}
      >
        {str}
      </Badge>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <SubNav tabs={[{ label: 'setup', href: '/setup', active: true }, { label: 'settings', href: '/settings', active: false }, { label: 'api', href: '/api-docs', active: false }, { label: 'branches', href: '/branches', active: false }]} />
          <Wrench className="w-3.5 h-3.5 text-zinc-400" />
          <h1 className="font-mono text-sm text-zinc-100">setup &amp; quickstart</h1>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-[11px] font-mono text-zinc-500">get boardroom running</span>
        </div>
        <button
          onClick={runCheck}
          disabled={check.loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-[11px] font-mono text-zinc-300 transition-colors disabled:opacity-50"
        >
          <Play className="w-3 h-3" />
          {check.loading ? 'checking...' : 'check setup'}
        </button>
      </div>

      {/* Check results banner */}
      {check.ran && (
        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 bg-zinc-950 border-b border-zinc-800 overflow-x-auto">
          <span className="text-[10px] font-mono text-zinc-600 flex-shrink-0">results:</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Terminal className="w-3 h-3 text-zinc-500" />
            <span className="text-[11px] font-mono text-zinc-400">node</span>
            {statusBadge(check.node)}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <GitBranch className="w-3 h-3 text-zinc-500" />
            <span className="text-[11px] font-mono text-zinc-400">git</span>
            {statusBadge(check.git)}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Terminal className="w-3 h-3 text-zinc-500" />
            <span className="text-[11px] font-mono text-zinc-400">claude</span>
            {statusBadge(check.claude)}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Terminal className="w-3 h-3 text-zinc-500" />
            <span className="text-[11px] font-mono text-zinc-400">codex</span>
            {statusBadge(check.codex)}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Terminal className="w-3 h-3 text-zinc-500" />
            <span className="text-[11px] font-mono text-zinc-400">opencode</span>
            {statusBadge(check.opencode)}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-3xl mx-auto space-y-4">

          {/* Configuration */}
          <ConfigurationCard />

          {/* System Requirements */}
          <SectionCard icon={Settings} title="system requirements">
            <Requirement
              label="Node.js 20+"
              detail="Required for native modules and modern JS features."
            />
            <Requirement
              label="Git"
              detail="Used for worktrees and agent branch isolation."
            />
            <Requirement
              label="macOS or Linux"
              detail="Windows is not tested. WSL2 may work but is unsupported."
            />
            <Requirement
              label="Claude Code CLI installed and authenticated"
              detail="Run `claude --version` to verify."
            />
          </SectionCard>

          {/* Agent CLIs */}
          <SectionCard icon={Terminal} title="agent clis" badge="configure">
            <p className="text-[12px] font-mono text-zinc-400">
              Select which agent CLIs are enabled. Boardroom will only spawn agents for CLIs you have toggled on.
            </p>
            <div className="grid grid-cols-3 gap-4 mt-1">
              {ALL_CLIS.map(key => (
                <CliCard
                  key={key}
                  cliKey={key}
                  check={check.ran ? (check[key as keyof CheckResult] as string | null) : null}
                  enabled={enabledClis.includes(key)}
                  onToggle={() => toggleCli(key)}
                />
              ))}
            </div>
          </SectionCard>

          {/* Claude Code Setup */}
          <SectionCard icon={Terminal} title="claude code setup" badge="required">
            <Step number={1}>
              <p className="text-[12px] font-mono text-zinc-300 mb-1">Install the CLI</p>
              <CodeBlock code="npm install -g @anthropic-ai/claude-code" />
            </Step>
            <Step number={2}>
              <p className="text-[12px] font-mono text-zinc-300 mb-1">Authenticate with your Anthropic account</p>
              <CodeBlock code="claude login" />
            </Step>
            <Step number={3}>
              <p className="text-[12px] font-mono text-zinc-300 mb-1">Verify the install</p>
              <CodeBlock code="claude --version" />
            </Step>
            <div className="flex items-start gap-2 mt-1 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] font-mono text-amber-300/80">
                Claude Max or Pro subscription required for running agents. Free tier does not support the agent API.
              </p>
            </div>
          </SectionCard>

          {/* Git Configuration */}
          <SectionCard icon={GitBranch} title="git configuration" badge="required">
            <p className="text-[12px] font-mono text-zinc-400">
              Each agent gets its own git worktree branch for isolation. Your repo must be a git repository with a clean working tree before spawning agents.
            </p>
            <div className="space-y-2 mt-1">
              <Requirement
                label="Initialize git in your target repos"
                detail="Run `git init` if a repo doesn't have git set up yet."
              />
              <Requirement
                label="Commit or stash any uncommitted changes"
                detail="Worktree creation fails if the working tree is dirty."
              />
              <Requirement
                label="Have at least one commit on the base branch"
                detail="Git needs a HEAD commit to branch from."
              />
            </div>
            <CodeBlock code={`# Quick check
git status
git log --oneline -5`} label="verify your repo" />
          </SectionCard>

          {/* Optional: Codex CLI */}
          <SectionCard icon={Package} title="optional: codex cli" badge="optional">
            <p className="text-[12px] font-mono text-zinc-400">
              Enables the <span className="text-zinc-200">codex</span> agent type. Requires an OpenAI API key.
            </p>
            <Step number={1}>
              <p className="text-[12px] font-mono text-zinc-300 mb-1">Install</p>
              <CodeBlock code="npm install -g @openai/codex" />
            </Step>
            <Step number={2}>
              <p className="text-[12px] font-mono text-zinc-300 mb-1">Set your API key</p>
              <CodeBlock code="export OPENAI_API_KEY=sk-..." />
            </Step>
          </SectionCard>

          {/* Optional: OpenCode CLI */}
          <SectionCard icon={Package} title="optional: opencode cli" badge="optional">
            <p className="text-[12px] font-mono text-zinc-400">
              Enables the <span className="text-zinc-200">opencode</span> agent type.
            </p>
            <div className="flex items-center gap-2 mt-1">
              <ExternalLink className="w-3 h-3 text-zinc-500" />
              <a
                href="https://opencode.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-mono text-blue-400 hover:text-blue-300 transition-colors"
              >
                opencode.ai
              </a>
              <span className="text-[11px] font-mono text-zinc-600">— follow install instructions there</span>
            </div>
          </SectionCard>

          {/* Running Boardroom */}
          <SectionCard icon={Play} title="running boardroom">
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1.5">development</p>
                <CodeBlock code="npm run dev" label="starts on port 7391" />
              </div>
              <div>
                <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1.5">production</p>
                <CodeBlock code="npm run build && npm start" label="build then serve" />
              </div>
              <div>
                <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1.5">docker</p>
                <CodeBlock code="docker compose up -d" label="detached mode" />
              </div>
            </div>
          </SectionCard>

          {/* Environment Variables */}
          <SectionCard icon={Settings} title="environment variables">
            <div className="space-y-2.5">
              {[
                {
                  key: 'DB_PATH',
                  type: 'string',
                  default: '.boardroom.db',
                  desc: 'Path to the SQLite database file.',
                },
                {
                  key: 'PORT',
                  type: 'number',
                  default: '3000 (prod) / 7391 (dev)',
                  desc: 'HTTP server port.',
                },
                {
                  key: 'BOARDROOM_API_KEY',
                  type: 'string',
                  default: 'empty (no auth)',
                  desc: 'API key for request authentication. Leave empty to disable auth.',
                },
                {
                  key: 'ANTHROPIC_API_KEY',
                  type: 'string',
                  default: 'none',
                  desc: 'Anthropic API key for orchestrator CLI calls.',
                },
                {
                  key: 'WORKFLOW_SANDBOX_REPO',
                  type: 'string',
                  default: 'none',
                  desc: 'Path to a sandbox repo used as the default working directory for workflow agents.',
                },
                {
                  key: 'BOARDROOM_RATE_LIMIT',
                  type: 'number',
                  default: '10',
                  desc: 'Max chat/agent-spawn requests per minute per IP. Overridden by DB settings.',
                },
                {
                  key: 'BOARDROOM_MAX_AGENTS',
                  type: 'number',
                  default: '20',
                  desc: 'Max concurrent agents allowed. Overridden by DB settings.',
                },
              ].map(({ key, type, default: def, desc }) => (
                <div key={key} className="flex items-start gap-3">
                  <code className="text-[12px] font-mono text-emerald-300/90 flex-shrink-0 min-w-[200px] mt-0.5">{key}</code>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[9px] font-mono border-zinc-700 text-zinc-500">{type}</Badge>
                      <span className="text-[10px] font-mono text-zinc-600">default: {def}</span>
                    </div>
                    <p className="text-[11px] font-mono text-zinc-500 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <CodeBlock
              code={`# .env.local
DB_PATH=.boardroom.db
PORT=7391
BOARDROOM_API_KEY=
ANTHROPIC_API_KEY=sk-ant-...
WORKFLOW_SANDBOX_REPO=/path/to/sandbox-repo
BOARDROOM_RATE_LIMIT=10
BOARDROOM_MAX_AGENTS=20`}
              label=".env.local example"
            />
          </SectionCard>

          {/* First Steps */}
          <SectionCard icon={ChevronRight} title="first steps">
            <Step number={1}>
              <p className="text-[12px] font-mono text-zinc-200">Open the workspace</p>
              <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
                Navigate to <span className="text-zinc-300">/workspace</span> and browse to a repo you want agents to work in.
              </p>
            </Step>
            <Step number={2}>
              <p className="text-[12px] font-mono text-zinc-200">Try the orchestrator</p>
              <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
                In the left chat panel, type something like:
              </p>
              <div className="mt-1.5 rounded-md bg-zinc-950 border border-zinc-800/60 px-3 py-2">
                <span className="text-[12px] font-mono text-zinc-300 italic">
                  &quot;spawn an agent to review this codebase&quot;
                </span>
              </div>
            </Step>
            <Step number={3}>
              <p className="text-[12px] font-mono text-zinc-200">Create a workflow</p>
              <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
                Go to <span className="text-zinc-300">/workflows</span> and create a multi-agent workflow with preset configurations.
              </p>
            </Step>
            <Step number={4}>
              <p className="text-[12px] font-mono text-zinc-200">Use Cmd+K to navigate</p>
              <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
                The command palette lets you jump to any page or trigger quick actions without touching the nav.
              </p>
            </Step>
          </SectionCard>

        </div>
      </div>
    </div>
  );
}
