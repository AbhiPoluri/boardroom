'use client';

import { useState, useEffect, useCallback } from 'react';
import { GitBranch, GitCommit, FileCode, FilePlus, FileX, FileDiff, ChevronDown, ChevronRight, Merge, Download } from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import type { GitInfo, ChangedFile, CommitInfo } from '@/lib/worktree';

interface GitPanelProps {
  agentId: string;
  isActive: boolean;
}

const STATUS_ICONS: Record<ChangedFile['status'], typeof FilePlus> = {
  added: FilePlus,
  modified: FileDiff,
  deleted: FileX,
  renamed: FileCode,
};

const STATUS_COLORS: Record<ChangedFile['status'], string> = {
  added: 'text-green-400',
  modified: 'text-amber-400',
  deleted: 'text-red-400',
  renamed: 'text-blue-400',
};

export function GitPanel({ agentId, isActive }: GitPanelProps) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [showCommits, setShowCommits] = useState(true);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchGitInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/git`);
      if (!res.ok) { setInfo(null); return; }
      const data = await res.json();
      setInfo(data.git || null);
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const fetchDiff = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/git?diff=1`);
      if (!res.ok) return;
      const data = await res.json();
      setDiff(data.diff || null);
    } catch {}
  };

  useEffect(() => {
    fetchGitInfo();
    if (isActive) {
      const interval = setInterval(fetchGitInfo, 10000);
      return () => clearInterval(interval);
    }
  }, [agentId, isActive, fetchGitInfo]);

  const handleMerge = async () => {
    if (!confirm(`Merge this agent's branch into ${info?.baseBranch || 'main'}?`)) return;
    setMerging(true);
    setMergeResult(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', baseBranch: info?.baseBranch || 'main' }),
      });
      const result = await res.json();
      setMergeResult(result);
      if (result.success) fetchGitInfo();
    } catch {
      setMergeResult({ success: false, message: 'Request failed' });
    } finally {
      setMerging(false);
    }
  };

  const handleDownloadPatch = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'patch' }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${info?.branch || 'agent'}.patch`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  if (loading) {
    return (
      <div className="border-b border-zinc-800 bg-zinc-900/30 px-6 py-3">
        <div className="text-xs font-mono text-zinc-600 animate-pulse">loading git info...</div>
      </div>
    );
  }

  if (!info?.isGit) return null;

  const totalChanges = info.changedFiles?.length || 0;
  const totalAdditions = info.changedFiles?.reduce((s, f) => s + (f.additions || 0), 0) || 0;
  const totalDeletions = info.changedFiles?.reduce((s, f) => s + (f.deletions || 0), 0) || 0;

  return (
    <div className="border-b border-zinc-800 bg-zinc-900/30">
      {/* Branch + summary bar */}
      <div className="px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm font-mono">
            <GitBranch className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-purple-300">{info.branch}</span>
          </div>
          {info.baseBranch && (
            <span className="text-[10px] font-mono text-zinc-600">
              from {info.baseBranch}
            </span>
          )}
          {info.aheadBy !== undefined && info.aheadBy > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-950/50 text-purple-400 border border-purple-900/50">
              {info.aheadBy} commit{info.aheadBy !== 1 ? 's' : ''} ahead
            </span>
          )}
          {totalChanges > 0 && (
            <span className="text-[10px] font-mono text-zinc-500">
              {totalChanges} file{totalChanges !== 1 ? 's' : ''}
              {totalAdditions > 0 && <span className="text-green-400 ml-1">+{totalAdditions}</span>}
              {totalDeletions > 0 && <span className="text-red-400 ml-1">-{totalDeletions}</span>}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isActive && info.aheadBy && info.aheadBy > 0 && (
            <>
              <button
                onClick={handleDownloadPatch}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-zinc-500 hover:text-zinc-300 border border-zinc-800 rounded hover:border-zinc-600 transition-colors"
              >
                <Download className="w-3 h-3" />
                patch
              </button>
              <button
                onClick={handleMerge}
                disabled={merging}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-purple-400 hover:text-purple-300 border border-purple-900/50 rounded hover:border-purple-700 transition-colors disabled:opacity-50"
              >
                <Merge className="w-3 h-3" />
                {merging ? 'merging...' : `merge into ${info.baseBranch || 'main'}`}
              </button>
            </>
          )}
          <button
            onClick={() => {
              setShowDiff(d => !d);
              if (!diff) fetchDiff();
            }}
            className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
              showDiff ? 'text-amber-400 border-amber-900/50 bg-amber-950/30' : 'text-zinc-600 border-zinc-800 hover:text-zinc-400'
            }`}
          >
            diff
          </button>
        </div>
      </div>

      {mergeResult && (
        <div className={`mx-6 mb-2 px-3 py-2 rounded text-xs font-mono border ${
          mergeResult.success
            ? 'bg-green-950/30 border-green-900 text-green-400'
            : 'bg-red-950/30 border-red-900 text-red-400'
        }`}>
          {mergeResult.message}
        </div>
      )}

      {/* Changed files */}
      {info.changedFiles && info.changedFiles.length > 0 && (
        <div className="px-6 pb-2">
          <button
            onClick={() => setShowFiles(f => !f)}
            className="flex items-center gap-1 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 mb-1"
          >
            {showFiles ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            changed files ({info.changedFiles.length})
          </button>
          {showFiles && (
            <div className="ml-1 space-y-0.5">
              {info.changedFiles.map((file) => {
                const Icon = STATUS_ICONS[file.status];
                const color = STATUS_COLORS[file.status];
                return (
                  <div key={file.path} className="flex items-center gap-2 text-[11px] font-mono">
                    <Icon className={`w-3 h-3 ${color}`} />
                    <span className="text-zinc-400 truncate">{file.path}</span>
                    {(file.additions !== undefined || file.deletions !== undefined) && (
                      <span className="text-zinc-600 flex-shrink-0">
                        {file.additions !== undefined && <span className="text-green-500">+{file.additions}</span>}
                        {file.deletions !== undefined && <span className="text-red-500 ml-1">-{file.deletions}</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Recent commits */}
      {info.recentCommits && info.recentCommits.length > 0 && (
        <div className="px-6 pb-2">
          <button
            onClick={() => setShowCommits(c => !c)}
            className="flex items-center gap-1 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 mb-1"
          >
            {showCommits ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            commits ({info.recentCommits.length})
          </button>
          {showCommits && (
            <div className="ml-1 space-y-1">
              {info.recentCommits.map((commit) => (
                <div key={commit.hash} className="flex items-start gap-2 text-[11px] font-mono">
                  <GitCommit className="w-3 h-3 text-zinc-600 mt-0.5 flex-shrink-0" />
                  <span className="text-zinc-600">{commit.hash}</span>
                  <span className="text-zinc-300 truncate">{commit.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Diff viewer */}
      {showDiff && (
        <div className="mx-6 mb-3 max-h-96 overflow-auto">
          {diff ? (
            <DiffViewer diff={diff} />
          ) : (
            <div className="p-3 text-xs font-mono text-zinc-600 italic bg-black rounded-lg border border-zinc-800">
              {isActive ? 'agent still running — diff may be incomplete' : 'no changes'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact git badge for agent cards */
export function GitBadge({ agentId }: { agentId: string }) {
  const [info, setInfo] = useState<GitInfo | null>(null);

  useEffect(() => {
    fetch(`/api/agents/${agentId}/git`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.git?.isGit) setInfo(data.git); })
      .catch(() => {});
  }, [agentId]);

  if (!info?.isGit) return null;

  const fileCount = info.changedFiles?.length || 0;

  return (
    <div className="flex items-center gap-1 text-[10px] font-mono text-purple-400/70" title={`Branch: ${info.branch}`}>
      <GitBranch className="w-2.5 h-2.5" />
      <span className="truncate max-w-[80px]">{info.branch?.replace('boardroom/', '')}</span>
      {fileCount > 0 && (
        <span className="text-zinc-600">{fileCount}f</span>
      )}
    </div>
  );
}
