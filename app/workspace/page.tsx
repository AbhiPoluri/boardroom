'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen, File, ChevronRight, ChevronDown, GitBranch,
  Play, Check, X, MessageSquare, RefreshCw, Home,
  FileCode, Diff, GitPullRequest, Bot, Send, GripHorizontal,
  Pencil, Save, Terminal, PanelLeftClose, Sparkles, Search, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { toast as globalToast } from '@/lib/toast';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  gitStatus?: string | null;
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

// ─── Syntax highlighter ──────────────────────────────────────────────────────

function highlightLine(line: string, lang: string): React.ReactNode[] {
  const KEYWORDS = new Set([
    'function','const','let','var','return','if','else','for','while',
    'import','export','from','class','interface','type','async','await',
    'new','this','try','catch','throw','default','switch','case','break',
    'continue','extends','implements','of','in','typeof','instanceof',
    'void','never','any','boolean','string','number','null','undefined',
    'true','false','static','public','private','protected','readonly',
    'enum','namespace','module','declare','abstract','override',
    // python
    'def','lambda','with','as','pass','del','global','nonlocal','yield',
    'and','or','not','is','elif','print','self',
    // go/rust/etc
    'fn','let','mut','use','mod','pub','struct','impl','trait','match',
    'where','move','ref','dyn','Box','Vec','Option','Result','Some','None',
    'Ok','Err','func','go','defer','select','chan','make','range','map',
  ]);

  // Token patterns in priority order
  const TOKEN_RE = /(`[^`]*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\/{2}.*)|(\b\d+(?:\.\d+)?\b)|([@]\w+)|(<\/?[\w][\w.-]*>?)|(===|!==|=>|&&|\|\||[=!<>+\-*\/%?])|([()[\]{}])|([\w]+)/g;

  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = TOKEN_RE.exec(line)) !== null) {
    // push any gap before this match as plain text
    if (m.index > last) {
      nodes.push(line.slice(last, m.index));
    }
    last = m.index + m[0].length;

    const [full, str, comment, num, decorator, htmlTag, op, bracket, word] = m;

    if (str) {
      nodes.push(<span key={m.index} style={{ color: '#4ade80' }}>{full}</span>);
    } else if (comment) {
      nodes.push(<span key={m.index} style={{ color: '#71717a', fontStyle: 'italic' }}>{full}</span>);
    } else if (num) {
      nodes.push(<span key={m.index} style={{ color: '#fbbf24' }}>{full}</span>);
    } else if (decorator) {
      nodes.push(<span key={m.index} style={{ color: '#fbbf24' }}>{full}</span>);
    } else if (htmlTag) {
      nodes.push(<span key={m.index} style={{ color: '#22d3ee' }}>{full}</span>);
    } else if (op) {
      nodes.push(<span key={m.index} style={{ color: '#f87171' }}>{full}</span>);
    } else if (bracket) {
      nodes.push(<span key={m.index} style={{ color: '#a1a1aa' }}>{full}</span>);
    } else if (word) {
      if (KEYWORDS.has(word)) {
        nodes.push(<span key={m.index} style={{ color: '#60a5fa' }}>{full}</span>);
      } else if (/^[A-Z]/.test(word)) {
        nodes.push(<span key={m.index} style={{ color: '#c084fc' }}>{full}</span>);
      } else {
        nodes.push(full);
      }
    } else {
      nodes.push(full);
    }
  }

  // trailing text after last match
  if (last < line.length) nodes.push(line.slice(last));

  return nodes;
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
  const [repoBranch, setRepoBranch] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Record<string, FileEntry[]>>({});

  // Agents for the current repo
  interface AgentInfo { id: string; name: string; type: string; status: string; task: string; repo: string | null; created_at: number }
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [showAgents, setShowAgents] = useState(true);

  const [openFiles, setOpenFiles] = useState<Array<{ path: string; content: string; ext: string }>>([]);
  const [activeFileIdx, setActiveFileIdx] = useState<number>(0);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'diff' | 'prs' | 'fleet'>('code');
  const codeViewerRef = useRef<HTMLPreElement>(null);

  // Derived: active file from openFiles + activeFileIdx
  const activeFile = openFiles[activeFileIdx] ?? null;

  const [diffData, setDiffData] = useState<{ diff: string; stat?: string; commits?: string[]; branch?: string; base?: string; status?: string[]; staged?: string; behindBy?: number } | null>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);

  const [pushRequests, setPushRequests] = useState<PushRequest[]>([]);
  const [selectedPR, setSelectedPR] = useState<PushRequest | null>(null);
  const [prDiff, setPrDiff] = useState<DiffFile[]>([]);
  const [prBehindBy, setPrBehindBy] = useState<number>(0);

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

  // Semantic search
  const [searchMode, setSearchMode] = useState<'files' | 'semantic'>('files');
  const [semanticQuery, setSemanticQuery] = useState('');
  interface SemanticResult { file: string; line: number; context: string }
  const [semanticResults, setSemanticResults] = useState<SemanticResult[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);

  // AI diff review
  const [diffReview, setDiffReview] = useState<string | null>(null);
  const [diffReviewLoading, setDiffReviewLoading] = useState(false);
  const [diffReviewOpen, setDiffReviewOpen] = useState(false);

  // Repo switcher dropdown
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const repoDropdownRef = useRef<HTMLDivElement>(null);

  // Feature 3: resizable chat panel
  const [chatPanelHeight, setChatPanelHeight] = useState(220);
  const chatDragRef = useRef<{ startY: number; startH: number } | null>(null);

  // Agent terminal view
  const [viewingAgentId, setViewingAgentId] = useState<string | null>(null);
  const [agentLogs, setAgentLogs] = useState<Array<{ stream: string; content: string; timestamp: number }>>([]);
  const agentLogsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const agentLogsEndRef = useRef<HTMLDivElement>(null);

  // Mobile: file tree visibility
  const [showFileTree, setShowFileTree] = useState(true);

  // Split view state
  const [splitFileIdx, setSplitFileIdx] = useState<number | null>(null);

  // Quick-spawn mini form
  const [showQuickSpawn, setShowQuickSpawn] = useState(false);
  const [quickSpawnTask, setQuickSpawnTask] = useState('');
  const [quickSpawnModel, setQuickSpawnModel] = useState('sonnet');
  const [quickSpawnType, setQuickSpawnType] = useState('claude');
  const [quickSpawning, setQuickSpawning] = useState(false);

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

  // Cleanup timer refs on unmount to prevent leaks
  useEffect(() => {
    return () => {
      if (chatTimerRef.current) clearInterval(chatTimerRef.current);
      if (agentLogsPollRef.current) clearInterval(agentLogsPollRef.current);
    };
  }, []);

  // Load recent repos + last open repo from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('boardroom:recent-repos');
      if (stored) setRecentRepos(JSON.parse(stored));
      const lastRepo = localStorage.getItem('boardroom:workspace-repo');
      if (lastRepo) { setRepo(lastRepo); setRepoInput(lastRepo); }
    } catch {}
  }, []);

  // Close repo dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target as Node)) {
        setRepoDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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
        if (data.branch !== undefined) setRepoBranch(data.branch);
      }
      setDirContents(prev => ({ ...prev, [dirPath]: data.entries }));
    }
  }, [repo]);

  // Open repo
  const openRepo = (r: string) => {
    setRepo(r);
    setCurrentPath('');
    setOpenFiles([]);
    setActiveFileIdx(0);
    setEditedContent(null);
    setIsEditing(false);
    setExpandedDirs(new Set());
    setDirContents({});
    saveRecentRepo(r);
    localStorage.setItem('boardroom:workspace-repo', r);
  };

  useEffect(() => {
    if (repo) fetchDir('');
  }, [repo, fetchDir]);

  // Fetch file content — adds a new tab or switches to existing
  // When split is active, clicking a file opens it in the right pane instead
  const openFile = async (filePath: string) => {
    // If already open, just switch to it (or set as split target)
    const existingIdx = openFiles.findIndex(f => f.path === filePath);
    if (existingIdx !== -1) {
      if (splitFileIdx !== null) {
        setSplitFileIdx(existingIdx);
      } else {
        setActiveFileIdx(existingIdx);
        setEditedContent(null);
        setIsEditing(false);
      }
      setActiveTab('code');
      return;
    }
    const res = await fetch(`/api/files?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(filePath)}&action=read`);
    const data = await res.json();
    if (data.content !== undefined) {
      setOpenFiles(prev => {
        const next = [...prev, { path: filePath, content: data.content, ext: data.extension }];
        const newIdx = next.length - 1;
        if (splitFileIdx !== null) {
          setSplitFileIdx(newIdx);
        } else {
          setActiveFileIdx(newIdx);
        }
        return next;
      });
      if (splitFileIdx === null) {
        setEditedContent(null);
        setIsEditing(false);
      }
      setActiveTab('code');
      setTimeout(() => codeViewerRef.current?.scrollTo(0, 0), 0);
    }
  };

  // Close a tab
  const closeTab = (idx: number) => {
    setOpenFiles(prev => {
      const next = prev.filter((_, i) => i !== idx);
      setActiveFileIdx(i => {
        if (next.length === 0) return 0;
        if (i >= next.length) return next.length - 1;
        if (i > idx) return i - 1;
        return i;
      });
      return next;
    });
    setEditedContent(null);
    setIsEditing(false);
  };

  // Save file via PUT
  const saveFile = useCallback(async () => {
    if (!activeFile || editedContent === null) return;
    setSaving(true);
    try {
      const res = await fetch('/api/files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, path: activeFile.path, content: editedContent }),
      });
      const data = await res.json();
      if (data.ok) {
        // Update tab content
        setOpenFiles(prev => prev.map((f, i) =>
          i === activeFileIdx ? { ...f, content: editedContent } : f
        ));
        setEditedContent(null);
        setIsEditing(false);
      }
    } catch {}
    setSaving(false);
  }, [activeFile, editedContent, repo, activeFileIdx]);

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

  // Cmd+S / Ctrl+S to save in edit mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isEditing && editedContent !== null) {
          saveFile();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isEditing, editedContent, saveFile]);

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
    setPrBehindBy(0);
    setActiveTab('prs');
    if (pr.agent_id) {
      // Get agent to find repo
      const agentRes = await fetch(`/api/agents/${pr.agent_id}`);
      const agentData = await agentRes.json();
      const agentRepo = agentData.agent?.repo;
      if (agentRepo) {
        const diffRes = await fetch(`/api/diff?repo=${encodeURIComponent(agentRepo)}&branch=${encodeURIComponent(pr.branch)}&base=${encodeURIComponent(pr.base_branch)}`);
        const diffJson = await diffRes.json();
        if (diffJson.diff) setPrDiff(parseDiff(diffJson.diff));
        if (typeof diffJson.behindBy === 'number') setPrBehindBy(diffJson.behindBy);
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
    if (action === 'approve') {
      globalToast.success('PR approved & merged');
    } else {
      globalToast.info('PR rejected');
    }
    fetchPRs();
    setSelectedPR(null);
    setPrDiff([]);
    setPrBehindBy(0);
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

  // Quick-spawn handler (from agent panel mini form)
  const handleQuickSpawn = async () => {
    if (!quickSpawnTask.trim() || !repo) return;
    setQuickSpawning(true);
    try {
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: quickSpawnTask, type: quickSpawnType, repo, useGitIsolation: true, model: quickSpawnModel }),
      });
      setQuickSpawnTask('');
      setShowQuickSpawn(false);
      fetchAgents();
    } catch {}
    setQuickSpawning(false);
  };

  // Agent terminal: fetch logs and start/stop polling
  const fetchAgentLogs = useCallback(async (agentId: string) => {
    try {
      const res = await fetch(`/api/agents/${agentId}`);
      const data = await res.json();
      if (data.agent?.logs) {
        setAgentLogs(data.agent.logs);
        setTimeout(() => agentLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
      return data.agent?.status;
    } catch {}
  }, []);

  const openAgentTerminal = useCallback(async (agentId: string) => {
    setViewingAgentId(agentId);
    setAgentLogs([]);
    if (agentLogsPollRef.current) clearInterval(agentLogsPollRef.current);
    const status = await fetchAgentLogs(agentId);
    if (status === 'running' || status === 'spawning') {
      agentLogsPollRef.current = setInterval(async () => {
        const s = await fetchAgentLogs(agentId);
        if (s !== 'running' && s !== 'spawning') {
          if (agentLogsPollRef.current) { clearInterval(agentLogsPollRef.current); agentLogsPollRef.current = null; }
        }
      }, 3000);
    }
  }, [fetchAgentLogs]);

  const closeAgentTerminal = useCallback(() => {
    setViewingAgentId(null);
    setAgentLogs([]);
    if (agentLogsPollRef.current) { clearInterval(agentLogsPollRef.current); agentLogsPollRef.current = null; }
  }, []);

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

  // Semantic search handler
  const runSemanticSearch = async (q: string) => {
    if (!q.trim() || !repo) return;
    setSemanticLoading(true);
    setSemanticResults([]);
    try {
      const res = await fetch(`/api/semantic-search?repo=${encodeURIComponent(repo)}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSemanticResults(data.results || []);
    } catch {}
    setSemanticLoading(false);
  };

  // AI diff review handler
  const runDiffReview = async () => {
    if (!diffData?.diff || diffReviewLoading) return;
    setDiffReviewLoading(true);
    setDiffReview(null);
    const truncated = diffData.diff.slice(0, 3000);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[workspace diff review] Review this git diff and annotate each change with a brief explanation of what it does and any concerns:\n\n${truncated}`,
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text') text += event.content;
          } catch {}
        }
      }
      setDiffReview(text || 'No review generated.');
      setDiffReviewOpen(true);
    } catch {
      setDiffReview('Failed to get AI review.');
      setDiffReviewOpen(true);
    }
    setDiffReviewLoading(false);
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
              openFiles[activeFileIdx]?.path === entry.path && activeTab === 'code' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
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
            {entry.gitStatus && (
              entry.gitStatus === 'deleted' ? (
                <span className="ml-1 text-[9px] text-red-400 line-through flex-shrink-0" title="deleted">D</span>
              ) : entry.gitStatus === 'untracked' ? (
                <span className="ml-1 text-[9px] text-zinc-500 flex-shrink-0" title="untracked">U</span>
              ) : entry.gitStatus === 'added' ? (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" title="added" />
              ) : (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="modified" />
              )
            )}
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
                  <button onClick={() => setBrowsing(false)} className="text-zinc-600 hover:text-zinc-400" aria-label="Close browser">
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
        <button onClick={() => { setRepo(''); setOpenFiles([]); setActiveFileIdx(0); setEditedContent(null); setIsEditing(false); localStorage.removeItem('boardroom:workspace-repo'); }} className="text-zinc-600 hover:text-zinc-400">
          <Home className="w-3.5 h-3.5" />
        </button>
        <h1 className="font-mono text-sm text-zinc-100">workspace</h1>
        <Separator orientation="vertical" className="h-4" />
        {/* Repo path — clickable for switcher */}
        <div className="relative" ref={repoDropdownRef}>
          <button
            onClick={() => setRepoDropdownOpen(o => !o)}
            className="flex items-center gap-1 font-mono text-[10px] text-zinc-500 hover:text-zinc-300 truncate max-w-[300px] transition-colors"
            title={repo}
          >
            {repo}
            <ChevronDown className="w-3 h-3 flex-shrink-0 text-zinc-700" />
          </button>
          {repoDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 w-72 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden">
              {recentRepos.filter(r => r !== repo).length > 0 ? (
                <div>
                  <div className="px-3 py-1.5 border-b border-zinc-800">
                    <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">recent repos</span>
                  </div>
                  {recentRepos.filter(r => r !== repo).map((r) => (
                    <button
                      key={r}
                      onClick={() => { openRepo(r); setRepoDropdownOpen(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-zinc-900 transition-colors group"
                    >
                      <div className="font-mono text-[11px] text-zinc-300 truncate">{r.split('/').pop()}</div>
                      <div className="font-mono text-[10px] text-zinc-600 truncate">{r}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-2 text-[10px] font-mono text-zinc-700">no other recent repos</div>
              )}
              <div className="border-t border-zinc-800">
                <button
                  onClick={() => { setRepo(''); setOpenFiles([]); setActiveFileIdx(0); setEditedContent(null); setIsEditing(false); localStorage.removeItem('boardroom:workspace-repo'); setRepoDropdownOpen(false); }}
                  className="w-full text-left flex items-center gap-1.5 px-3 py-2 hover:bg-zinc-900 transition-colors text-zinc-500 hover:text-zinc-300"
                >
                  <Plus className="w-3 h-3" />
                  <span className="font-mono text-[10px]">open another repo</span>
                </button>
              </div>
            </div>
          )}
        </div>
        {repoBranch && (
          <span className="flex items-center gap-1 font-mono text-[10px] text-emerald-400/80 flex-shrink-0">
            <GitBranch className="w-3 h-3" />
            {repoBranch}
          </span>
        )}

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
          {activeTab === 'diff' && diffFiles.length > 0 && (
            <button
              onClick={runDiffReview}
              disabled={diffReviewLoading}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono transition-colors text-zinc-500 hover:text-zinc-300 border border-zinc-700/40 hover:border-zinc-600 disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3" />
              {diffReviewLoading ? 'reviewing...' : 'AI review'}
            </button>
          )}
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
          <button
            onClick={() => setActiveTab('fleet')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono transition-colors ${
              activeTab === 'fleet' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Bot className="w-3 h-3" /> fleet
            {agents.filter(a => a.status === 'running' || a.status === 'spawning').length > 0 && (
              <Badge className="text-[8px] h-4 px-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/25">
                {agents.filter(a => a.status === 'running' || a.status === 'spawning').length}
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
            ) : chatOpen ? 'orchestrator' : null}
          </button>
        </div>
      </div>

      {/* Main: sidebar + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File tree sidebar */}
        {!showFileTree && (
          <button
            onClick={() => setShowFileTree(true)}
            className="flex-shrink-0 w-8 border-r border-zinc-800 flex items-center justify-center hover:bg-zinc-900 transition-colors"
            title="Show file tree"
          >
            <FolderOpen className="w-3.5 h-3.5 text-zinc-600" />
          </button>
        )}
        <div className={`w-[220px] flex-shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-950/30 ${showFileTree ? 'flex flex-col' : 'hidden'}`}>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">files</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => fetchDir('')} className="text-zinc-700 hover:text-zinc-400">
                <RefreshCw className="w-3 h-3" />
              </button>
              <button onClick={() => setShowFileTree(false)} className="text-zinc-700 hover:text-zinc-400 md:hidden" title="Collapse file tree" aria-label="Collapse file tree">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="px-2 pb-1">
            {/* Search mode toggle */}
            <div className="flex items-center gap-1 mb-1.5">
              <button
                onClick={() => setSearchMode('files')}
                className={`flex-1 py-0.5 rounded text-[9px] font-mono transition-colors ${searchMode === 'files' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'}`}
              >
                files
              </button>
              <button
                onClick={() => setSearchMode('semantic')}
                className={`flex-1 py-0.5 rounded text-[9px] font-mono transition-colors flex items-center justify-center gap-0.5 ${searchMode === 'semantic' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'}`}
              >
                <Sparkles className="w-2.5 h-2.5" /> semantic
              </button>
            </div>
            {searchMode === 'files' ? (
              <input
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="search files..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-400 placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600"
              />
            ) : (
              <div className="flex items-center gap-1">
                <input
                  value={semanticQuery}
                  onChange={(e) => setSemanticQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSemanticSearch(semanticQuery)}
                  placeholder="authentication logic..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-400 placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600"
                />
                <button
                  onClick={() => runSemanticSearch(semanticQuery)}
                  disabled={semanticLoading}
                  className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:opacity-50"
                >
                  <Search className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          {/* Semantic search results */}
          {searchMode === 'semantic' && (
            <div className="px-2 pb-1">
              {semanticLoading && (
                <div className="text-[10px] font-mono text-zinc-600 py-2 text-center animate-pulse">searching...</div>
              )}
              {!semanticLoading && semanticResults.length > 0 && (
                <div className="space-y-0.5">
                  {semanticResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => openFile(r.file.startsWith(repo) ? r.file.slice(repo.length).replace(/^\//, '') : r.file)}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-800/60 transition-colors group"
                    >
                      <div className="font-mono text-[10px] text-zinc-400 truncate group-hover:text-zinc-200">
                        {r.file.startsWith(repo) ? r.file.slice(repo.length).replace(/^\//, '') : r.file}
                      </div>
                      <div className="font-mono text-[9px] text-zinc-600 truncate mt-0.5">
                        L{r.line}: {r.context.trim().slice(0, 60)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!semanticLoading && semanticQuery && semanticResults.length === 0 && (
                <div className="text-[10px] font-mono text-zinc-700 py-2 text-center">no matches</div>
              )}
            </div>
          )}
          {searchMode === 'files' && (
            entries.length > 0
              ? renderTree(entries, 0, fileSearch)
              : <div className="px-3 py-4 text-[10px] font-mono text-zinc-700 text-center">loading...</div>
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
        <div className="flex-1 overflow-auto flex flex-col min-w-0">
          {/* Agent terminal view — replaces code viewer when an agent is selected */}
          {viewingAgentId && (
            <div className="flex-1 flex flex-col h-full bg-black overflow-hidden">
              {/* Terminal header */}
              <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/60">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-mono text-[10px] text-zinc-400">
                  {agents.find(a => a.id === viewingAgentId)?.name ?? viewingAgentId}
                </span>
                {(() => {
                  const a = agents.find(ag => ag.id === viewingAgentId);
                  return a ? (
                    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
                      a.status === 'running' ? 'text-emerald-400 bg-emerald-500/10'
                        : a.status === 'done' ? 'text-zinc-500 bg-zinc-800'
                        : a.status === 'error' || a.status === 'killed' ? 'text-red-400 bg-red-500/10'
                        : 'text-blue-400 bg-blue-500/10'
                    }`}>{a.status}</span>
                  ) : null;
                })()}
                {(() => {
                  const a = agents.find(ag => ag.id === viewingAgentId);
                  return a && (a.status === 'running' || a.status === 'spawning') ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                  ) : null;
                })()}
                <button
                  onClick={closeAgentTerminal}
                  className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono text-zinc-500 hover:text-zinc-200 border border-zinc-700/40 hover:border-zinc-600 transition-colors"
                >
                  <X className="w-2.5 h-2.5" /> close
                </button>
              </div>
              {/* Log output */}
              <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-5">
                {agentLogs.length === 0 ? (
                  <div className="text-zinc-600 py-4 text-center">no logs yet...</div>
                ) : (
                  agentLogs.map((log, i) => (
                    <div key={i} className={`whitespace-pre-wrap break-all ${
                      log.stream === 'stderr' ? 'text-red-400'
                        : log.stream === 'system' ? 'text-zinc-500'
                        : 'text-green-400'
                    }`}>
                      {log.content}
                    </div>
                  ))
                )}
                <div ref={agentLogsEndRef} />
              </div>
            </div>
          )}

          {/* Code view */}
          {!viewingAgentId && activeTab === 'code' && (
            <div className="h-full flex flex-col">
              {/* Tab bar */}
              {openFiles.length > 0 && (
                <div className="flex-shrink-0 flex items-center gap-0 border-b border-zinc-800 bg-zinc-950/60 overflow-x-auto">
                  {openFiles.map((f, idx) => {
                    const name = f.path.split('/').pop() || f.path;
                    const isActive = idx === activeFileIdx;
                    const isDirty = isActive && editedContent !== null && editedContent !== f.content;
                    return (
                      <div
                        key={f.path}
                        className={`flex items-center gap-1 px-2 py-1 border-r border-zinc-800 cursor-pointer flex-shrink-0 max-w-[140px] group transition-colors ${
                          isActive ? 'bg-zinc-900 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300'
                        }`}
                        onClick={() => { setActiveFileIdx(idx); setEditedContent(null); setIsEditing(false); }}
                      >
                        <span className="text-[10px] font-mono truncate" title={f.path}>{name}</span>
                        {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="unsaved" />}
                        <button
                          onClick={(e) => { e.stopPropagation(); closeTab(idx); }}
                          className={`flex-shrink-0 text-zinc-600 hover:text-zinc-300 transition-opacity ml-0.5 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                          aria-label="Close tab"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeFile ? (
                <>
                  {/* File header */}
                  <div className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800 bg-zinc-900/30 flex-shrink-0">
                    <FileCode className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                    {/* Breadcrumb path segments */}
                    <div className="flex items-center gap-0.5 font-mono text-[11px] overflow-hidden">
                      {activeFile.path.split('/').map((segment, idx, arr) => {
                        const isLast = idx === arr.length - 1;
                        const dirPath = arr.slice(0, idx + 1).join('/');
                        return (
                          <span key={idx} className="flex items-center gap-0.5 flex-shrink-0">
                            {!isLast ? (
                              <button
                                onClick={() => toggleDir(dirPath)}
                                className="text-zinc-500 hover:text-zinc-200 transition-colors px-0.5 py-0 rounded hover:bg-zinc-800"
                              >
                                {segment}
                              </button>
                            ) : (
                              <span className="text-zinc-200">{segment}</span>
                            )}
                            {!isLast && <ChevronRight className="w-3 h-3 text-zinc-700 flex-shrink-0" />}
                          </span>
                        );
                      })}
                    </div>
                    <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[9px] font-mono text-zinc-600">
                        {(editedContent ?? activeFile.content).split('\n').length} lines
                      </span>
                      {editedContent !== null && editedContent !== activeFile.content && (
                        <span className="text-[9px] font-mono text-amber-400">unsaved</span>
                      )}
                      {isEditing && editedContent !== null && editedContent !== activeFile.content && (
                        <button
                          onClick={saveFile}
                          disabled={saving}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
                        >
                          <Save className="w-2.5 h-2.5" />
                          {saving ? 'saving...' : 'save'}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (splitFileIdx !== null) {
                            setSplitFileIdx(null);
                          } else {
                            setSplitFileIdx(activeFileIdx);
                          }
                        }}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                          splitFileIdx !== null ? 'bg-blue-700 text-blue-100' : 'text-zinc-500 hover:text-zinc-300 border border-zinc-700/50'
                        }`}
                        title={splitFileIdx !== null ? 'Close split view' : 'Split view'}
                      >
                        <span className="text-[8px]">⊟</span>
                        {splitFileIdx !== null ? 'close split' : 'split'}
                      </button>
                      <button
                        onClick={() => {
                          if (isEditing) {
                            setIsEditing(false);
                            setEditedContent(null);
                          } else {
                            setIsEditing(true);
                            setEditedContent(activeFile.content);
                          }
                        }}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                          isEditing ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300 border border-zinc-700/50'
                        }`}
                      >
                        <Pencil className="w-2.5 h-2.5" />
                        {isEditing ? 'cancel' : 'edit'}
                      </button>
                      <Badge variant="outline" className="text-[8px] font-mono">{langFromExt(activeFile.ext)}</Badge>
                    </div>
                  </div>

                  {/* Content: split view or single view */}
                  <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* Left pane (primary / edit pane) */}
                    <div className={`flex flex-col ${splitFileIdx !== null ? 'w-1/2 border-r border-zinc-800' : 'flex-1'}`}>
                      {isEditing ? (
                        <textarea
                          value={editedContent ?? activeFile.content}
                          onChange={(e) => setEditedContent(e.target.value)}
                          className="flex-1 w-full p-4 font-mono text-[11px] text-zinc-300 leading-5 bg-zinc-950 resize-none focus:outline-none border-0 h-full"
                          spellCheck={false}
                          autoCorrect="off"
                          autoCapitalize="off"
                        />
                      ) : (
                        <pre ref={codeViewerRef} className="flex-1 overflow-auto p-4 font-mono text-[11px] text-zinc-300 leading-5 bg-zinc-950">
                          {(editedContent ?? activeFile.content).split('\n').map((line, i) => (
                            <div key={i} className="flex hover:bg-zinc-900/30">
                              <span className="inline-block w-10 text-right pr-4 text-zinc-700 select-none flex-shrink-0">{i + 1}</span>
                              <span className="whitespace-pre">{highlightLine(line, activeFile.ext)}</span>
                            </div>
                          ))}
                        </pre>
                      )}
                    </div>

                    {/* Right pane (split view) */}
                    {splitFileIdx !== null && (() => {
                      const splitFile = openFiles[splitFileIdx] ?? null;
                      if (!splitFile) return null;
                      return (
                        <div className="w-1/2 flex flex-col">
                          <div className="flex items-center gap-1.5 px-3 py-1 border-b border-zinc-800 bg-zinc-900/20 flex-shrink-0">
                            <span className="font-mono text-[9px] text-zinc-500 truncate flex-1">{splitFile.path.split('/').pop()}</span>
                            <button
                              onClick={() => setSplitFileIdx(null)}
                              className="text-zinc-700 hover:text-zinc-400"
                              aria-label="Close split"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          <pre className="flex-1 overflow-auto p-4 font-mono text-[11px] text-zinc-300 leading-5 bg-zinc-950">
                            {splitFile.content.split('\n').map((line, i) => (
                              <div key={i} className="flex hover:bg-zinc-900/30">
                                <span className="inline-block w-10 text-right pr-4 text-zinc-700 select-none flex-shrink-0">{i + 1}</span>
                                <span className="whitespace-pre">{highlightLine(line, splitFile.ext)}</span>
                              </div>
                            ))}
                          </pre>
                        </div>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center h-full">
                  <div className="text-center">
                    <File className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                    <p className="font-mono text-xs text-zinc-600">select a file from the tree</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Diff view */}
          {!viewingAgentId && activeTab === 'diff' && (
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
                  <p className="font-mono text-[10px] text-zinc-700 mt-1">make edits or run an agent to see a diff here</p>
                </div>
              )}

              {/* AI Diff Review */}
              {(diffReview || diffReviewLoading) && (
                <div className="mt-4">
                  <button
                    onClick={() => setDiffReviewOpen(o => !o)}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-t-lg bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    <Sparkles className="w-3 h-3 text-blue-400" />
                    <span>AI review</span>
                    <ChevronRight className={`w-3 h-3 ml-auto transition-transform ${diffReviewOpen ? 'rotate-90' : ''}`} />
                  </button>
                  {diffReviewOpen && (
                    <div className="border border-t-0 border-zinc-800 rounded-b-lg bg-zinc-900 p-4">
                      {diffReviewLoading ? (
                        <div className="text-[11px] font-mono text-zinc-600 animate-pulse">reviewing diff...</div>
                      ) : (
                        <pre className="font-mono text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">{diffReview}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PR review view */}
          {!viewingAgentId && activeTab === 'prs' && (
            selectedPR ? (
              <div className="h-full flex flex-col">
                <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/30">
                  <GitBranch className="w-4 h-4 text-amber-400" />
                  <div>
                    <div className="font-mono text-xs text-zinc-200">{selectedPR.agent_name}</div>
                    <div className="font-mono text-[9px] text-zinc-500">{selectedPR.branch} → {selectedPR.base_branch}</div>
                  </div>
                  {prBehindBy > 0 && (
                    <span className="flex items-center gap-1 text-[9px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded px-2 py-0.5">
                      ⚠ {prBehindBy} commit{prBehindBy !== 1 ? 's' : ''} behind {selectedPR.base_branch} — may have conflicts
                    </span>
                  )}
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
                  <p className="font-mono text-[10px] text-zinc-700 mt-1">
                    {pendingPRs.length > 0 ? 'click a request in the sidebar to open it' : 'agents will create push requests when they finish work'}
                  </p>
                </div>
              </div>
            )
          )}

          {/* Fleet view — agent cards for this repo */}
          {!viewingAgentId && activeTab === 'fleet' && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-2">
                {(() => {
                  const now = Date.now();
                  const recentThreshold = 15 * 60 * 1000; // 15 minutes
                  const repoAgents = agents.filter(a => a.repo === repo && (a.status === 'running' || a.status === 'spawning' || (a.status === 'done' && now - a.created_at < recentThreshold) || a.status === 'error'));
                  const otherAgents = agents.filter(a => a.repo !== repo && (a.status === 'running' || a.status === 'spawning'));
                  if (repoAgents.length === 0 && otherAgents.length === 0) {
                    return (
                      <div className="flex-1 flex items-center justify-center h-64">
                        <div className="text-center">
                          <Bot className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                          <p className="font-mono text-xs text-zinc-600">no agents for this repo</p>
                          <p className="font-mono text-[10px] text-zinc-700 mt-1">use the + button or orchestrator to spawn agents</p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <>
                      {repoAgents.length > 0 && (
                        <div>
                          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">this repo ({repoAgents.length})</span>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            {repoAgents.sort((a, b) => b.created_at - a.created_at).map(a => (
                              <div key={a.id} className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 transition-colors">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                    a.status === 'running' ? 'bg-emerald-400 animate-pulse'
                                      : a.status === 'done' ? 'bg-emerald-400'
                                      : a.status === 'error' ? 'bg-red-400'
                                      : 'bg-zinc-600'
                                  }`} />
                                  <span className="font-mono text-xs text-zinc-200 truncate">{a.name}</span>
                                  <span className="text-[8px] font-mono text-zinc-600 ml-auto">{a.type}</span>
                                </div>
                                <p className="font-mono text-[10px] text-zinc-500 line-clamp-2">{a.task}</p>
                                <div className="flex items-center gap-2 mt-2">
                                  <span className={`text-[9px] font-mono ${
                                    a.status === 'done' ? 'text-emerald-500' : a.status === 'error' ? 'text-red-400' : a.status === 'running' ? 'text-blue-400' : 'text-zinc-600'
                                  }`}>{a.status}</span>
                                  {a.status === 'done' && (
                                    <button onClick={() => viewRepoDiff()} className="text-[8px] font-mono text-zinc-600 hover:text-zinc-300">diff</button>
                                  )}
                                  {a.status === 'running' && (
                                    <button onClick={() => { fetch(`/api/agents/${a.id}`, { method: 'DELETE' }); fetchAgents(); }} className="text-[8px] font-mono text-red-400/60 hover:text-red-400 ml-auto">kill</button>
                                  )}
                                  {(a.status === 'done' || a.status === 'error') && (
                                    <button onClick={() => { fetch(`/api/agents/${a.id}`, { method: 'DELETE' }); fetchAgents(); }} className="text-[8px] font-mono text-zinc-600 hover:text-zinc-400 ml-auto">remove</button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {otherAgents.length > 0 && (
                        <div className="mt-4">
                          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">other active ({otherAgents.length})</span>
                          <div className="mt-2 space-y-1">
                            {otherAgents.map(a => (
                              <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-mono text-zinc-500">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                                <span className="truncate">{a.name}</span>
                                <span className="text-zinc-700 ml-auto">{a.type}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Right panel: agent cards */}
        {showAgents && (
          <div className="hidden md:flex w-[260px] flex-shrink-0 border-l border-zinc-800 overflow-y-auto bg-zinc-950/30 flex-col relative">
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Bot className="w-3 h-3 text-zinc-600" />
                <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">agents</span>
                <Badge variant="outline" className="text-[8px] font-mono h-4 px-1">
                  {agents.filter(a => a.status === 'running' || a.status === 'spawning').length} active
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowQuickSpawn(s => !s)}
                  className={`p-0.5 rounded transition-colors ${showQuickSpawn ? 'text-emerald-400 bg-emerald-950/50' : 'text-zinc-600 hover:text-zinc-300'}`}
                  title="Quick spawn agent"
                  aria-label="Quick spawn"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setShowAgents(false)} className="text-zinc-700 hover:text-zinc-400" aria-label="Close agents panel">
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Quick-spawn mini form */}
            {showQuickSpawn && (
              <div className="mx-2 mb-2 p-2 rounded-lg border border-zinc-800 bg-zinc-900/60 space-y-1.5">
                <textarea
                  value={quickSpawnTask}
                  onChange={(e) => setQuickSpawnTask(e.target.value)}
                  placeholder="task description..."
                  rows={2}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600 resize-none"
                />
                <div className="flex items-center gap-1.5">
                  <select
                    value={quickSpawnType}
                    onChange={(e) => setQuickSpawnType(e.target.value)}
                    className="bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[9px] font-mono text-zinc-400 focus:outline-none"
                  >
                    <option value="claude">claude</option>
                    <option value="codex">codex</option>
                    <option value="opencode">opencode</option>
                    <option value="custom">custom</option>
                    <option value="test">test</option>
                  </select>
                  <select
                    value={quickSpawnModel}
                    onChange={(e) => setQuickSpawnModel(e.target.value)}
                    className="bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[9px] font-mono text-zinc-400 focus:outline-none"
                  >
                    <option value="sonnet">sonnet</option>
                    <option value="haiku">haiku</option>
                    <option value="opus">opus</option>
                  </select>
                  <button
                    onClick={handleQuickSpawn}
                    disabled={!quickSpawnTask.trim() || quickSpawning}
                    className="px-2 py-0.5 rounded text-[9px] font-mono bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-colors"
                  >
                    {quickSpawning ? 'spawning...' : 'spawn'}
                  </button>
                </div>
              </div>
            )}

            {/* Repo agents first */}
            {(() => {
              const now2 = Date.now();
              const thresh2 = 15 * 60 * 1000;
              const repoAgents = agents.filter(a => a.repo === repo && (a.status === 'running' || a.status === 'spawning' || (a.status === 'done' && now2 - a.created_at < thresh2) || a.status === 'error'));
              const otherAgents = agents.filter(a => a.repo !== repo && (a.status === 'running' || a.status === 'spawning'));

              return (
                <>
                  {repoAgents.length > 0 && (
                    <div className="px-2 mb-1">
                      <span className="text-[8px] font-mono text-zinc-700 uppercase px-1">this repo</span>
                      {repoAgents.map(a => (
                        <div key={a.id} className="px-2 py-2 rounded-lg hover:bg-zinc-900 transition-colors mb-0.5">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              a.status === 'running' ? 'bg-emerald-400 animate-pulse'
                                : a.status === 'done' ? 'bg-emerald-400'
                                : a.status === 'error' || a.status === 'killed' ? 'bg-red-400'
                                : a.status === 'spawning' ? 'bg-blue-400 animate-pulse'
                                : 'bg-zinc-600'
                            }`} />
                            <button
                              onClick={() => openAgentTerminal(a.id)}
                              className="font-mono text-[10px] text-zinc-300 truncate hover:text-emerald-400 transition-colors text-left flex-1 min-w-0"
                              title="View agent logs"
                            >
                              {a.name}
                            </button>
                            <span className={`text-[8px] font-mono flex-shrink-0 ${
                              a.status === 'running' ? 'text-emerald-400'
                                : a.status === 'done' ? 'text-zinc-600'
                                : a.status === 'error' ? 'text-red-400'
                                : 'text-zinc-600'
                            }`}>{a.status}</span>
                            {a.status === 'running' && (
                              <button
                                onClick={async (e) => { e.preventDefault(); await fetch(`/api/agents/${a.id}`, { method: 'DELETE' }); fetchAgents(); }}
                                className="flex-shrink-0 text-red-400/70 hover:text-red-400 px-0.5 py-0.5 rounded border border-red-500/20 hover:border-red-500/40 transition-colors"
                                title="kill agent"
                                aria-label="Kill agent"
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
            <div className="sticky bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--br-bg-secondary)] to-transparent pointer-events-none" />
          </div>
        )}

        {/* Show agents toggle when panel is hidden */}
        {!showAgents && (
          <button
            onClick={() => setShowAgents(true)}
            className="hidden md:flex flex-shrink-0 w-8 border-l border-zinc-800 items-center justify-center hover:bg-zinc-900 transition-colors"
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
              <button onClick={() => setChatOpen(false)} className="text-zinc-700 hover:text-zinc-400" aria-label="Close chat">
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
                          return null; // handled below
                        }).filter(Boolean)}
                        {/* Render non-thinking/waiting content as markdown */}
                        {(() => {
                          const contentLines = msg.content.split('\n').filter(line => {
                            const trimmed = line.trim();
                            return trimmed && !trimmed.startsWith('💭') && !trimmed.startsWith('⏳') && !trimmed.includes('waiting for');
                          });
                          if (contentLines.length === 0) return null;
                          const Md = require('@/components/Markdown').Markdown;
                          return (
                            <div className="px-2.5 py-1.5 bg-zinc-900 rounded border border-zinc-800/50">
                              <Md content={contentLines.join('\n')} className="text-zinc-300" />
                            </div>
                          );
                        })()}
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
            aria-label="Dismiss notification"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
