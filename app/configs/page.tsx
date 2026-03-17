'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Bot, Plus, Trash2, Save, Upload, FileText } from 'lucide-react';
import type { AgentType } from '@/types';

interface AgentConfig {
  slug: string;
  name: string;
  type: AgentType;
  model?: string;
  description: string;
  prompt: string;
}

const AGENT_TYPES: AgentType[] = ['claude', 'codex', 'custom', 'test'];

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

  const selectConfig = (slug: string) => {
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
    setSelected(null);
    setEdName('');
    setEdType('claude');
    setEdModel('sonnet');
    setEdDescription('');
    setEdPrompt('');
    setIsNew(true);
    setDirty(true);
    setError('');
    setSuccess('');
    updateRaw('', 'claude', 'sonnet', '', '');
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
      setSuccess('Saved to agents/' + data.config.slug + '.md');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (slug: string) => {
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
          <h1 className="font-mono text-sm text-zinc-100">skills</h1>
          <span className="text-[10px] font-mono text-zinc-600">agents/*.md</span>
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
            new agent
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar — config list */}
        <div className="w-[240px] flex-shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-950/50">
          {loading ? (
            <div className="p-4 text-xs font-mono text-zinc-700 animate-pulse text-center">loading...</div>
          ) : configs.length === 0 ? (
            <div className="p-4 text-xs font-mono text-zinc-700">
              no configs found<br />
              <span className="text-zinc-600">create one with + new agent</span>
            </div>
          ) : (
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
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!hasEditor ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FileText className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                <p className="font-mono text-sm text-zinc-600">select an agent to edit</p>
                <p className="font-mono text-[10px] text-zinc-700 mt-1">or drag & drop .md files here</p>
              </div>
            </div>
          ) : (
            <>
              {/* Editor toolbar */}
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-zinc-400">
                    {isNew ? 'new agent' : `agents/${selected}.md`}
                  </span>
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
