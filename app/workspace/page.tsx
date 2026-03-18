'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, File, ChevronRight, ChevronDown, GitBranch,
  Play, Check, X, MessageSquare, RefreshCw, Home,
  FileCode, Diff, GitPullRequest, Bot, Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

interface PushRequest {
  id: string;
  agent_id: string;
  agent_name: string;
  branch: string;
  base_branch: string;
  status: string;
  summary: string;
  files_changed: string;
  created_at: number;
}

// ─── Language detection ──────────────────────────────────────────────────────

function langFromExt(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', rb: 'ruby', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', css: 'css', scss: 'scss', html: 'html',
    sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell',
    dockerfile: 'dockerfile', swift: 'swift', kt: 'kotlin',
  };
  return map[ext.toLowerCase()] || 'plaintext';
}

// ─── Diff parser ─────────────────────────────────────────────────────────────

interface DiffHunk {
  header: string;
  lines: Array<{ type: 'add' | 'del' | 'ctx' | 'header'; content: string; oldLine?: number; newLine?: number }>;
}

interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}

function parseDiff(raw: string): DiffFile[] {
  if (!raw) return [];
  const files: DiffFile[] = [];
  const fileSections = raw.split(/^diff --git/m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split('\n');
    // Extract file path
    const headerLine = lines[0] || '';
    const pathMatch = headerLine.match(/b\/(.+)$/);
    const filePath = pathMatch ? pathMatch[1] : 'unknown';

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0, newLine = 0;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)/);
        oldLine = match ? parseInt(match[1]) : 0;
        const match2 = line.match(/\+(\d+)/);
        newLine = match2 ? parseInt(match2[1]) : 0;
        currentHunk = { header: line, lines: [{ type: 'header', content: line }] };
        hunks.push(currentHunk);
      } else if (currentHunk) {
        if (line.startsWith('+')) {
          currentHunk.lines.push({ type: 'add', content: line.slice(1), newLine: newLine++ });
        } else if (line.startsWith('-')) {
          currentHunk.lines.push({ type: 'del', content: line.slice(1), oldLine: oldLine++ });
        } else if (line.startsWith(' ') || line === '') {
          currentHunk.lines.push({ type: 'ctx', content: line.slice(1) || '', oldLine: oldLine++, newLine: newLine++ });
        }
      }
    }

    if (hunks.length > 0) files.push({ path: filePath, hunks });
  }
  return files;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function WorkspacePage() {
  // State
  const [repo, setRepo] = useState('');
  const [repoInput, setRepoInput] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Record<string, FileEntry[]>>({});

  const [activeFile, setActiveFile] = useState<{ path: string; content: string; ext: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'code' | 'diff' | 'prs'>('code');

  const [diffData, setDiffData] = useState<{ diff: string; stat?: string; commits?: string[]; branch?: string; base?: string; status?: string[]; staged?: string } | null>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);

  const [pushRequests, setPushRequests] = useState<PushRequest[]>([]);
  const [selectedPR, setSelectedPR] = useState<PushRequest | null>(null);
  const [prDiff, setPrDiff] = useState<DiffFile[]>([]);

  const [spawnTask, setSpawnTask] = useState('');
  const [spawning, setSpawning] = useState(false);

  const [recentRepos, setRecentRepos] = useState<string[]>([]);

  // Load recent repos from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('boardroom:recent-repos');
      if (stored) setRecentRepos(JSON.parse(stored));
    } catch {}
  }, []);

  const saveRecentRepo = (r: string) => {
    const updated = [r, ...recentRepos.filter(x => x !== r)].slice(0, 5);
    setRecentRepos(updated);
    localStorage.setItem('boardroom:recent-repos', JSON.stringify(updated));
  };

  // Fetch file tree
  const fetchDir = useCallback(async (dirPath: string) => {
    if (!repo) return;
    const res = await fetch(`/api/files?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(dirPath)}`);
    const data = await res.json();
    if (data.entries) {
      if (dirPath === '') {
        setEntries(data.entries);
      }
      setDirContents(prev => ({ ...prev, [dirPath]: data.entries }));
    }
  }, [repo]);

  // Open repo
  const openRepo = (r: string) => {
    setRepo(r);
    setCurrentPath('');
    setActiveFile(null);
    setExpandedDirs(new Set());
    setDirContents({});
    saveRecentRepo(r);
  };

  useEffect(() => {
    if (repo) fetchDir('');
  }, [repo, fetchDir]);

  // Fetch file content
  const openFile = async (filePath: string) => {
    const res = await fetch(`/api/files?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(filePath)}&action=read`);
    const data = await res.json();
    if (data.content !== undefined) {
      setActiveFile({ path: filePath, content: data.content, ext: data.extension });
      setActiveTab('code');
    }
  };

  // Toggle directory
  const toggleDir = (dirPath: string) => {
    const next = new Set(expandedDirs);
    if (next.has(dirPath)) {
      next.delete(dirPath);
    } else {
      next.add(dirPath);
      if (!dirContents[dirPath]) fetchDir(dirPath);
    }
    setExpandedDirs(next);
  };

  // Fetch push requests
  const fetchPRs = async () => {
    const res = await fetch('/api/push-requests');
    const data = await res.json();
    setPushRequests(data.requests || []);
  };

  useEffect(() => { fetchPRs(); const iv = setInterval(fetchPRs, 10000); return () => clearInterval(iv); }, []);

  // View PR diff
  const viewPR = async (pr: PushRequest) => {
    setSelectedPR(pr);
    setActiveTab('prs');
    if (pr.agent_id) {
      // Get agent to find repo
      const agentRes = await fetch(`/api/agents/${pr.agent_id}`);
      const agentData = await agentRes.json();
      const agentRepo = agentData.agent?.repo;
      if (agentRepo) {
        const diffRes = await fetch(`/api/diff?repo=${encodeURIComponent(agentRepo)}&branch=${encodeURIComponent(pr.branch)}&base=${encodeURIComponent(pr.base_branch)}`);
        const diffData = await diffRes.json();
        if (diffData.diff) setPrDiff(parseDiff(diffData.diff));
      }
    }
  };

  // Approve/Reject PR
  const reviewPR = async (id: string, action: 'approve' | 'reject') => {
    await fetch('/api/push-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    fetchPRs();
    setSelectedPR(null);
    setPrDiff([]);
  };

  // View diff for current repo
  const viewRepoDiff = async (branch?: string) => {
    if (!repo) return;
    const params = new URLSearchParams({ repo });
    if (branch) params.set('branch', branch);
    const res = await fetch(`/api/diff?${params}`);
    const data = await res.json();
    setDiffData(data);
    setDiffFiles(parseDiff(data.diff || ''));
    setActiveTab('diff');
  };

  // Spawn agent on repo
  const handleSpawn = async () => {
    if (!spawnTask.trim() || !repo) return;
    setSpawning(true);
    try {
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: spawnTask, type: 'claude', repo, name: 'workspace-agent' }),
      });
      setSpawnTask('');
    } catch {}
    setSpawning(false);
  };

  // ─── Render helpers ──────────────────────────────────────────────────────

  const renderTree = (items: FileEntry[], depth = 0) => (
    <div>
      {items.map((entry) => (
        <div key={entry.path}>
          <button
            onClick={() => entry.type === 'directory' ? toggleDir(entry.path) : openFile(entry.path)}
            className={`w-full text-left flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono hover:bg-zinc-800/60 transition-colors ${
              activeFile?.path === entry.path ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            {entry.type === 'directory' ? (
              expandedDirs.has(entry.path)
                ? <ChevronDown className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                : <ChevronRight className="w-3 h-3 text-zinc-600 flex-shrink-0" />
            ) : (
              <FileCode className="w-3 h-3 text-zinc-600 flex-shrink-0" />
            )}
            {entry.type === 'directory' ? (
              <FolderOpen className="w-3.5 h-3.5 text-amber-500/70 flex-shrink-0" />
            ) : null}
            <span className="truncate">{entry.name}</span>
            {entry.size !== undefined && entry.type === 'file' && (
              <span className="ml-auto text-[9px] text-zinc-700 flex-shrink-0">
                {entry.size > 1024 ? `${(entry.size / 1024).toFixed(0)}k` : `${entry.size}b`}
              </span>
            )}
          </button>
          {entry.type === 'directory' && expandedDirs.has(entry.path) && dirContents[entry.path] && (
            renderTree(dirContents[entry.path], depth + 1)
          )}
        </div>
      ))}
    </div>
  );

  const renderDiffFile = (file: DiffFile) => (
    <div key={file.path} className="mb-4">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-t-lg">
        <FileCode className="w-3.5 h-3.5 text-zinc-500" />
        <span className="font-mono text-[11px] text-zinc-300">{file.path}</span>
      </div>
      <div className="border border-t-0 border-zinc-800 rounded-b-lg overflow-x-auto">
        {file.hunks.map((hunk, hi) => (
          <div key={hi}>
            {hunk.lines.map((line, li) => (
              <div
                key={li}
                className={`px-3 py-0 font-mono text-[11px] leading-5 ${
                  line.type === 'add' ? 'bg-emerald-500/8 text-emerald-300'
                    : line.type === 'del' ? 'bg-red-500/8 text-red-300'
                    : line.type === 'header' ? 'bg-blue-500/5 text-blue-400'
                    : 'text-zinc-500'
                }`}
              >
                <span className="inline-block w-8 text-right text-[9px] text-zinc-700 mr-2 select-none">
                  {line.type === 'add' ? line.newLine : line.type === 'del' ? line.oldLine : line.type === 'ctx' ? line.oldLine : ''}
                </span>
                <span className="inline-block w-3 text-center select-none">
                  {line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'header' ? '@@' : ' '}
                </span>
                {line.content}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  // ─── No repo selected ─────────────────────────────────────────────────────

  if (!repo) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
          <h1 className="font-mono text-sm text-zinc-100">workspace</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md w-full px-8">
            <Home className="w-10 h-10 text-zinc-700 mx-auto mb-4" />
            <h2 className="font-mono text-sm text-zinc-300 text-center mb-1">open a project</h2>
            <p className="font-mono text-[10px] text-zinc-600 text-center mb-6">
              enter a repo path to browse code, review diffs, and deploy agents
            </p>
            <div className="flex gap-2 mb-6">
              <Input
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && repoInput.trim() && openRepo(repoInput.trim())}
                placeholder="/path/to/your/repo"
                className="font-mono text-xs bg-zinc-950 border-zinc-800 text-zinc-200"
              />
              <Button
                onClick={() => repoInput.trim() && openRepo(repoInput.trim())}
                className="font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-4"
              >
                open
              </Button>
            </div>
            {recentRepos.length > 0 && (
              <div>
                <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">recent</span>
                <div className="mt-2 space-y-1">
                  {recentRepos.map((r) => (
                    <button
                      key={r}
                      onClick={() => { setRepoInput(r); openRepo(r); }}
                      className="w-full text-left px-3 py-2 rounded-lg text-[11px] font-mono text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-colors truncate"
                    >
                      <FolderOpen className="w-3.5 h-3.5 inline mr-2 text-zinc-600" />
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Workspace layout ──────────────────────────────────────────────────────

  const pendingPRs = pushRequests.filter(p => p.status === 'pending');

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <button onClick={() => { setRepo(''); setActiveFile(null); }} className="text-zinc-600 hover:text-zinc-400">
          <Home className="w-3.5 h-3.5" />
        </button>
        <h1 className="font-mono text-sm text-zinc-100">workspace</h1>
        <Separator orientation="vertical" className="h-4" />
        <span className="font-mono text-[10px] text-zinc-500 truncate max-w-[300px]">{repo}</span>

        {/* Tabs */}
        <div className="flex items-center gap-1 ml-4">
          <button
            onClick={() => setActiveTab('code')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono transition-colors ${
              activeTab === 'code' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <FileCode className="w-3 h-3" /> code
          </button>
          <button
            onClick={() => { viewRepoDiff(); }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono transition-colors ${
              activeTab === 'diff' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Diff className="w-3 h-3" /> diff
          </button>
          <button
            onClick={() => setActiveTab('prs')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono transition-colors ${
              activeTab === 'prs' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <GitPullRequest className="w-3 h-3" /> prs
            {pendingPRs.length > 0 && (
              <Badge className="text-[8px] h-4 px-1 bg-amber-500/15 text-amber-400 border-amber-500/25">
                {pendingPRs.length}
              </Badge>
            )}
          </button>
        </div>

        {/* Agent launcher */}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Bot className="w-3.5 h-3.5 text-zinc-600" />
            <Input
              value={spawnTask}
              onChange={(e) => setSpawnTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSpawn()}
              placeholder="deploy agent..."
              className="w-[220px] h-7 font-mono text-[10px] bg-zinc-950 border-zinc-800 text-zinc-300"
            />
            <Button
              onClick={handleSpawn}
              disabled={!spawnTask.trim() || spawning}
              size="sm"
              className="h-7 px-2 bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <Send className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main: sidebar + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File tree sidebar */}
        <div className="w-[220px] flex-shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-950/30">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">files</span>
            <button onClick={() => fetchDir('')} className="text-zinc-700 hover:text-zinc-400">
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          {entries.length > 0 ? renderTree(entries) : (
            <div className="px-3 py-4 text-[10px] font-mono text-zinc-700 text-center">loading...</div>
          )}

          {/* Push requests in sidebar */}
          {pendingPRs.length > 0 && (
            <>
              <Separator className="my-2 bg-zinc-800" />
              <div className="px-3 py-1">
                <span className="text-[9px] font-mono text-amber-500/60 uppercase tracking-wider">pending prs</span>
              </div>
              {pendingPRs.map((pr) => (
                <button
                  key={pr.id}
                  onClick={() => viewPR(pr)}
                  className={`w-full text-left px-3 py-2 text-[10px] font-mono hover:bg-zinc-900 transition-colors ${
                    selectedPR?.id === pr.id ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-400'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="w-3 h-3 text-amber-400 flex-shrink-0" />
                    <span className="truncate">{pr.agent_name}</span>
                  </div>
                  <div className="text-[9px] text-zinc-600 mt-0.5 pl-4.5 truncate">{pr.branch}</div>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto">
          {/* Code view */}
          {activeTab === 'code' && (
            activeFile ? (
              <div className="h-full flex flex-col">
                <div className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800 bg-zinc-900/30">
                  <FileCode className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="font-mono text-[11px] text-zinc-300">{activeFile.path}</span>
                  <Badge variant="outline" className="text-[8px] font-mono ml-auto">{langFromExt(activeFile.ext)}</Badge>
                </div>
                <pre className="flex-1 overflow-auto p-4 font-mono text-[11px] text-zinc-300 leading-5 bg-zinc-950">
                  {activeFile.content.split('\n').map((line, i) => (
                    <div key={i} className="flex hover:bg-zinc-900/30">
                      <span className="inline-block w-10 text-right pr-4 text-zinc-700 select-none flex-shrink-0">{i + 1}</span>
                      <span className="whitespace-pre">{line}</span>
                    </div>
                  ))}
                </pre>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="text-center">
                  <File className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                  <p className="font-mono text-xs text-zinc-600">select a file from the tree</p>
                </div>
              </div>
            )
          )}

          {/* Diff view */}
          {activeTab === 'diff' && (
            <div className="p-4">
              {diffData?.commits && diffData.commits.length > 0 && (
                <div className="mb-4">
                  <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
                    commits ({diffData.branch} vs {diffData.base})
                  </span>
                  <div className="mt-1.5 space-y-0.5">
                    {diffData.commits.map((c, i) => (
                      <div key={i} className="font-mono text-[10px] text-zinc-400 px-2 py-0.5">{c}</div>
                    ))}
                  </div>
                  <Separator className="my-3 bg-zinc-800" />
                </div>
              )}
              {diffFiles.length > 0 ? (
                diffFiles.map(renderDiffFile)
              ) : diffData?.status && diffData.status.length > 0 ? (
                <div>
                  <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">working directory changes</span>
                  <div className="mt-2 space-y-0.5">
                    {diffData.status.map((s, i) => (
                      <div key={i} className="font-mono text-[10px] text-zinc-400 px-2 py-0.5">{s}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Diff className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                  <p className="font-mono text-xs text-zinc-600">no changes detected</p>
                </div>
              )}
            </div>
          )}

          {/* PR review view */}
          {activeTab === 'prs' && (
            selectedPR ? (
              <div className="h-full flex flex-col">
                <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/30">
                  <GitBranch className="w-4 h-4 text-amber-400" />
                  <div>
                    <div className="font-mono text-xs text-zinc-200">{selectedPR.agent_name}</div>
                    <div className="font-mono text-[9px] text-zinc-500">{selectedPR.branch} → {selectedPR.base_branch}</div>
                  </div>
                  <Badge variant="outline" className={`ml-auto text-[9px] font-mono ${
                    selectedPR.status === 'pending' ? 'text-amber-400 border-amber-500/25'
                      : selectedPR.status === 'approved' ? 'text-emerald-400 border-emerald-500/25'
                      : 'text-red-400 border-red-500/25'
                  }`}>
                    {selectedPR.status}
                  </Badge>
                  {selectedPR.status === 'pending' && (
                    <div className="flex gap-1.5">
                      <Button
                        onClick={() => reviewPR(selectedPR.id, 'approve')}
                        size="sm"
                        className="h-7 px-3 text-[10px] font-mono bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        <Check className="w-3 h-3 mr-1" /> approve & merge
                      </Button>
                      <Button
                        onClick={() => reviewPR(selectedPR.id, 'reject')}
                        size="sm"
                        variant="outline"
                        className="h-7 px-3 text-[10px] font-mono text-red-400 border-red-500/25 hover:bg-red-500/10"
                      >
                        <X className="w-3 h-3 mr-1" /> reject
                      </Button>
                    </div>
                  )}
                </div>

                {/* Summary */}
                {selectedPR.summary && (
                  <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950/30">
                    <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">summary</span>
                    <p className="mt-1 font-mono text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap">
                      {selectedPR.summary}
                    </p>
                  </div>
                )}

                {/* Diff */}
                <div className="flex-1 overflow-auto p-4">
                  {prDiff.length > 0 ? (
                    prDiff.map(renderDiffFile)
                  ) : (
                    <div className="text-center py-8">
                      <RefreshCw className="w-5 h-5 text-zinc-700 mx-auto mb-2 animate-spin" />
                      <p className="font-mono text-[10px] text-zinc-600">loading diff...</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="text-center">
                  <GitPullRequest className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                  <p className="font-mono text-xs text-zinc-600">
                    {pendingPRs.length > 0 ? `${pendingPRs.length} pending — select one to review` : 'no pending push requests'}
                  </p>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
