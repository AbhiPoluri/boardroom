'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, GitCommit, FileText, FilePlus, FileX, FilePen,
  ChevronDown, ChevronRight, RefreshCw, GitMerge, Download,
  Eye, Bot, CheckCircle2, XCircle, Clock, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions?: number;
  deletions?: number;
}

interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

interface BranchInfo {
  agentId: string;
  agentName: string;
  agentStatus: string;
  repo: string | null;
  worktreePath: string | null;
  isGit: boolean;
  branch?: string;
  baseBranch?: string;
  aheadBy?: number;
  changedFiles?: ChangedFile[];
  recentCommits?: CommitInfo[];
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  running: <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />,
  done: <CheckCircle2 className="w-3 h-3 text-emerald-400" />,
  error: <XCircle className="w-3 h-3 text-red-400" />,
  killed: <XCircle className="w-3 h-3 text-red-400" />,
  idle: <Clock className="w-3 h-3 text-zinc-500" />,
  spawning: <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />,
};

const FILE_STATUS_ICON: Record<string, React.ReactNode> = {
  added: <FilePlus className="w-3.5 h-3.5 text-emerald-400" />,
  modified: <FilePen className="w-3.5 h-3.5 text-amber-400" />,
  deleted: <FileX className="w-3.5 h-3.5 text-red-400" />,
  renamed: <FileText className="w-3.5 h-3.5 text-blue-400" />,
};

const FILE_STATUS_COLOR: Record<string, string> = {
  added: 'text-emerald-400',
  modified: 'text-amber-400',
  deleted: 'text-red-400',
  renamed: 'text-blue-400',
};

function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <pre className="text-[11px] font-mono leading-relaxed overflow-x-auto max-h-[500px] overflow-y-auto">
      {lines.map((line, i) => {
        let cls = 'text-zinc-500';
        let bg = '';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          cls = 'text-emerald-400';
          bg = 'bg-emerald-500/5';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          cls = 'text-red-400';
          bg = 'bg-red-500/5';
        } else if (line.startsWith('@@')) {
          cls = 'text-blue-400';
          bg = 'bg-blue-500/5';
        } else if (line.startsWith('diff ') || line.startsWith('index ')) {
          cls = 'text-zinc-600';
        }
        return (
          <div key={i} className={`px-3 ${bg}`}>
            <span className={cls}>{line}</span>
          </div>
        );
      })}
    </pre>
  );
}

