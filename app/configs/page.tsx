'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Bot, Plus, Trash2, Save, Upload, FileText, Eye, Package, ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentType } from '@/types';

interface AgentConfig {
  slug: string;
  name: string;
  type: AgentType;
  model?: string;
  description: string;
  prompt: string;
}

const AGENT_TYPES: AgentType[] = ['claude', 'codex', 'opencode', 'custom', 'test'];

// --- Agent Templates ---
interface AgentTemplate {
  name: string;
  desc: string;
  type: AgentType;
  model: string;
  prompt: string;
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  { name: 'code-reviewer', desc: 'Reviews PRs for bugs, security, and style', type: 'claude', model: 'sonnet', prompt: 'Review the code changes in this repo. Look for bugs, security issues, style violations, and logic errors. Provide clear, actionable feedback with line references where possible.' },
  { name: 'security-auditor', desc: 'Scans for OWASP top 10 vulnerabilities', type: 'claude', model: 'haiku', prompt: 'Audit this codebase for security vulnerabilities based on the OWASP Top 10. Check for SQL injection, XSS, CSRF, insecure dependencies, hardcoded secrets, and improper authentication. Report findings with severity levels.' },
  { name: 'test-writer', desc: 'Generates unit and integration tests', type: 'claude', model: 'sonnet', prompt: 'Write comprehensive tests for this codebase. Generate unit tests for business logic and utilities, integration tests for API endpoints and database operations, and edge case tests for critical paths. Use the existing test framework and conventions.' },
  { name: 'docs-generator', desc: 'Creates README, API docs, and comments', type: 'claude', model: 'haiku', prompt: 'Generate documentation for this codebase. Create or update the README with setup instructions, usage examples, and architecture overview. Add JSDoc/docstring comments to undocumented functions. Document API endpoints if present.' },
  { name: 'refactorer', desc: 'Simplifies and cleans up code', type: 'claude', model: 'sonnet', prompt: 'Refactor this code to improve readability, maintainability, and performance. Eliminate duplication, simplify complex logic, improve naming, and apply appropriate design patterns. Keep behavior identical while improving structure.' },
  { name: 'dependency-updater', desc: 'Updates packages and fixes breaking changes', type: 'claude', model: 'sonnet', prompt: 'Check for outdated dependencies in this project. Identify packages that have newer versions, assess breaking changes, update package files, and fix any compatibility issues introduced by the updates. Prioritize security patches.' },
];

// --- Draft persistence ---
const DRAFTS_KEY = 'boardroom:config-drafts';
const ACTIVE_DRAFT_KEY = 'boardroom:config-active-draft';

interface DraftState {
  id: string;
  selected: string | null;
  isNew: boolean;
  name: string;
  type: string;
  model: string;
  description: string;
  prompt: string;
  savedAt: number;
}

function loadDrafts(): DraftState[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]'); } catch { return []; }
}

function saveDrafts(drafts: DraftState[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch {}
}

function getActiveDraftId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_DRAFT_KEY) || null;
}

function setActiveDraftId(id: string | null) {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem(ACTIVE_DRAFT_KEY, id);
  else localStorage.removeItem(ACTIVE_DRAFT_KEY);
}

function genDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function ConfigsPage() {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Editor state
  const [edName, setEdName] = useState('');
  const [edType, setEdType] = useState<AgentType>('claude');
  const [edModel, setEdModel] = useState('');
  const [edDescription, setEdDescription] = useState('');
  const [edPrompt, setEdPrompt] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Draft state
  const [drafts, setDrafts] = useState<DraftState[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const isDirty = useRef(false);

  // Templates section
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Raw markdown view
  const [rawMode, setRawMode] = useState(false);
  const [rawContent, setRawContent] = useState('');

  // Upload / drag-drop
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const processMdFile = async (file: File) => {
    if (!file.name.endsWith('.md')) {
      setError('Only .md files are supported');
      return;
    }
    const text = await file.text();
    const parsed = parseRaw(text);
    if (!parsed || !parsed.meta.name) {
      // No valid frontmatter — load into editor as new with filename as name
      const name = file.name.replace(/\.md$/, '');
      setSelected(null);
      setEdName(name);
      setEdType('claude');
      setEdModel('');
      setEdDescription('');
      setEdPrompt(text.trim());
      setIsNew(true);
      setDirty(true);
      setRawContent(text);
      setError('');
      setSuccess('');
      return;
    }
    // Valid frontmatter — save directly
    setUploading(true);
    try {
      const res = await fetch('/api/agent-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: parsed.meta.name,
          type: parsed.meta.type || 'claude',
          model: parsed.meta.model || undefined,
          description: parsed.meta.description || '',
          prompt: parsed.body,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      await fetchConfigs();
      selectConfig(data.config.slug);
      setSuccess(`Imported ${file.name}`);
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError(`Failed to import ${file.name}`);
    } finally {
      setUploading(false);
    }
  };

  const processMultipleFiles = async (files: FileList | File[]) => {
    const mdFiles = Array.from(files).filter(f => f.name.endsWith('.md'));
    if (mdFiles.length === 0) { setError('No .md files found'); return; }
    if (mdFiles.length === 1) {
      await processMdFile(mdFiles[0]);
      return;
    }
    // Multiple files — save all directly
    setUploading(true);
    let imported = 0;
    for (const file of mdFiles) {
      const text = await file.text();
      const parsed = parseRaw(text);
      const name = parsed?.meta.name || file.name.replace(/\.md$/, '');
      try {
        await fetch('/api/agent-configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            type: parsed?.meta.type || 'claude',
            model: parsed?.meta.model || undefined,
            description: parsed?.meta.description || '',
            prompt: parsed?.body || text.trim(),
          }),
        });
        imported++;
      } catch { /* skip failed */ }
    }
    await fetchConfigs();
    setUploading(false);
    setSuccess(`Imported ${imported} of ${mdFiles.length} files`);
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    processMultipleFiles(files);
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) processMultipleFiles(files);
  };

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-configs');
      const data = await res.json();
      setConfigs(data.configs || []);
    } catch {
      setError('Failed to load configs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  // Restore drafts from localStorage on mount
  useEffect(() => {
    const stored = loadDrafts();
    const activeId = getActiveDraftId();
    const active = activeId ? stored.find(d => d.id === activeId) : null;
    if (stored.length > 0) setDrafts(stored);
    if (active) {
      isDirty.current = false;
      setCurrentDraftId(active.id);
      setEdName(active.name);
      setEdType(active.type as AgentType);
      setEdModel(active.model);
      setEdDescription(active.description);
      setEdPrompt(active.prompt);
      setIsNew(active.isNew);
      if (active.selected) setSelected(active.selected);
      isDirty.current = true;
    }
  }, []);

  // Auto-save draft (500ms debounce)
  useEffect(() => {
    if (!isNew && !selected) return;
    if (!currentDraftId && !isDirty.current) return;
    const timeout = setTimeout(() => {
      const draftId = currentDraftId || genDraftId();
      if (!currentDraftId) setCurrentDraftId(draftId);
      const draft: DraftState = {
        id: draftId, selected, isNew, name: edName, type: edType,
        model: edModel, description: edDescription, prompt: edPrompt,
        savedAt: Date.now(),
      };
      setDrafts(prev => {
        const updated = prev.filter(d => d.id !== draftId);
        updated.unshift(draft);
        saveDrafts(updated);
        return updated;
      });
      setActiveDraftId(draftId);
    }, 500);
    return () => clearTimeout(timeout);
  }, [selected, isNew, edName, edType, edModel, edDescription, edPrompt, currentDraftId]);

  // Delete a draft
  const deleteDraft = (id: string) => {
    setDrafts(prev => {
      const updated = prev.filter(d => d.id !== id);
      saveDrafts(updated);
      return updated;
    });
    if (currentDraftId === id) {
      setCurrentDraftId(null);
      setActiveDraftId(null);
    }
  };

  // Load a draft into the editor
  const loadDraftIntoEditor = (d: DraftState) => {
    setCurrentDraftId(d.id);
    setActiveDraftId(d.id);
    setEdName(d.name);
    setEdType(d.type as AgentType);
    setEdModel(d.model);
    setEdDescription(d.description);
    setEdPrompt(d.prompt);
    setIsNew(d.isNew);
    if (d.selected) setSelected(d.selected);
    else setSelected(null);
    setDirty(true);
    isDirty.current = true;
    setError('');
    setSuccess('');
    updateRaw(d.name, d.type, d.model, d.description, d.prompt);
  };

  const selectConfig = (slug: string) => {
    isDirty.current = false;
    setCurrentDraftId(null);
    setActiveDraftId(null);
    const config = configs.find(c => c.slug === slug);
    if (!config) return;
    setSelected(slug);
    setEdName(config.name);
    setEdType(config.type);
    setEdModel(config.model || '');
    setEdDescription(config.description);
    setEdPrompt(config.prompt);
    setIsNew(false);
    setDirty(false);
    setError('');
    setSuccess('');
    updateRaw(config.name, config.type, config.model || '', config.description, config.prompt);
  };

  const startNew = () => {
    const newDraftId = genDraftId();
    setCurrentDraftId(newDraftId);
    setActiveDraftId(newDraftId);
    setSelected(null);
    setEdName('');
    setEdType('claude');
    setEdModel('sonnet');
    setEdDescription('');
    setEdPrompt('');
    setIsNew(true);
    setDirty(true);
    isDirty.current = true;
    setError('');
    setSuccess('');
    updateRaw('', 'claude', 'sonnet', '', '');
  };

  const loadTemplate = (t: AgentTemplate) => {
    const newDraftId = genDraftId();
    setCurrentDraftId(newDraftId);
    setActiveDraftId(newDraftId);
    setSelected(null);
    setEdName(t.name);
    setEdType(t.type);
    setEdModel(t.model);
    setEdDescription(t.desc);
    setEdPrompt(t.prompt);
    setIsNew(true);
    setDirty(true);
    isDirty.current = true;
    setError('');
    setSuccess('');
    updateRaw(t.name, t.type, t.model, t.desc, t.prompt);
  };

  const updateRaw = (name: string, type: string, model: string, desc: string, prompt: string) => {
    const lines = ['---', `name: ${name}`, `type: ${type}`];
    if (model) lines.push(`model: ${model}`);
    if (desc) lines.push(`description: ${desc}`);
    lines.push('---', '', prompt, '');
    setRawContent(lines.join('\n'));
  };

  const parseRaw = (raw: string) => {
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return null;
    const meta: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key && val) meta[key] = val;
    }
    return { meta, body: match[2].trim() };
  };

  const syncFromRaw = () => {
    const parsed = parseRaw(rawContent);
    if (!parsed) { setError('Invalid frontmatter format'); return; }
    setEdName(parsed.meta.name || '');
    setEdType((parsed.meta.type as AgentType) || 'claude');
    setEdModel(parsed.meta.model || '');
    setEdDescription(parsed.meta.description || '');
    setEdPrompt(parsed.body);
    setDirty(true);
  };

  // Keep raw in sync when editing fields
  const updateField = <T,>(setter: (v: T) => void, value: T, field: string) => {
    setter(value);
    setDirty(true);
    isDirty.current = true;
    // Rebuild raw from current + updated field
    const n = field === 'name' ? (value as string) : edName;
    const t = field === 'type' ? (value as string) : edType;
    const m = field === 'model' ? (value as string) : edModel;
    const d = field === 'description' ? (value as string) : edDescription;
    const p = field === 'prompt' ? (value as string) : edPrompt;
    updateRaw(n, t, m, d, p);
  };

  const handleSave = async () => {
    if (!edName.trim()) { setError('Name is required'); return; }
    if (!edPrompt.trim()) { setError('Prompt is required'); return; }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/agent-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: edName.trim(),
          type: edType,
          model: edModel.trim() || undefined,
          description: edDescription.trim(),
          prompt: edPrompt.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      const data = await res.json();
      await fetchConfigs();
      setSelected(data.config.slug);
      setIsNew(false);
      setDirty(false);
      isDirty.current = false;
      if (currentDraftId) deleteDraft(currentDraftId);
      setSuccess('Saved to agents/' + data.config.slug + '.md');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (slug: string) => {
    if (!confirm('Delete this agent config? This cannot be undone.')) return;
    try {
      await fetch('/api/agent-configs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      setConfigs(prev => prev.filter(c => c.slug !== slug));
      if (selected === slug) {
        setSelected(null);
        setIsNew(false);
        setEdName('');
        setEdPrompt('');
      }
    } catch {
      setError('Failed to delete');
    }
  };

  const hasEditor = isNew || selected;

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {dragging && (
        <div className="absolute inset-0 z-50 bg-emerald-950/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-emerald-500 rounded-lg m-2 pointer-events-none">
          <div className="text-center">
            <Upload className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="font-mono text-sm text-emerald-300">drop .md files to import</p>
            <p className="font-mono text-[10px] text-emerald-500 mt-1">files with frontmatter are saved directly</p>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md"
        multiple
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-sm text-zinc-100">personas</h1>
          <span className="text-[10px] font-mono text-zinc-600">personas</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            variant="outline"
            className="font-mono text-xs h-7 px-3 border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          >
            <Upload className="w-3.5 h-3.5 mr-1" />
            {uploading ? 'importing...' : 'upload .md'}
          </Button>
          <Button
            onClick={startNew}
            className="font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-white h-7 px-3"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            new persona
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar — config list */}
        <div className="w-[240px] flex-shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-950/50">
          {loading ? (
            <div className="p-4 text-xs font-mono text-zinc-700 animate-pulse text-center">loading...</div>
          ) : configs.length === 0 ? (
            <>
              <div className="p-4 text-xs font-mono text-zinc-700">
                no configs found<br />
                <span className="text-zinc-600">create one with + new persona</span>
              </div>
              {drafts.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Eye className="w-3 h-3 text-amber-500" />
                      <span className="text-[10px] font-mono text-amber-500 uppercase tracking-wider">drafts</span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-600">{drafts.length}</span>
                  </div>
                  {drafts.map(d => (
                    <div
                      key={d.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => loadDraftIntoEditor(d)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors group cursor-pointer ${
                        currentDraftId === d.id ? 'bg-amber-950/30 text-amber-300 ring-1 ring-amber-500/20' : 'text-zinc-500 hover:bg-zinc-900'
                      }`}
                    >
                      <Bot className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs truncate">{d.name || 'untitled'}</div>
                        <div className="font-mono text-[10px] text-zinc-600">{new Date(d.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteDraft(d.id); }}
                        className="p-0.5 text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </>
              )}
              {/* Templates section (empty state) */}
              <div className="border-t border-zinc-800 mt-2">
                <button
                  onClick={() => setTemplatesOpen(o => !o)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-zinc-900/60 transition-colors"
                >
                  {templatesOpen ? (
                    <ChevronDown className="w-3 h-3 text-zinc-600" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-zinc-600" />
                  )}
                  <Package className="w-3 h-3 text-zinc-500" />
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">persona templates</span>
                  <span className="ml-auto text-[10px] font-mono text-zinc-700">{AGENT_TEMPLATES.length}</span>
                </button>
                {templatesOpen && (
                  <div className="pb-2">
                    {AGENT_TEMPLATES.map((t) => (
                      <div
                        key={t.name}
                        className="mx-2 mb-1 rounded bg-zinc-900 border border-zinc-800 px-2.5 py-2 group hover:border-zinc-700 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[11px] text-zinc-300 truncate">{t.name}</div>
                            <div className="font-mono text-[10px] text-zinc-600 leading-tight mt-0.5 line-clamp-2">{t.desc}</div>
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-600 border border-zinc-700">{t.type}</span>
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-600 border border-zinc-700">{t.model}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => loadTemplate(t)}
                          className="mt-1.5 w-full text-center text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-700 text-zinc-500 hover:border-emerald-700 hover:text-emerald-400 hover:bg-emerald-950/30 transition-colors"
                        >
                          use
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="py-1">
                {configs.map((config) => (
                  <button
                    key={config.slug}
                    onClick={() => selectConfig(config.slug)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors group ${
                      selected === config.slug
                        ? 'bg-zinc-800/80 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    <Bot className={`w-3.5 h-3.5 flex-shrink-0 ${selected === config.slug ? 'text-emerald-400' : 'text-zinc-600'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs truncate">{config.name}</div>
                      <div className="font-mono text-[10px] text-zinc-600 truncate">{config.description || 'no description'}</div>
                    </div>
                    {config.model && (
                      <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 flex-shrink-0">
                        {config.model}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {drafts.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Eye className="w-3 h-3 text-amber-500" />
                      <span className="text-[10px] font-mono text-amber-500 uppercase tracking-wider">drafts</span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-600">{drafts.length}</span>
                  </div>
                  {drafts.map(d => (
                    <div
                      key={d.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => loadDraftIntoEditor(d)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors group cursor-pointer ${
                        currentDraftId === d.id ? 'bg-amber-950/30 text-amber-300 ring-1 ring-amber-500/20' : 'text-zinc-500 hover:bg-zinc-900'
                      }`}
                    >
                      <Bot className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs truncate">{d.name || 'untitled'}</div>
                        <div className="font-mono text-[10px] text-zinc-600">{new Date(d.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteDraft(d.id); }}
                        className="p-0.5 text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </>
              )}
              {/* Templates section */}
              <div className="border-t border-zinc-800 mt-2">
                <button
                  onClick={() => setTemplatesOpen(o => !o)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-zinc-900/60 transition-colors"
                >
                  {templatesOpen ? (
                    <ChevronDown className="w-3 h-3 text-zinc-600" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-zinc-600" />
                  )}
                  <Package className="w-3 h-3 text-zinc-500" />
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">persona templates</span>
                  <span className="ml-auto text-[10px] font-mono text-zinc-700">{AGENT_TEMPLATES.length}</span>
                </button>
                {templatesOpen && (
                  <div className="pb-2">
                    {AGENT_TEMPLATES.map((t) => (
                      <div
                        key={t.name}
                        className="mx-2 mb-1 rounded bg-zinc-900 border border-zinc-800 px-2.5 py-2 group hover:border-zinc-700 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[11px] text-zinc-300 truncate">{t.name}</div>
                            <div className="font-mono text-[10px] text-zinc-600 leading-tight mt-0.5 line-clamp-2">{t.desc}</div>
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-600 border border-zinc-700">{t.type}</span>
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-600 border border-zinc-700">{t.model}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => loadTemplate(t)}
                          className="mt-1.5 w-full text-center text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-700 text-zinc-500 hover:border-emerald-700 hover:text-emerald-400 hover:bg-emerald-950/30 transition-colors"
                        >
                          use
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!hasEditor ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FileText className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                <p className="font-mono text-sm text-zinc-600">select a persona to edit</p>
                <p className="font-mono text-[10px] text-zinc-700 mt-1">or drag & drop .md files here</p>
              </div>
            </div>
          ) : (
            <>
              {/* Editor toolbar */}
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-zinc-400">
                    {isNew ? 'new persona' : `agents/${selected}.md`}
                  </span>
                  {currentDraftId && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-500 border border-amber-800/30">draft</span>}
                  {dirty && <span className="text-[10px] font-mono text-amber-500">unsaved</span>}
                  {success && <span className="text-[10px] font-mono text-emerald-400">{success}</span>}
                  {error && <span className="text-[10px] font-mono text-red-400">{error}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (rawMode) syncFromRaw();
                      setRawMode(!rawMode);
                    }}
                    className={`font-mono text-[10px] px-2 py-1 rounded border transition-colors ${
                      rawMode
                        ? 'bg-zinc-800 border-zinc-600 text-zinc-300'
                        : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {rawMode ? 'form view' : 'raw md'}
                  </button>
                  {!isNew && selected && (
                    <Button
                      variant="ghost"
                      onClick={() => handleDelete(selected)}
                      className="h-7 px-2 text-zinc-600 hover:text-red-400 hover:bg-zinc-800"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button
                    onClick={handleSave}
                    disabled={saving || !edName.trim() || !edPrompt.trim()}
                    className="font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-white h-7 px-3 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5 mr-1" />
                    {saving ? 'saving...' : 'save'}
                  </Button>
                </div>
              </div>

              {/* Editor body */}
              <div className="flex-1 overflow-y-auto">
                {rawMode ? (
                  /* Raw markdown editor */
                  <Textarea
                    value={rawContent}
                    onChange={(e) => { setRawContent(e.target.value); setDirty(true); }}
                    className="w-full h-full font-mono text-sm bg-[#0a0a0a] text-zinc-200 border-0 rounded-none resize-none p-4 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                    spellCheck={false}
                  />
                ) : (
                  /* Form editor */
                  <div className="p-4 space-y-4 max-w-2xl">
                    {/* Frontmatter fields */}
                    <div className="space-y-3 p-3 rounded-lg border border-zinc-800 bg-zinc-950/50">
                      <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">frontmatter</p>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="font-mono text-[10px] text-zinc-500">name</Label>
                          <Input
                            value={edName}
                            onChange={(e) => updateField(setEdName, e.target.value, 'name')}
                            placeholder="my-agent"
                            className="font-mono text-sm h-8 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-700 focus:border-emerald-800"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="font-mono text-[10px] text-zinc-500">type</Label>
                          <div className="flex gap-1">
                            {AGENT_TYPES.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => updateField(setEdType, t, 'type')}
                                className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                                  edType === t
                                    ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                                    : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                                }`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="font-mono text-[10px] text-zinc-500">model</Label>
                          <Input
                            value={edModel}
                            onChange={(e) => updateField(setEdModel, e.target.value, 'model')}
                            placeholder="sonnet"
                            className="font-mono text-sm h-8 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-700 focus:border-emerald-800"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="font-mono text-[10px] text-zinc-500">description</Label>
                          <Input
                            value={edDescription}
                            onChange={(e) => updateField(setEdDescription, e.target.value, 'description')}
                            placeholder="what this agent does..."
                            className="font-mono text-sm h-8 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-700 focus:border-emerald-800"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Prompt body */}
                    <div className="space-y-1">
                      <Label className="font-mono text-[10px] text-zinc-500">prompt</Label>
                      <Textarea
                        value={edPrompt}
                        onChange={(e) => updateField(setEdPrompt, e.target.value, 'prompt')}
                        placeholder="Instructions for the agent..."
                        className="font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-700 resize-none focus:border-emerald-800 focus:ring-emerald-800/20"
                        style={{ minHeight: '300px' }}
                        spellCheck={false}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
