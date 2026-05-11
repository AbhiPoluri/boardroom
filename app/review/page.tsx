'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  GitPullRequest, X, RefreshCw, GitMerge, FileCode, Search, ExternalLink,
  AlertTriangle, GitBranch, RotateCcw,
} from 'lucide-react';
import { DiffViewer } from '@/components/DiffViewer';
import { toast } from '@/lib/toast';

interface PushRequest {
  id: string;
  agent_id: string;
  agent_name: string;
  branch: string;
  base_branch: string;
  summary: string;
  changed_files_json: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewer_comment: string | null;
  created_at: number;
  reviewed_at: number | null;
  resolver_agent_id?: string | null;
  project_id?: string | null;
  project_name?: string | null;
}

interface PRWithDiff extends PushRequest {
  diff: string | null;
  worktree_path?: string | null;
  repo?: string | null;
  resolver_status?: string | null;
}

const STATUS_TINT: Record<string, string> = {
  pending: 'var(--clay)',
  approved: 'var(--moss)',
  rejected: 'var(--brick)',
};

export default function ReviewPage() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get('id');

  const [requests, setRequests] = useState<PushRequest[]>([]);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [diffs, setDiffs] = useState<Record<string, PRWithDiff>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      if (scope === 'all') params.set('project', 'all');
      const url = `/api/push-requests${params.toString() ? `?${params}` : ''}`;
      const r = await fetch(url);
      const d = await r.json();
      setRequests(d.requests || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filter, scope]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  // Auto-select something on first load if nothing focused yet.
  useEffect(() => {
    if (!selectedId && requests.length > 0) setSelectedId(requests[0].id);
  }, [requests, selectedId]);

  // Load diff lazily when a PR is selected.
  useEffect(() => {
    if (selectedId && !diffs[selectedId]) {
      fetch(`/api/push-requests?id=${selectedId}&diff=1`)
        .then(r => r.ok ? r.json() : null)
        .then((d: PRWithDiff | null) => {
          if (d) setDiffs(prev => ({ ...prev, [selectedId]: d }));
        })
        .catch(() => {});
    }
  }, [selectedId, diffs]);

  const filteredAndSearched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter(r =>
      r.summary.toLowerCase().includes(q) ||
      r.agent_name.toLowerCase().includes(q) ||
      r.branch.toLowerCase().includes(q),
    );
  }, [requests, search]);

  // Group by relative-time bucket for the list.
  const grouped = useMemo(() => {
    const today: PushRequest[] = [];
    const week: PushRequest[] = [];
    const earlier: PushRequest[] = [];
    const now = Date.now();
    for (const r of filteredAndSearched) {
      const age = now - r.created_at;
      if (age < 24 * 60 * 60_000) today.push(r);
      else if (age < 7 * 24 * 60 * 60_000) week.push(r);
      else earlier.push(r);
    }
    return { today, week, earlier };
  }, [filteredAndSearched]);

  const selected = selectedId ? requests.find(r => r.id === selectedId) ?? null : null;
  const selectedDiff = selectedId ? diffs[selectedId] ?? null : null;

  const review = async (id: string, action: 'approve' | 'reject' | 'revert', comment?: string) => {
    setBusy(id);
    try {
      const r = await fetch('/api/push-requests', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action, comment }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || `${action} failed`); return; }
      if (d.conflict) toast.info(`merge conflict — spawned resolver ${d.resolver}`);
      else if (action === 'approve') toast.success('approved + merged');
      else if (action === 'revert') toast.success(d.message || `reverted ${d.revertCommit?.slice(0, 7) ?? ''}`);
      else toast.success('rejected');
      refresh();
    } finally { setBusy(null); }
  };

  const toggleBatch = (id: string) => {
    setBatchSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearBatch = () => setBatchSelected(new Set());

  const batchPendingIds = useMemo(
    () => requests.filter(r => r.status === 'pending').map(r => r.id),
    [requests],
  );
  const allBatchSelected = batchPendingIds.length > 0 && batchPendingIds.every(id => batchSelected.has(id));

  const selectAllBatch = () => {
    setBatchSelected(allBatchSelected ? new Set() : new Set(batchPendingIds));
  };

  const runBatch = async (action: 'approve' | 'reject') => {
    if (batchSelected.size === 0) return;
    setBatchBusy(true);
    let ok = 0, fail = 0, conflicts = 0;
    // Sequential — merges share the parent repo's HEAD, so we can't parallelize.
    for (const id of batchSelected) {
      try {
        const r = await fetch('/api/push-requests', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, action }),
        });
        const d = await r.json();
        if (!r.ok) fail++;
        else if (d.conflict) conflicts++;
        else ok++;
      } catch { fail++; }
    }
    const parts: string[] = [];
    if (ok > 0) parts.push(`${ok} ${action}d`);
    if (conflicts > 0) parts.push(`${conflicts} conflicted (resolver running)`);
    if (fail > 0) parts.push(`${fail} failed`);
    if (parts.length === 0) parts.push('nothing happened');
    if (fail > 0) toast.error(parts.join(' · '));
    else toast.success(parts.join(' · '));
    clearBatch();
    setBatchBusy(false);
    refresh();
  };

  return (
    <div className="brr-os-review-page">
      <aside className="brr-os-review-list" data-tour="review-queue">
        <div className="brr-os-review-list-head">
          <span className="brr-os-pane-title">
            <GitPullRequest className="w-3 h-3" strokeWidth={1.75} /> review
          </span>
          <button
            type="button"
            className="brr-os-review-scope-toggle"
            onClick={() => setScope(s => s === 'active' ? 'all' : 'active')}
            title={scope === 'active' ? 'showing active project — click to see all' : 'showing all projects — click to scope to active'}
          >
            {scope === 'active' ? 'project' : 'all projects'}
          </button>
          <span className="brr-os-pane-count">{filteredAndSearched.length}</span>
        </div>
        <div className="brr-os-review-filter">
          {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`brr-os-review-filter-pill ${filter === f ? 'is-on' : ''}`}
            >{f}</button>
          ))}
        </div>
        <div className="brr-os-review-search">
          <Search className="w-3 h-3" strokeWidth={1.5} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="filter…"
          />
        </div>

        <div className="brr-os-review-list-body">
          {loading ? (
            <div className="brr-os-empty" style={{ padding: 24 }}>loading…</div>
          ) : filteredAndSearched.length === 0 ? (
            <div className="brr-os-empty" style={{ padding: 24, flexDirection: 'column' }}>
              <GitPullRequest className="w-4 h-4" strokeWidth={1.5} />
              <span style={{ marginTop: 6 }}>
                {filter === 'pending' ? 'all caught up' : `no ${filter} PRs`}
              </span>
            </div>
          ) : (
            <>
              {grouped.today.length > 0 && (
                <PRGroup label="today" items={grouped.today} selectedId={selectedId} onSelect={setSelectedId} batchSelected={batchSelected} onToggleBatch={toggleBatch} showProject={scope === 'all'} />
              )}
              {grouped.week.length > 0 && (
                <PRGroup label="this week" items={grouped.week} selectedId={selectedId} onSelect={setSelectedId} batchSelected={batchSelected} onToggleBatch={toggleBatch} showProject={scope === 'all'} />
              )}
              {grouped.earlier.length > 0 && (
                <PRGroup label="earlier" items={grouped.earlier} selectedId={selectedId} onSelect={setSelectedId} batchSelected={batchSelected} onToggleBatch={toggleBatch} showProject={scope === 'all'} />
              )}
            </>
          )}
        </div>

        <div className="brr-os-review-list-foot">
          {batchSelected.size > 0 ? (
            <div className="brr-os-review-batch">
              <span className="brr-os-review-batch-count">{batchSelected.size} selected</span>
              <button
                type="button"
                className="brr-btn brr-btn--primary"
                disabled={batchBusy}
                onClick={() => runBatch('approve')}
              >
                {batchBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3" strokeWidth={1.75} />}
                approve all
              </button>
              <button
                type="button"
                className="brr-btn brr-btn--ghost"
                disabled={batchBusy}
                onClick={() => runBatch('reject')}
              >
                <X className="w-3 h-3" strokeWidth={1.75} /> reject all
              </button>
              <button type="button" className="brr-btn brr-btn--ghost" onClick={clearBatch} disabled={batchBusy}>
                clear
              </button>
            </div>
          ) : (
            <>
              {batchPendingIds.length > 1 && (
                <button type="button" className="brr-btn brr-btn--ghost" onClick={selectAllBatch}>
                  select all pending
                </button>
              )}
              <button type="button" className="brr-btn brr-btn--ghost" onClick={refresh}>
                <RefreshCw className="w-3 h-3" strokeWidth={1.5} /> refresh
              </button>
            </>
          )}
        </div>
      </aside>

      <main className="brr-os-review-detail">
        {!selected ? (
          <div className="brr-os-empty" style={{ padding: 64, flexDirection: 'column' }}>
            <GitPullRequest className="w-5 h-5" strokeWidth={1.5} />
            <span style={{ marginTop: 12 }}>select a PR from the left to review</span>
          </div>
        ) : (
          <ReviewDetail
            pr={selected}
            diff={selectedDiff}
            busy={busy === selected.id}
            onApprove={() => review(selected.id, 'approve')}
            onReject={() => {
              const comment = prompt('Reject reason (optional):') ?? undefined;
              review(selected.id, 'reject', comment);
            }}
            onRevert={() => {
              if (!confirm(`Revert merge of ${selected.branch}? This will create a revert commit on ${selected.base_branch}.`)) return;
              review(selected.id, 'revert');
            }}
          />
        )}
      </main>
    </div>
  );
}

