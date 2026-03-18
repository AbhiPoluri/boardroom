'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Zap, Plus, Trash2, Save, Copy, Download, FolderOpen,
  FileText, Code2, BookOpen, Package, Eye, Upload, Sparkles, Info,
} from 'lucide-react';

interface SkillMeta {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  path: string;
  files: string[];
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
}

interface SkillDetail {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  content: string;
  files: Array<{ path: string; size: number }>;
}

// --- Draft persistence ---
const DRAFTS_KEY = 'boardroom:skill-drafts';
const ACTIVE_DRAFT_KEY = 'boardroom:skill-active-draft';

interface DraftState {
  id: string;
  selected: string | null; // skill name being edited
  isNew: boolean;
  name: string;
  desc: string;
  content: string;
  savedAt: number;
}

function loadDrafts(): DraftState[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const drafts = JSON.parse(raw) as DraftState[];
    // Expire drafts older than 7 days
    const valid = drafts.filter(d => Date.now() - d.savedAt < 7 * 24 * 60 * 60 * 1000);
    if (valid.length !== drafts.length) localStorage.setItem(DRAFTS_KEY, JSON.stringify(valid));
    return valid;
  } catch { return []; }
}

function saveDrafts(drafts: DraftState[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch {}
}

function getActiveDraftId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_DRAFT_KEY);
}

function setActiveDraftId(id: string | null) {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem(ACTIVE_DRAFT_KEY, id);
  else localStorage.removeItem(ACTIVE_DRAFT_KEY);
}

function genDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Editor
  const [edContent, setEdContent] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Draft state
  const [drafts, setDrafts] = useState<DraftState[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const isDirty = useRef(false);

  // New skill form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      setSkills(data.skills || []);
    } catch { setError('Failed to load skills'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  // Restore draft state from localStorage after mount
  useEffect(() => {
    const storedDrafts = loadDrafts();
    const storedActiveDraftId = getActiveDraftId();
    const storedActiveDraft = storedActiveDraftId
      ? storedDrafts.find(d => d.id === storedActiveDraftId)
      : null;

    if (storedDrafts.length > 0) setDrafts(storedDrafts);

    if (storedActiveDraft) {
      isDirty.current = false;
      setCurrentDraftId(storedActiveDraft.id);
      setNewName(storedActiveDraft.name);
      setNewDesc(storedActiveDraft.desc);
      setEdContent(storedActiveDraft.content);
      setIsNew(storedActiveDraft.isNew);

      if (storedActiveDraft.selected && !storedActiveDraft.isNew) {
        // Restore selection for existing skill draft — selectSkill will load detail
        setSelected(storedActiveDraft.selected);
        fetch(`/api/skills?name=${encodeURIComponent(storedActiveDraft.selected)}`)
          .then(r => r.json())
          .then(data => {
            if (data.skill) {
              setDetail(data.skill);
              // Keep draft content, not the saved content
              setEdContent(storedActiveDraft.content);
            }
          })
          .catch(() => {});
      }

      isDirty.current = true; // existing draft — keep auto-saving
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save current editor state as a draft (500ms debounce)
  useEffect(() => {
    if (!isNew && !selected) return;
    if (!currentDraftId && !isDirty.current) return;
    const timeout = setTimeout(() => {
      const draftId = currentDraftId || genDraftId();
      if (!currentDraftId) setCurrentDraftId(draftId);
      const draft: DraftState = {
        id: draftId,
        selected,
        isNew,
        name: isNew ? newName : (selected || ''),
        desc: newDesc,
        content: edContent,
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
  }, [selected, isNew, newName, newDesc, edContent, currentDraftId]);

  const deleteDraft = (draftId: string) => {
    setDrafts(prev => {
      const updated = prev.filter(d => d.id !== draftId);
      saveDrafts(updated);
      return updated;
    });
    if (currentDraftId === draftId) {
      setCurrentDraftId(null);
      setActiveDraftId(null);
    }
  };

  const loadDraftIntoEditor = (draft: DraftState) => {
    isDirty.current = false;
    setCurrentDraftId(draft.id);
    setActiveDraftId(draft.id);
    setSelected(draft.selected);
    setIsNew(draft.isNew);
    setNewName(draft.name);
    setNewDesc(draft.desc);
    setEdContent(draft.content);
    setError('');
    setSuccess('');

    if (draft.selected && !draft.isNew) {
      // Load detail for existing skill
      fetch(`/api/skills?name=${encodeURIComponent(draft.selected)}`)
        .then(r => r.json())
        .then(data => {
          if (data.skill) {
            setDetail(data.skill);
            setEdContent(draft.content);
          }
        })
        .catch(() => {});
    }

    isDirty.current = true;
  };

  const selectSkill = async (name: string) => {
    isDirty.current = false;
    setCurrentDraftId(null);
    setActiveDraftId(null);
    setSelected(name);
    setIsNew(false);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/skills?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (data.skill) {
        setDetail(data.skill);
        setEdContent(data.skill.content);
        setDirty(false);
      }
    } catch { setError('Failed to load skill'); }
  };

  const startNew = () => {
    const newDraftId = genDraftId();
    setCurrentDraftId(newDraftId);
    setActiveDraftId(newDraftId);
    setSelected(null);
    setDetail(null);
    setIsNew(true);
    setNewName('');
    setNewDesc('');
    setEdContent('');
    setDirty(false);
    setError('');
    setSuccess('');
  };

  const handleCreate = async () => {
    if (!newName.trim()) { setError('Name is required (kebab-case)'); return; }
    if (!newDesc.trim()) { setError('Description is required'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
          content: edContent.trim() || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      await fetchSkills();
      setIsNew(false);
      isDirty.current = false;
      if (currentDraftId) deleteDraft(currentDraftId);
      await selectSkill(newName.trim());
      setSuccess('Created');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally { setSaving(false); }
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selected, content: edContent }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      setDirty(false);
      isDirty.current = false;
      if (currentDraftId) deleteDraft(currentDraftId);
      setSuccess('Saved');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (name: string) => {
    try {
      await fetch('/api/skills', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setSkills(prev => prev.filter(s => s.name !== name));
      if (selected === name) { setSelected(null); setDetail(null); setIsNew(false); }
    } catch { setError('Failed to delete'); }
  };

  const handleDuplicate = async (name: string) => {
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'duplicate', name }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      const data = await res.json();
      await fetchSkills();
      await selectSkill(data.skill.name);
      setSuccess('Duplicated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate');
    }
  };

  const handleExport = (name: string) => {
    window.open(`/api/skills?export=${encodeURIComponent(name)}`, '_blank');
  };

  // --- Upload / drag-drop ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const processUploadedFile = async (file: File) => {
    if (!file.name.endsWith('.md')) { setError('Only .md files are supported'); return; }
    const text = await file.text();
    // Try to parse frontmatter
    const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    let name = file.name.replace(/\.md$/, '').replace(/^SKILL$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let description = '';

    if (fmMatch) {
      const meta: Record<string, string> = {};
      for (const line of fmMatch[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k && v) meta[k] = v;
      }
      if (meta.name) name = meta.name;
      if (meta.description) description = meta.description;
    }

    if (!name) { setError('Could not determine skill name from file'); return; }

    setUploading(true);
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || `Imported from ${file.name}`, content: fmMatch ? fmMatch[2].trim() : text.trim() }),
      });
      if (!res.ok) {
        // Skill might already exist — try PUT instead
        const putRes = await fetch('/api/skills', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, content: text }),
        });
        if (!putRes.ok) { const e = await putRes.json(); throw new Error(e.error); }
      }
      await fetchSkills();
      await selectSkill(name);
      setSuccess(`Imported ${file.name}`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to import ${file.name}`);
    } finally { setUploading(false); }
  };

  const processMultipleFiles = async (files: FileList | File[]) => {
    const mdFiles = Array.from(files).filter(f => f.name.endsWith('.md'));
    if (mdFiles.length === 0) { setError('No .md files found'); return; }
    if (mdFiles.length === 1) { await processUploadedFile(mdFiles[0]); return; }
    setUploading(true);
    let imported = 0;
    for (const file of mdFiles) {
      try { await processUploadedFile(file); imported++; } catch {}
    }
    setUploading(false);
    await fetchSkills();
    setSuccess(`Imported ${imported} of ${mdFiles.length} files`);
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    processMultipleFiles(files);
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; if (dragCounter.current === 1) setDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current === 0) setDragging(false); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCounter.current = 0; setDragging(false); if (e.dataTransfer.files.length > 0) processMultipleFiles(e.dataTransfer.files); };

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
        <div className="absolute inset-0 z-50 bg-amber-950/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-amber-500 rounded-lg m-2 pointer-events-none">
          <div className="text-center">
            <Upload className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <p className="font-mono text-sm text-amber-300">drop SKILL.md files to import</p>
            <p className="font-mono text-[10px] text-amber-500 mt-1">files with frontmatter are imported directly</p>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".md" multiple onChange={handleFileUpload} className="hidden" />

      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-sm text-zinc-100">skills</h1>
          <span className="text-[10px] font-mono text-zinc-600">~/.claude/skills/</span>
          <Badge variant="outline" className="text-[9px] font-mono">{skills.length}</Badge>
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
            new skill
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-[260px] flex-shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-950/50">
          {loading ? (
            <div className="p-4 text-xs font-mono text-zinc-700 animate-pulse text-center">loading...</div>
          ) : skills.length === 0 && !isNew ? (
            <div className="p-4 text-xs font-mono text-zinc-700 text-center">
              no skills found<br />
              <span className="text-zinc-600">create one, upload .md, or drag & drop</span>
            </div>
          ) : (
            <div className="py-1">
              {skills.map((skill) => (
                <button
                  key={skill.name}
                  onClick={() => selectSkill(skill.name)}
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors group ${
                    selected === skill.name
                      ? 'bg-zinc-800/80 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <Zap className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${selected === skill.name ? 'text-amber-400' : 'text-zinc-600'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate">{skill.name}</div>
                    <div className="font-mono text-[10px] text-zinc-600 line-clamp-2 mt-0.5">{skill.description}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      {skill.hasScripts && <Badge variant="outline" className="text-[8px] font-mono py-0 h-4">scripts</Badge>}
                      {skill.hasReferences && <Badge variant="outline" className="text-[8px] font-mono py-0 h-4">refs</Badge>}
                      {skill.hasAssets && <Badge variant="outline" className="text-[8px] font-mono py-0 h-4">assets</Badge>}
                      {skill.metadata?.version && (
                        <span className="text-[9px] font-mono text-zinc-700">v{skill.metadata.version}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Drafts */}
          {drafts.length > 0 && (
            <>
              <Separator className="my-2 bg-zinc-800" />
              <div className="px-2 pt-1 pb-1.5 flex items-center gap-1.5">
                <Eye className="w-3 h-3 text-amber-500/60" />
                <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">drafts</span>
                <Badge variant="outline" className="text-[8px] font-mono ml-auto h-4 px-1.5">
                  {drafts.length}
                </Badge>
              </div>
              {drafts.map((d) => (
                <div
                  key={d.id}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-all group/draft ${
                    currentDraftId === d.id
                      ? 'bg-amber-950/30 text-amber-300 ring-1 ring-amber-800/40'
                      : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-400'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadDraftIntoEditor(d)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="font-mono text-[11px] font-medium truncate">
                        {d.name || 'untitled'}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] font-mono text-zinc-700">
                          {d.isNew ? 'new' : 'edit'}
                        </span>
                        <span className="text-[9px] font-mono text-zinc-700">
                          {new Date(d.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[9px] font-mono text-zinc-600 ml-auto">
                          expires {Math.max(0, Math.ceil((d.savedAt + 7 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)))}d
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => deleteDraft(d.id)}
                      className="p-1 text-zinc-700 hover:text-red-400 opacity-0 group-hover/draft:opacity-100 transition-all flex-shrink-0"
                      title="Delete draft"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!hasEditor ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <Zap className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                <p className="font-mono text-sm text-zinc-500">select a skill to edit</p>
                <p className="font-mono text-[10px] text-zinc-700 mt-2 leading-relaxed">
                  skills are folders with a SKILL.md that teach Claude reusable workflows.
                  they load automatically when relevant and persist across conversations.
                </p>
                <div className="mt-5 p-3 rounded-lg border border-amber-800/30 bg-amber-950/20 text-left">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-[11px] font-mono text-amber-300">use the skill-creator for best results</p>
                      <p className="text-[10px] font-mono text-zinc-500 mt-1 leading-relaxed">
                        in Claude Code, run: <code className="text-amber-400/70 bg-zinc-900 px-1 rounded">/skill-creator</code> to interactively
                        build skills with proper frontmatter, trigger phrases, and validation.
                        you can then upload the generated SKILL.md here.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : isNew ? (
            /* New skill form */
            <div className="flex-1 overflow-y-auto p-5">
              <div className="max-w-xl space-y-4">
                <div className="flex items-start gap-2.5 p-3 rounded-lg border border-blue-800/30 bg-blue-950/15">
                  <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
                  <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">
                    for best results, use <code className="text-blue-400/70 bg-zinc-900 px-1 rounded">/skill-creator</code> in Claude Code — it walks you through use case definition, frontmatter generation, instruction writing, and validation. then upload the SKILL.md here. or create one manually below.
                  </p>
                </div>
                <h2 className="font-mono text-sm text-zinc-200">create new skill</h2>

                <div className="space-y-1.5">
                  <Label className="font-mono text-[10px] text-zinc-500">name (kebab-case)</Label>
                  <Input
                    value={newName}
                    onChange={(e) => { isDirty.current = true; setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }}
                    placeholder="my-skill-name"
                    className="font-mono text-sm h-8 bg-zinc-900 border-zinc-700 text-zinc-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="font-mono text-[10px] text-zinc-500">
                    description <span className="text-zinc-700">(what it does + when to trigger)</span>
                  </Label>
                  <Textarea
                    value={newDesc}
                    onChange={(e) => { isDirty.current = true; setNewDesc(e.target.value); }}
                    placeholder='Manages sprint planning in Linear. Use when user says "plan sprint", "create tasks", or "sprint planning".'
                    className="font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100 resize-none h-20"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="font-mono text-[10px] text-zinc-500">
                    instructions <span className="text-zinc-700">(SKILL.md body — optional, can edit after)</span>
                  </Label>
                  <Textarea
                    value={edContent}
                    onChange={(e) => { isDirty.current = true; setEdContent(e.target.value); }}
                    placeholder={"# My Skill\n\n## Instructions\n\n### Step 1: ...\nClear explanation of what happens.\n\n### Step 2: ...\n..."}
                    className="font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100 resize-none"
                    style={{ minHeight: '250px' }}
                    spellCheck={false}
                  />
                </div>

                {error && <p className="text-xs font-mono text-red-400">{error}</p>}

                <Button
                  onClick={handleCreate}
                  disabled={saving || !newName.trim() || !newDesc.trim()}
                  className="font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-white h-8 px-4"
                >
                  {saving ? 'creating...' : 'create skill'}
                </Button>
              </div>
            </div>
          ) : detail ? (
            /* Edit existing skill */
            <>
              {/* Toolbar */}
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-zinc-300">{detail.name}/</span>
                  <span className="font-mono text-[10px] text-zinc-600">SKILL.md</span>
                  {currentDraftId && (
                    <Badge className="text-[9px] font-mono bg-amber-500/15 text-amber-400 border-amber-500/25">
                      draft
                    </Badge>
                  )}
                  {dirty && <span className="text-[10px] font-mono text-amber-500">unsaved</span>}
                  {success && <span className="text-[10px] font-mono text-emerald-400">{success}</span>}
                  {error && <span className="text-[10px] font-mono text-red-400">{error}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" onClick={() => handleExport(detail.name)} className="h-7 px-2 text-zinc-500 hover:text-zinc-300" title="Export .md">
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" onClick={() => handleDuplicate(detail.name)} className="h-7 px-2 text-zinc-500 hover:text-zinc-300" title="Duplicate">
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" onClick={() => handleDelete(detail.name)} className="h-7 px-2 text-zinc-500 hover:text-red-400" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={saving || !dirty}
                    className="font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-white h-7 px-3 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5 mr-1" />
                    {saving ? 'saving...' : 'save'}
                  </Button>
                </div>
              </div>

              <div className="flex-1 flex overflow-hidden">
                {/* Main editor */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <Textarea
                    value={edContent}
                    onChange={(e) => { isDirty.current = true; setEdContent(e.target.value); setDirty(true); }}
                    className="flex-1 w-full font-mono text-sm bg-[#0a0a0a] text-zinc-200 border-0 rounded-none resize-none p-4 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                    spellCheck={false}
                  />
                </div>

                {/* Side panel — skill info */}
                <div className="w-[220px] flex-shrink-0 border-l border-zinc-800 overflow-y-auto bg-zinc-950/50 p-3 space-y-4">
                  {/* Metadata */}
                  <div>
                    <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mb-1.5">metadata</p>
                    <div className="space-y-1 text-[10px] font-mono">
                      {detail.metadata?.author && (
                        <div className="flex justify-between"><span className="text-zinc-600">author</span><span className="text-zinc-400">{detail.metadata.author}</span></div>
                      )}
                      {detail.metadata?.version && (
                        <div className="flex justify-between"><span className="text-zinc-600">version</span><span className="text-zinc-400">{detail.metadata.version}</span></div>
                      )}
                      {detail.license && (
                        <div className="flex justify-between"><span className="text-zinc-600">license</span><span className="text-zinc-400">{detail.license}</span></div>
                      )}
                      {detail.compatibility && (
                        <div><span className="text-zinc-600">compat</span><p className="text-zinc-500 mt-0.5">{detail.compatibility}</p></div>
                      )}
                    </div>
                  </div>

                  {/* Files */}
                  <div>
                    <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mb-1.5">files</p>
                    <div className="space-y-1">
                      {detail.files.map((f) => {
                        const name = f.path.split('/').pop() || f.path;
                        const isDir = name.endsWith('/');
                        const Icon = name === 'SKILL.md' ? FileText
                          : f.path.includes('scripts') ? Code2
                          : f.path.includes('references') ? BookOpen
                          : Package;
                        return (
                          <div key={f.path} className="flex items-center gap-1.5 text-[10px] font-mono">
                            <Icon className="w-3 h-3 text-zinc-700 flex-shrink-0" />
                            <span className="text-zinc-500 truncate flex-1">{f.path}</span>
                            {!isDir && <span className="text-zinc-700">{(f.size / 1024).toFixed(1)}k</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Quick ref */}
                  <div>
                    <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mb-1.5">invoke</p>
                    <code className="text-[10px] font-mono text-amber-400/70 bg-zinc-900 px-2 py-1 rounded block">/{detail.name}</code>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
