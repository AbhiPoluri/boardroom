'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen, File, ChevronRight, ChevronDown, GitBranch,
  Play, Check, X, MessageSquare, RefreshCw, Home,
  FileCode, Diff, GitPullRequest, Bot, Send, GripHorizontal,
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

  // Agents for the current repo
  interface AgentInfo { id: string; name: string; type: string; status: string; task: string; repo: string | null; created_at: number }
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [showAgents, setShowAgents] = useState(true);

  const [activeFile, setActiveFile] = useState<{ path: string; content: string; ext: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'code' | 'diff' | 'prs'>('code');

  const [diffData, setDiffData] = useState<{ diff: string; stat?: string; commits?: string[]; branch?: string; base?: string; status?: string[]; staged?: string } | null>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);

  const [pushRequests, setPushRequests] = useState<PushRequest[]>([]);
  const [selectedPR, setSelectedPR] = useState<PushRequest | null>(null);
  const [prDiff, setPrDiff] = useState<DiffFile[]>([]);

  const [spawnTask, setSpawnTask] = useState('');
  const [spawning, setSpawning] = useState(false);

  // Workspace orchestrator chat
  interface ChatMsg { role: 'user' | 'assistant'; content: string; thinking?: string; tools?: Array<{ tool: string; result?: string }> }
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatStatus, setChatStatus] = useState('');
  const [chatElapsed, setChatElapsed] = useState(0);
  const chatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  const [recentRepos, setRecentRepos] = useState<string[]>([]);

  // Feature 1: file tree search
  const [fileSearch, setFileSearch] = useState('');

  // Feature 3: resizable chat panel
  const [chatPanelHeight, setChatPanelHeight] = useState(220);
  const chatDragRef = useRef<{ startY: number; startH: number } | null>(null);

  // Browse state
  const [browsing, setBrowsing] = useState(false);
  const [browseDir, setBrowseDir] = useState('');
  const [browseEntries, setBrowseEntries] = useState<Array<{ name: string; path: string; isGit: boolean }>>([]);
  const [browseIsGit, setBrowseIsGit] = useState(false);
  const [browseParent, setBrowseParent] = useState<string | null>(null);

  // Feature 3: drag handlers for resizable chat panel
  const onChatDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    chatDragRef.current = { startY: e.clientY, startH: chatPanelHeight };
    const onMove = (ev: MouseEvent) => {
      if (!chatDragRef.current) return;
      const delta = chatDragRef.current.startY - ev.clientY;
      const newH = Math.min(500, Math.max(120, chatDragRef.current.startH + delta));
      setChatPanelHeight(newH);
    };
    const onUp = () => {
      chatDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Load recent repos + last open repo from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('boardroom:recent-repos');
      if (stored) setRecentRepos(JSON.parse(stored));
      const lastRepo = localStorage.getItem('boardroom:workspace-repo');
      if (lastRepo) { setRepo(lastRepo); setRepoInput(lastRepo); }
    } catch {}
  }, []);

  // Load chat messages from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('boardroom:workspace-chat');
      if (stored) setChatMessages(JSON.parse(stored));
    } catch {}
  }, []);

  // Save chat messages to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('boardroom:workspace-chat', JSON.stringify(chatMessages));
    } catch {}
  }, [chatMessages]);

  const browseTo = async (dir?: string) => {
    const params = dir ? `?dir=${encodeURIComponent(dir)}` : '';
    const res = await fetch(`/api/browse${params}`);
    const data = await res.json();
    if (data.entries) {
      setBrowseDir(data.dir);
      setBrowseEntries(data.entries);
      setBrowseIsGit(data.isGit);
      setBrowseParent(data.parent);
      setBrowsing(true);
    }
  };

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
    localStorage.setItem('boardroom:workspace-repo', r);
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

  // Toast notification when agents finish
  const [toast, setToast] = useState<{ msg: string; type: 'done' | 'error' } | null>(null);
  const prevAgentStatuses = useRef<Record<string, string>>({});

  // Poll agents
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      const fetched: AgentInfo[] = data.agents || [];
      setAgents(fetched);

      // Detect transitions to done/error
      for (const agent of fetched) {
        const prev = prevAgentStatuses.current[agent.id];
        const cur = agent.status;
        if (
          (prev === 'running' || prev === 'spawning') &&
          (cur === 'done' || cur === 'error')
        ) {
          const msg =
            cur === 'done'
              ? `${agent.name} finished`
              : `${agent.name} errored`;
          setToast({ msg, type: cur });
          setTimeout(() => setToast(null), 4000);
        }
        prevAgentStatuses.current[agent.id] = cur;
      }
    } catch {}
  }, []);

  useEffect(() => { fetchAgents(); const iv = setInterval(fetchAgents, 5000); return () => clearInterval(iv); }, [fetchAgents]);

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

  // Workspace chat — sends to orchestrator with repo context baked in
  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    setChatOpen(true);
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    setChatLoading(true);
    setChatStatus('connecting to orchestrator...');
    setChatElapsed(0);
    if (chatTimerRef.current) clearInterval(chatTimerRef.current);
    chatTimerRef.current = setInterval(() => setChatElapsed(prev => prev + 1), 1000);

    const controller = new AbortController();
    chatAbortRef.current = controller;

    // Prepend repo context so orchestrator knows where to work
    const fullMsg = `[workspace: ${repo}] All agents for this task should use repo="${repo}". ${msg}`;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: fullMsg }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');

      let assistantText = '';
      const tools: Array<{ tool: string; result?: string }> = [];
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'thinking') {
              setChatStatus(event.content || 'thinking...');
            }
            if (event.type === 'text') {
              assistantText += event.content;
              setChatStatus('responding...');
            }
            if (event.type === 'tool_use') { tools.push({ tool: event.tool }); setChatStatus(`running ${event.tool}...`); }
            if (event.type === 'tool_result' && tools.length > 0) {
              tools[tools.length - 1].result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
            }
          } catch {}
        }
        // Update in real-time
        setChatMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { role: 'assistant', content: assistantText, tools: [...tools] };
          } else {
            updated.push({ role: 'assistant', content: assistantText, tools: [...tools] });
          }
          return updated;
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: 'error connecting to orchestrator' }]);
      }
    }
    setChatLoading(false);
    setChatStatus('');
    setChatElapsed(0);
    if (chatTimerRef.current) { clearInterval(chatTimerRef.current); chatTimerRef.current = null; }
    chatAbortRef.current = null;
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  // ─── Render helpers ──────────────────────────────────────────────────────

  const renderTree = (items: FileEntry[], depth = 0, search = '') => {
    const filtered = search
      ? items.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
      : items;
    return (
    <div>
      {filtered.map((entry) => (
        <div key={entry.path}>
          <button
            onClick={() => entry.type === 'directory' ? toggleDir(entry.path) : openFile(entry.path)}
            className={`w-full text-left flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono hover:bg-zinc-800/60 transition-colors ${
              activeFile?.path === entry.path && activeTab === 'code' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
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
            renderTree(dirContents[entry.path], depth + 1, search)
          )}
        </div>
      ))}
    </div>
    );
  };

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
              browse for a repo or enter a path directly
            </p>
            <div className="flex gap-2 mb-4">
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
              <Button
                onClick={() => browseTo()}
                variant="outline"
                className="font-mono text-xs border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3"
              >
                <FolderOpen className="w-3.5 h-3.5 mr-1" /> browse
              </Button>
            </div>

            {/* Directory browser */}
            {browsing && (
              <div className="mb-4 border border-zinc-800 rounded-lg bg-zinc-950/60 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900/40">
                  {browseParent && (
                    <button
                      onClick={() => browseTo(browseParent)}
                      className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      ..
                    </button>
                  )}
                  <span className="font-mono text-[10px] text-zinc-400 truncate flex-1">{browseDir}</span>
                  {browseIsGit && (
                    <Button
                      onClick={() => { openRepo(browseDir); setBrowsing(false); }}
                      size="sm"
                      className="h-6 px-2 text-[9px] font-mono bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                      <GitBranch className="w-2.5 h-2.5 mr-1" /> open this repo
                    </Button>
                  )}
                  <button onClick={() => setBrowsing(false)} className="text-zinc-600 hover:text-zinc-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="max-h-[250px] overflow-y-auto">
                  {browseEntries.map((entry) => (
                    <button
                      key={entry.path}
                      onClick={() => entry.isGit ? openRepo(entry.path) : browseTo(entry.path)}
                      className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono hover:bg-zinc-800/60 transition-colors group"
                    >
                      {entry.isGit ? (
                        <GitBranch className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      ) : (
                        <FolderOpen className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                      )}
                      <span className={entry.isGit ? 'text-emerald-400' : 'text-zinc-400'}>{entry.name}</span>
                      {entry.isGit && (
                        <span className="ml-auto text-[8px] text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">open</span>
                      )}
                      {!entry.isGit && (
                        <ChevronRight className="w-3 h-3 ml-auto text-zinc-700" />
                      )}
                    </button>
                  ))}
                  {browseEntries.length === 0 && (
                    <div className="px-3 py-4 text-[10px] font-mono text-zinc-700 text-center">empty directory</div>
                  )}
                </div>
              </div>
            )}

            {/* Recent repos */}
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
        <button onClick={() => { setRepo(''); setActiveFile(null); localStorage.removeItem('boardroom:workspace-repo'); }} className="text-zinc-600 hover:text-zinc-400">
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

        {/* Chat toggle */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono transition-colors ${
              chatOpen ? 'bg-emerald-500/15 text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <MessageSquare className="w-3 h-3" />
            {chatLoading ? (
              <span className="text-emerald-400">
                {chatStatus} <span className="text-zinc-600">{chatElapsed}s</span>
              </span>
            ) : 'orchestrator'}
          </button>
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
          <div className="px-2 pb-1.5">
            <input
              value={fileSearch}
              onChange={(e) => setFileSearch(e.target.value)}
              placeholder="search files..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-400 placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600"
            />
          </div>
          {entries.length > 0 ? renderTree(entries, 0, fileSearch) : (
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

        {/* Right panel: agent cards */}
        {showAgents && (
          <div className="w-[260px] flex-shrink-0 border-l border-zinc-800 overflow-y-auto bg-zinc-950/30">
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Bot className="w-3 h-3 text-zinc-600" />
                <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">agents</span>
                <Badge variant="outline" className="text-[8px] font-mono h-4 px-1">
                  {agents.filter(a => a.status === 'running' || a.status === 'spawning').length} active
                </Badge>
              </div>
              <button onClick={() => setShowAgents(false)} className="text-zinc-700 hover:text-zinc-400">
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Repo agents first */}
            {(() => {
              const repoAgents = agents.filter(a => a.repo === repo);
              const otherAgents = agents.filter(a => a.repo !== repo && (a.status === 'running' || a.status === 'spawning'));

              return (
                <>
                  {repoAgents.length > 0 && (
                    <div className="px-2 mb-1">
                      <span className="text-[8px] font-mono text-zinc-700 uppercase px-1">this repo</span>
                      {repoAgents.map(a => (
                        <div key={a.id} className="px-2 py-2 rounded-lg hover:bg-zinc-900 transition-colors mb-0.5">
                          <div className="flex items-center gap-2">
                            <a href={`/agents/${a.id}`} className="flex items-center gap-2 flex-1 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                a.status === 'running' ? 'bg-emerald-400 animate-pulse'
                                  : a.status === 'done' ? 'bg-emerald-400'
                                  : a.status === 'error' || a.status === 'killed' ? 'bg-red-400'
                                  : a.status === 'spawning' ? 'bg-blue-400 animate-pulse'
                                  : 'bg-zinc-600'
                              }`} />
                              <span className="font-mono text-[10px] text-zinc-300 truncate">{a.name}</span>
                              <span className={`text-[8px] font-mono ml-auto ${
                                a.status === 'running' ? 'text-emerald-400'
                                  : a.status === 'done' ? 'text-zinc-600'
                                  : a.status === 'error' ? 'text-red-400'
                                  : 'text-zinc-600'
                              }`}>{a.status}</span>
                            </a>
                            {a.status === 'running' && (
                              <button
                                onClick={async (e) => { e.preventDefault(); await fetch(`/api/agents/${a.id}`, { method: 'DELETE' }); fetchAgents(); }}
                                className="flex-shrink-0 text-red-400/70 hover:text-red-400 px-0.5 py-0.5 rounded border border-red-500/20 hover:border-red-500/40 transition-colors"
                                title="kill agent"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                            {a.status === 'done' && (
                              <button
                                onClick={(e) => { e.preventDefault(); viewRepoDiff(); }}
                                className="flex-shrink-0 text-[8px] font-mono text-zinc-500 hover:text-zinc-300 px-1 py-0.5 rounded border border-zinc-700/30 hover:border-zinc-600/50 transition-colors"
                                title="view diff"
                              >
                                diff
                              </button>
                            )}
                          </div>
                          <a href={`/agents/${a.id}`}>
                            <p className="font-mono text-[9px] text-zinc-600 mt-0.5 pl-3.5 line-clamp-2">{a.task}</p>
                          </a>
                        </div>
                      ))}
                    </div>
                  )}

                  {otherAgents.length > 0 && (
                    <div className="px-2">
                      <span className="text-[8px] font-mono text-zinc-700 uppercase px-1">other</span>
                      {otherAgents.map(a => (
                        <div key={a.id} className="px-2 py-1.5 mb-0.5">
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                            <span className="font-mono text-[10px] text-zinc-500 truncate">{a.name}</span>
                            <span className="text-[8px] font-mono text-zinc-700 ml-auto">{a.type}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {repoAgents.length === 0 && otherAgents.length === 0 && (
                    <div className="px-3 py-6 text-center">
                      <Bot className="w-6 h-6 text-zinc-800 mx-auto mb-2" />
                      <p className="font-mono text-[10px] text-zinc-700">no agents running</p>
                      <p className="font-mono text-[9px] text-zinc-800 mt-0.5">use the deploy bar above</p>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Show agents toggle when panel is hidden */}
        {!showAgents && (
          <button
            onClick={() => setShowAgents(true)}
            className="flex-shrink-0 w-8 border-l border-zinc-800 flex items-center justify-center hover:bg-zinc-900 transition-colors"
            title="Show agents panel"
          >
            <Bot className="w-3.5 h-3.5 text-zinc-600" />
          </button>
        )}
      </div>

      {/* Workspace orchestrator chat */}
      {chatOpen && (
        <>
          {/* Drag handle */}
          <div
            onMouseDown={onChatDragStart}
            className="flex-shrink-0 h-2 border-t border-zinc-800 bg-zinc-950/80 flex items-center justify-center cursor-row-resize hover:bg-zinc-800/60 group transition-colors"
          >
            <GripHorizontal className="w-4 h-3 text-zinc-800 group-hover:text-zinc-600 transition-colors" />
          </div>
        <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-950/60" style={{ height: `${chatPanelHeight}px` }}>
          <div className="flex flex-col h-full">
            {/* Chat header */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/50">
              <MessageSquare className="w-3 h-3 text-emerald-500" />
              <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">orchestrator</span>
              <span className="text-[9px] font-mono text-zinc-700 truncate">{repo.split('/').slice(-2).join('/')}</span>
              {chatLoading && (
                <button
                  onClick={() => chatAbortRef.current?.abort()}
                  className="text-[9px] font-mono text-red-400/60 hover:text-red-400 ml-1"
                >
                  abort
                </button>
              )}
              <button
                onClick={() => { setChatMessages([]); localStorage.removeItem('boardroom:workspace-chat'); }}
                className="ml-auto text-[9px] font-mono text-zinc-700 hover:text-zinc-400"
              >
                clear
              </button>
              <button onClick={() => setChatOpen(false)} className="text-zinc-700 hover:text-zinc-400">
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
              {chatMessages.length === 0 && (
                <div className="text-[10px] font-mono text-zinc-700 py-2">
                  ask me to spawn agents, create workflows, review code, or plan features for this repo
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg text-[11px] font-mono leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-zinc-800 text-zinc-200 px-2.5 py-1.5'
                      : 'space-y-0.5'
                  }`}>
                    {msg.role === 'user' ? (
                      <span>{msg.content}</span>
                    ) : (
                      <>
                        {msg.content.split('\n').filter(Boolean).map((line, li) => {
                          const isThinking = line.startsWith('💭');
                          const isWaiting = line.startsWith('⏳') || line.includes('waiting for');
                          if (isThinking) {
                            return (
                              <div key={li} className="text-[10px] text-zinc-600 pl-1 border-l-2 border-zinc-800 ml-0.5 py-0.5">
                                {line.replace('💭 ', '')}
                              </div>
                            );
                          }
                          if (isWaiting) {
                            return (
                              <div key={li} className="text-[10px] text-blue-400/60 py-0.5 px-2">
                                {line}
                              </div>
                            );
                          }
                          return (
                            <div key={li} className="text-zinc-300 px-2.5 py-0.5 bg-zinc-900 rounded border border-zinc-800/50">
                              {line}
                            </div>
                          );
                        })}
                      </>
                    )}
                    {msg.tools && msg.tools.length > 0 && (
                      <div className="mt-1 space-y-0.5 px-1">
                        {msg.tools.map((t, ti) => (
                          <div key={ti} className="flex items-center gap-1.5 text-[9px] px-2 py-1 rounded-md bg-emerald-500/5 border border-emerald-500/10">
                            <span className="w-1 h-1 rounded-full bg-emerald-400 flex-shrink-0" />
                            <span className="text-emerald-400/80">{t.tool}</span>
                            {t.result && <span className="text-zinc-600 truncate">{typeof t.result === 'string' ? t.result.slice(0, 60) : ''}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800/50">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    <span className="text-[10px] font-mono text-zinc-500">{chatStatus}</span>
                    <span className="text-[9px] font-mono text-zinc-700">{chatElapsed}s</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-zinc-800/50">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder={`tell the orchestrator what to do in ${repo.split('/').pop()}...`}
                disabled={chatLoading}
                className="flex-1 h-7 font-mono text-[11px] bg-zinc-950 border-zinc-800 text-zinc-200 placeholder:text-zinc-700"
              />
              <Button
                onClick={sendChat}
                disabled={!chatInput.trim() || chatLoading}
                size="sm"
                className="h-7 px-3 bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <Send className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
        </>
      )}

      {/* Agent finish toast */}
      {toast && (
        <div
          className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg border font-mono text-[11px] shadow-lg transition-opacity ${
            toast.type === 'done'
              ? 'bg-emerald-950/90 border-emerald-700/50 text-emerald-300'
              : 'bg-red-950/90 border-red-700/50 text-red-300'
          }`}
        >
          {toast.type === 'done' ? (
            <Check className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <X className="w-3.5 h-3.5 flex-shrink-0" />
          )}
          {toast.msg}
          <button
            onClick={() => setToast(null)}
            className="ml-2 opacity-50 hover:opacity-100"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