function BranchCard({
  branch,
  isSelected,
  onSelect,
}: {
  branch: BranchInfo;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const totalChanges = (branch.changedFiles || []).reduce(
    (sum, f) => sum + (f.additions || 0) + (f.deletions || 0),
    0
  );

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-3 rounded-lg transition-all ${
        isSelected
          ? 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700'
          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-300'
      }`}
    >
      <div className="flex items-center gap-2">
        {STATUS_ICON[branch.agentStatus] || STATUS_ICON.idle}
        <span className="font-mono text-xs font-medium truncate">{branch.agentName}</span>
      </div>
      <div className="flex items-center gap-2 mt-1.5 pl-5">
        <GitBranch className="w-3 h-3 text-zinc-600 flex-shrink-0" />
        <span className="font-mono text-[10px] text-zinc-500 truncate">{branch.branch || 'detached'}</span>
      </div>
      <div className="flex items-center gap-2 mt-1 pl-5">
        {branch.aheadBy != null && branch.aheadBy > 0 && (
          <Badge variant="outline" className="text-[8px] font-mono h-4 px-1.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/25">
            +{branch.aheadBy} commit{branch.aheadBy !== 1 ? 's' : ''}
          </Badge>
        )}
        {branch.changedFiles && branch.changedFiles.length > 0 && (
          <Badge variant="outline" className="text-[8px] font-mono h-4 px-1.5">
            {branch.changedFiles.length} file{branch.changedFiles.length !== 1 ? 's' : ''}
          </Badge>
        )}
        {totalChanges > 0 && (
          <span className="text-[9px] font-mono text-zinc-600">{totalChanges} lines</span>
        )}
      </div>
    </button>
  );
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [showCommits, setShowCommits] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchBranches = useCallback(() => {
    fetch('/api/branches')
      .then((r) => r.json())
      .then((data) => {
        setBranches(data.branches || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchBranches();
    const iv = setInterval(fetchBranches, 15000);
    return () => clearInterval(iv);
  }, [fetchBranches]);

  const selectedBranch = branches.find((b) => b.agentId === selected);

  const loadDiff = async (agentId: string) => {
    setDiffLoading(true);
    setDiff(null);
    try {
      const res = await fetch(`/api/branches?agentId=${agentId}&diff=1`);
      const data = await res.json();
      setDiff(data.diff || null);
    } catch {
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  };

  const handleShowDiff = () => {
    if (!showDiff && selected && !diff) {
      loadDiff(selected);
    }
    setShowDiff(!showDiff);
  };

  const handleMerge = async () => {
    if (!selectedBranch?.repo || !selectedBranch?.branch) return;
    setMerging(true);
    setMergeResult(null);
    try {
      const res = await fetch('/api/push-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: selectedBranch.agentId,
          summary: `Merge ${selectedBranch.branch} → ${selectedBranch.baseBranch || 'main'} (${selectedBranch.changedFiles?.length || 0} files)`,
        }),
      });
      const data = await res.json();
      if (data.id) {
        setMergeResult({ success: true, message: `Push request #${data.id} created — awaiting orchestrator approval` });
      } else {
        setMergeResult({ success: false, message: data.error || 'Failed to create push request' });
      }
    } catch (err) {
      setMergeResult({ success: false, message: 'Push request failed' });
    } finally {
      setMerging(false);
    }
  };

  const handleDownloadPatch = async () => {
    if (!selectedBranch) return;
    try {
      const res = await fetch(`/api/agents/${selectedBranch.agentId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'patch' }),
      });
      if (!res.ok) return;
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedBranch.branch || 'patch'}.patch`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  const handleSelect = (agentId: string) => {
    setSelected(agentId);
    setDiff(null);
    setShowDiff(false);
    setMergeResult(null);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-sm text-zinc-100">branches & worktrees</h1>
          <Separator orientation="vertical" className="h-4" />
          <Badge variant="outline" className="text-[10px] font-mono">
            {branches.length} branch{branches.length !== 1 ? 'es' : ''}
          </Badge>
          {selectedBranch && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
              <span className="font-mono text-xs text-zinc-400">{selectedBranch.branch}</span>
            </>
          )}
        </div>
        <Button onClick={fetchBranches} variant="ghost" size="sm" className="font-mono text-xs h-7 px-2 text-zinc-500">
          <RefreshCw className="w-3 h-3 mr-1" /> refresh
        </Button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar — branch list */}
        <div className="w-[240px] flex-shrink-0 border-r border-zinc-800 overflow-y-auto">
          <div className="p-2 space-y-1">
            {loading ? (
              <div className="p-4 text-xs font-mono text-zinc-700">loading...</div>
            ) : branches.length === 0 ? (
              <div className="py-8 text-center">
                <GitBranch className="w-6 h-6 text-zinc-800 mx-auto mb-2" />
                <p className="text-[11px] font-mono text-zinc-600">no branches yet</p>
                <p className="text-[10px] font-mono text-zinc-700 mt-1">
                  spawn agents with a repo to create worktree branches
                </p>
              </div>
            ) : (
              branches.map((b) => (
                <BranchCard
                  key={b.agentId}
                  branch={b}
                  isSelected={selected === b.agentId}
                  onSelect={() => handleSelect(b.agentId)}
                />
              ))
            )}
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedBranch ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <Card className="bg-zinc-900/50 border-zinc-800 px-10 py-8">
                <CardContent className="flex flex-col items-center p-0">
                  <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center mb-4">
                    <GitBranch className="w-6 h-6 text-zinc-500" />
                  </div>
                  <h2 className="text-sm font-mono font-medium text-zinc-200 mb-1">branch manager</h2>
                  <p className="text-xs font-mono text-zinc-500 max-w-xs">
                    View agent worktree branches, inspect changes, review diffs, and merge back to main.
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="max-w-2xl mx-auto space-y-4">
                {/* Branch header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
                      <GitBranch className="w-5 h-5 text-zinc-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="font-mono text-sm text-zinc-100">{selectedBranch.branch || 'detached'}</h2>
                        {selectedBranch.aheadBy != null && selectedBranch.aheadBy > 0 && (
                          <Badge variant="outline" className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border-emerald-500/25">
                            +{selectedBranch.aheadBy} ahead
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Bot className="w-3 h-3 text-zinc-600" />
                        <span className="font-mono text-[10px] text-zinc-500">{selectedBranch.agentName}</span>
                        <span className="font-mono text-[10px] text-zinc-700">from {selectedBranch.baseBranch || 'unknown'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button onClick={handleDownloadPatch} variant="outline" size="sm" className="font-mono text-[10px] h-7 px-2.5">
                      <Download className="w-3 h-3 mr-1" /> patch
                    </Button>
                    <Button
                      onClick={handleMerge}
                      disabled={merging || !selectedBranch.repo}
                      size="sm"
                      className="font-mono text-[10px] h-7 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                      <GitMerge className="w-3 h-3 mr-1" /> {merging ? 'submitting...' : `request push → ${selectedBranch.baseBranch || 'main'}`}
                    </Button>
                  </div>
                </div>

                {mergeResult && (
                  <div className={`px-3 py-2 rounded-lg text-xs font-mono ${
                    mergeResult.success
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                      : 'bg-red-500/10 text-red-400 border border-red-500/25'
                  }`}>
                    {mergeResult.message}
                  </div>
                )}

                <Separator className="bg-zinc-800" />

                {/* Changed files */}
                {selectedBranch.changedFiles && selectedBranch.changedFiles.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowFiles(!showFiles)}
                      className="flex items-center gap-2 mb-2"
                    >
                      {showFiles ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">changed files</span>
                      <Badge variant="outline" className="text-[9px] font-mono">{selectedBranch.changedFiles.length}</Badge>
                    </button>
                    {showFiles && (
                      <div className="space-y-0.5">
                        {selectedBranch.changedFiles.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-zinc-900/40 border border-zinc-800/40">
                            {FILE_STATUS_ICON[f.status]}
                            <span className="font-mono text-[11px] text-zinc-300 flex-1 truncate">{f.path}</span>
                            <div className="flex items-center gap-1.5">
                              {f.additions != null && f.additions > 0 && (
                                <span className="font-mono text-[10px] text-emerald-400">+{f.additions}</span>
                              )}
                              {f.deletions != null && f.deletions > 0 && (
                                <span className="font-mono text-[10px] text-red-400">-{f.deletions}</span>
                              )}
                              <Badge variant="outline" className={`text-[8px] font-mono h-4 px-1 ${FILE_STATUS_COLOR[f.status]}`}>
                                {f.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Commits */}
                {selectedBranch.recentCommits && selectedBranch.recentCommits.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowCommits(!showCommits)}
                      className="flex items-center gap-2 mb-2"
                    >
                      {showCommits ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">commits</span>
                      <Badge variant="outline" className="text-[9px] font-mono">{selectedBranch.recentCommits.length}</Badge>
                    </button>
                    {showCommits && (
                      <div className="space-y-0.5">
                        {selectedBranch.recentCommits.map((c, i) => (
                          <div key={i} className="flex items-center gap-2.5 px-2.5 py-2 rounded bg-zinc-900/40 border border-zinc-800/40">
                            <GitCommit className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="font-mono text-[11px] text-zinc-200 block truncate">{c.message}</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <code className="font-mono text-[9px] text-zinc-600">{c.hash}</code>
                                <span className="font-mono text-[9px] text-zinc-700">{c.author}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Diff viewer */}
                <div>
                  <button
                    onClick={handleShowDiff}
                    className="flex items-center gap-2 mb-2"
                  >
                    {showDiff ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                    <Eye className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">diff</span>
                  </button>
                  {showDiff && (
                    <Card className="bg-zinc-950/50 border-zinc-800 overflow-hidden">
                      <CardContent className="p-0">
                        {diffLoading ? (
                          <div className="p-4 text-xs font-mono text-zinc-600 flex items-center gap-2">
                            <Loader2 className="w-3 h-3 animate-spin" /> loading diff...
                          </div>
                        ) : diff ? (
                          <DiffViewer diff={diff} />
                        ) : (
                          <div className="p-4 text-xs font-mono text-zinc-700">no changes to show</div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* No changes empty state */}
                {!selectedBranch.changedFiles?.length && !selectedBranch.recentCommits?.length && (
                  <div className="py-8 text-center">
                    <p className="text-[11px] font-mono text-zinc-600">no changes on this branch yet</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