function PRGroup({
  label, items, selectedId, onSelect, batchSelected, onToggleBatch, showProject,
}: {
  label: string;
  items: PushRequest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  batchSelected: Set<string>;
  onToggleBatch: (id: string) => void;
  showProject?: boolean;
}) {
  return (
    <div className="brr-os-review-group">
      <div className="brr-os-review-group-label">{label}</div>
      {items.map(pr => {
        const files: string[] = pr.changed_files_json ? safeParse(pr.changed_files_json) : [];
        const isOn = pr.id === selectedId;
        const isChecked = batchSelected.has(pr.id);
        const canBatch = pr.status === 'pending';
        return (
          <div
            key={pr.id}
            className={`brr-os-review-row ${isOn ? 'is-on' : ''}`}
            data-status={pr.status}
            title={pr.summary}
            onClick={() => onSelect(pr.id)}
            role="button"
            tabIndex={0}
          >
            {canBatch && (
              <input
                type="checkbox"
                className="brr-os-review-row-check"
                checked={isChecked}
                onChange={() => onToggleBatch(pr.id)}
                onClick={e => e.stopPropagation()}
                aria-label={`select ${pr.agent_name}'s PR for batch action`}
              />
            )}
            <span className="brr-os-review-row-band" />
            <div className="brr-os-review-row-body">
              <div className="brr-os-review-row-top">
                <span className="brr-os-review-row-author">{pr.agent_name}</span>
                <span
                  className="brr-os-review-row-status"
                  style={{ color: STATUS_TINT[pr.status] }}
                >
                  {pr.status}
                </span>
              </div>
              <div className="brr-os-review-row-summary">{pr.summary}</div>
              <div className="brr-os-review-row-meta">
                {showProject && pr.project_name && (
                  <>
                    <span className="brr-os-review-row-project">{pr.project_name}</span>
                    {' · '}
                  </>
                )}
                {files.length} file{files.length === 1 ? '' : 's'} · {relTime(pr.created_at)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReviewDetail({
  pr, diff, busy, onApprove, onReject, onRevert,
}: {
  pr: PushRequest;
  diff: PRWithDiff | null;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRevert: () => void;
}) {
  const files: string[] = pr.changed_files_json ? safeParse(pr.changed_files_json) : [];
  return (
    <>
      <div className="brr-os-review-detail-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <span
            className="brr-os-review-detail-status"
            style={{ color: STATUS_TINT[pr.status] }}
          >{pr.status}</span>
          <Link
            href={`/agents/${pr.agent_id}`}
            className="brr-os-review-detail-author"
            title={`Open ${pr.agent_name}'s session`}
          >
            {pr.agent_name}
            <ExternalLink className="w-3 h-3" strokeWidth={1.75} style={{ marginLeft: 4, opacity: 0.5 }} />
          </Link>
          <span className="brr-os-review-detail-branch">
            {pr.branch} <span style={{ color: 'var(--fg-faint)', margin: '0 4px' }}>→</span> {pr.base_branch}
          </span>
        </div>
        {pr.status === 'pending' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="brr-btn brr-btn--ghost"
              disabled={busy}
              onClick={onReject}
            >
              <X className="w-3 h-3" strokeWidth={1.75} /> reject
            </button>
            <button
              type="button"
              className="brr-btn brr-btn--primary"
              disabled={busy}
              onClick={onApprove}
            >
              {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3" strokeWidth={1.75} />}
              approve & merge
            </button>
          </div>
        )}
        {pr.status === 'approved' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="brr-btn brr-btn--ghost"
              disabled={busy}
              onClick={onRevert}
              title={`Revert merge of ${pr.branch} from ${pr.base_branch}`}
            >
              {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" strokeWidth={1.75} />}
              revert
            </button>
          </div>
        )}
      </div>

      <div className="brr-os-review-detail-summary">{pr.summary}</div>

      {pr.resolver_agent_id && (
        <ResolverBanner
          prId={pr.id}
          resolverId={pr.resolver_agent_id}
          status={diff?.resolver_status ?? null}
        />
      )}

      {files.length > 0 && (
        <div className="brr-os-review-detail-files">
          {files.map(f => {
            // Worktree path tells us where on disk this PR's branch lives.
            // If the worktree is gone (orphaned PR), fall back to plain text.
            const base = diff?.worktree_path || diff?.repo || null;
            const abs = base ? `${base}/${f}` : null;
            const editorHref = abs ? `vscode://file/${abs}` : null;
            return editorHref ? (
              <a
                key={f}
                href={editorHref}
                className="brr-os-review-pr-file is-link"
                title={`Open ${abs} in VS Code / Cursor`}
              >
                <FileCode className="w-3 h-3" strokeWidth={1.5} />
                {f}
              </a>
            ) : (
              <span key={f} className="brr-os-review-pr-file">
                <FileCode className="w-3 h-3" strokeWidth={1.5} />
                {f}
              </span>
            );
          })}
        </div>
      )}

      {pr.reviewer_comment && (
        <div className="brr-os-review-pr-comment">
          <span className="brr-os-eyebrow">reviewer comment</span>
          <p>{pr.reviewer_comment}</p>
        </div>
      )}

      <div className="brr-os-review-detail-diff">
        {diff?.diff
          ? <DiffViewer diff={diff.diff} />
          : diff
            ? <div className="brr-os-empty" style={{ padding: 32 }}>no diff captured (worktree may be cleaned up)</div>
            : <div className="brr-os-empty" style={{ padding: 32 }}>loading diff…</div>}
      </div>
    </>
  );
}

function ResolverBanner({ prId, resolverId, status }: { prId: string; resolverId: string; status: string | null }) {
  // The PR row carries the resolver_agent_id once a conflict resolver has
  // been spawned. We surface its live status (via the PR detail fetch which
  // joins the agent row) so a stuck resolver doesn't silently strand the PR.
  // `done_unverified` = resolver exited cleanly but the canonical merge
  // commit isn't on the base branch — model said it merged but didn't.
  const inFlight = status === 'spawning' || status === 'running';
  const failed = status === 'error' || status === 'killed';
  const succeeded = status === 'done';
  const unverified = status === 'done_unverified';
  const [retrying, setRetrying] = useState(false);

  let tone = 'pending';
  let label = 'merge conflict — resolver running';
  let Icon = RefreshCw;
  let spin = true;

  if (failed) {
    tone = 'failed';
    label = 'resolver exited without resolving — needs manual intervention';
    Icon = AlertTriangle;
    spin = false;
  } else if (unverified) {
    tone = 'failed';
    label = 'resolver finished but no merge commit landed on base — verify manually or retry';
    Icon = AlertTriangle;
    spin = false;
  } else if (succeeded) {
    tone = 'done';
    label = 'conflicts resolved by merge-resolver';
    Icon = GitBranch;
    spin = false;
  } else if (!inFlight && !status) {
    label = 'resolver spawning…';
  }

  const onRetry = async () => {
    setRetrying(true);
    try {
      const r = await fetch('/api/push-requests', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: prId, action: 'retry_resolver' }),
      });
      const d = await r.json();
      if (!r.ok) toast.error(d.error || 'retry failed');
      else if (d.conflict) toast.info(`re-spawned resolver ${d.resolver}`);
      else toast.success(d.message || 'merged on retry');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="brr-os-review-resolver" data-tone={tone}>
      <Icon className={`w-3 h-3 ${spin ? 'animate-spin' : ''}`} strokeWidth={1.75} />
      <span>{label}</span>
      {(failed || unverified) && (
        <button
          type="button"
          className="brr-btn brr-btn--ghost"
          disabled={retrying}
          onClick={onRetry}
          style={{ marginLeft: 8 }}
        >
          <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          retry
        </button>
      )}
      <Link href={`/agents/${resolverId}`} className="brr-os-review-resolver-link">
        view agent <ExternalLink className="w-3 h-3" strokeWidth={1.75} />
      </Link>
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
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 60 / 60_000)}h ago`;
  return `${Math.floor(diff / 24 / 60 / 60_000)}d ago`;
}
