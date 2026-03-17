'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from './ui/label';
import { FolderOpen, FileText, Bot, Bug, TestTube, BookOpen, Wrench, Save, Trash2, Plus, X } from 'lucide-react';
import type { AgentType } from '@/types';

interface AgentConfig {
  slug: string;
  name: string;
  type: AgentType;
  model?: string;
  description: string;
  prompt: string;
}

interface SpawnModalProps {
  open: boolean;
  onClose: () => void;
  onSpawn: (data: { task: string; type: AgentType; repo?: string; useGitIsolation?: boolean; name?: string; model?: string; depends_on?: string[] }) => Promise<void>;
  onImport: (data: { path: string; name?: string; task?: string; type?: AgentType; model?: string }) => Promise<void>;
  existingAgents?: Array<{ id: string; name: string }>;
}

type ModalTab = 'spawn' | 'configs' | 'import';

const SLUG_ICONS: Record<string, typeof Bot> = {
  'code-reviewer': Bug,
  'test-writer': TestTube,
  'docs-generator': BookOpen,
  'refactor-agent': Wrench,
  'bug-fixer': Bug,
};

export function SpawnModal({ open, onClose, onSpawn, onImport, existingAgents = [] }: SpawnModalProps) {
  const [tab, setTab] = useState<ModalTab>('spawn');
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [configsLoaded, setConfigsLoaded] = useState(false);

  // Spawn fields
  const [task, setTask] = useState('');
  const [type, setType] = useState<AgentType>('claude');
  const [repo, setRepo] = useState('');
  const [useGitIsolation, setUseGitIsolation] = useState(false);
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Import fields
  const [importPath, setImportPath] = useState('');
  const [importName, setImportName] = useState('');
  const [importTask, setImportTask] = useState('');
  const [importType, setImportType] = useState<AgentType>('claude');
  const [importModel, setImportModel] = useState('');

  // Dependencies
  const [dependsOn, setDependsOn] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load configs when opening the modal
  useEffect(() => {
    if (open && !configsLoaded) {
      fetch('/api/agent-configs')
        .then(r => r.json())
        .then(data => { setConfigs(data.configs || []); setConfigsLoaded(true); })
        .catch(() => setConfigsLoaded(true));
    }
  }, [open, configsLoaded]);

  const resetForm = () => {
    setTask(''); setType('claude'); setRepo(''); setUseGitIsolation(false); setName(''); setModel(''); setDescription('');
    setImportPath(''); setImportName(''); setImportTask(''); setImportType('claude'); setImportModel('');
    setDependsOn([]);
    setError('');
  };

  const handleSpawnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) { setError('Task is required'); return; }
    setLoading(true); setError('');
    try {
      await onSpawn({ task: task.trim(), type, repo: repo.trim() || undefined, useGitIsolation: repo.trim() ? useGitIsolation : undefined, name: name.trim() || undefined, model: model.trim() || undefined, depends_on: dependsOn.length > 0 ? dependsOn : undefined });
      resetForm(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to spawn agent');
    } finally { setLoading(false); }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importPath.trim()) { setError('Directory path is required'); return; }
    setLoading(true); setError('');
    try {
      await onImport({
        path: importPath.trim(),
        name: importName.trim() || undefined,
        task: importTask.trim() || undefined,
        type: importType,
        model: importModel.trim() || undefined,
      });
      resetForm(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally { setLoading(false); }
  };

  const selectConfig = (config: AgentConfig) => {
    setTask(config.prompt);
    setType(config.type);
    setName(config.name);
    setModel(config.model || '');
    setTab('spawn');
  };

  const handleSaveConfig = async () => {
    if (!name.trim() || !task.trim()) { setError('Name and prompt are required to save'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/agent-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, model: model.trim() || undefined, description: description.trim(), prompt: task.trim() }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      setConfigsLoaded(false); // reload configs
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDeleteConfig = async (slug: string) => {
    try {
      await fetch('/api/agent-configs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      setConfigs(prev => prev.filter(c => c.slug !== slug));
    } catch { /* ignore */ }
  };

  const agentTypes: AgentType[] = ['claude', 'codex', 'custom', 'test'];

  return (
    <Dialog open={open} onOpenChange={() => { resetForm(); onClose(); }}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-zinc-100 flex items-center gap-3">
            <button
              type="button"
              onClick={() => { setTab('spawn'); setError(''); }}
              className={`transition-colors ${tab === 'spawn' ? 'text-zinc-100' : 'text-zinc-600 hover:text-zinc-400'}`}
            >
              spawn
            </button>
            <span className="text-zinc-700">/</span>
            <button
              type="button"
              onClick={() => { setTab('configs'); setError(''); }}
              className={`transition-colors flex items-center gap-1.5 ${tab === 'configs' ? 'text-zinc-100' : 'text-zinc-600 hover:text-zinc-400'}`}
            >
              <FileText className="w-3.5 h-3.5" />
              agents
            </button>
            <span className="text-zinc-700">/</span>
            <button
              type="button"
              onClick={() => { setTab('import'); setError(''); }}
              className={`transition-colors flex items-center gap-1.5 ${tab === 'import' ? 'text-zinc-100' : 'text-zinc-600 hover:text-zinc-400'}`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              import
            </button>
          </DialogTitle>
        </DialogHeader>

        {tab === 'configs' ? (
          /* ── AGENT CONFIGS ── */
          <div className="space-y-2">
            <p className="text-[10px] font-mono text-zinc-600 mb-2">
              Pre-configured agents from <code className="text-zinc-500">agents/*.md</code> — click to load into spawn form
            </p>
            {configs.length === 0 ? (
              <div className="text-center py-8 text-zinc-700 font-mono text-xs">
                {configsLoaded ? 'no agent configs found in agents/' : 'loading...'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
                {configs.map((config) => {
                  const Icon = SLUG_ICONS[config.slug] || Bot;
                  return (
                    <div
                      key={config.slug}
                      className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-600 hover:bg-zinc-900 transition-all group"
                    >
                      <button
                        type="button"
                        onClick={() => selectConfig(config)}
                        className="flex-1 flex items-start gap-3 text-left min-w-0"
                      >
                        <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-md bg-zinc-800 group-hover:bg-emerald-950 flex items-center justify-center transition-colors">
                          <Icon className="w-3.5 h-3.5 text-zinc-500 group-hover:text-emerald-400 transition-colors" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-zinc-200 group-hover:text-zinc-100">{config.name}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{config.type}</span>
                            {config.model && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-blue-400/70">{config.model}</span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-600 mt-0.5 line-clamp-2">{config.description}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteConfig(config.slug); }}
                        className="flex-shrink-0 mt-1 p-1 rounded text-zinc-700 hover:text-red-400 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete config"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose} className="font-mono text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
                cancel
              </Button>
            </DialogFooter>
          </div>
        ) : tab === 'spawn' ? (
          /* ── SPAWN ── */
          <form onSubmit={handleSpawnSubmit} className="space-y-4">
            {/* Task Templates */}
            {typeof window !== 'undefined' && (() => {
              const savedTemplates = JSON.parse(localStorage.getItem('boardroom:templates') || '{}');
              const templates = Object.entries(savedTemplates);
              return templates.length > 0 ? (
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs text-zinc-400">Quick Templates</Label>
                  <div className="flex flex-wrap gap-2">
                    {templates.map(([key, value]: [string, any]) => (
                      <div key={key} className="flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 hover:border-zinc-600 group">
                        <button
                          type="button"
                          onClick={() => {
                            setTask(value.task);
                            setType(value.type || 'claude');
                            setModel(value.model || '');
                          }}
                          className="text-xs font-mono text-zinc-300 hover:text-zinc-100 transition-colors flex-1"
                        >
                          {key}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = { ...savedTemplates };
                            delete updated[key];
                            localStorage.setItem('boardroom:templates', JSON.stringify(updated));
                            window.location.reload();
                          }}
                          className="p-0.5 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}

            <div className="space-y-1.5">
              <Label className="font-mono text-xs text-zinc-400">Task / Prompt</Label>
              <Textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="describe what the agent should do..."
                className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 resize-none h-24 focus:border-emerald-800 focus:ring-emerald-800/20"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="font-mono text-xs text-zinc-400">Agent Type</Label>
              <div className="flex gap-2">
                {agentTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`px-3 py-1.5 rounded text-xs font-mono border transition-colors ${
                      type === t
                        ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="font-mono text-xs text-zinc-400">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-agent"
                  className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-800"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="font-mono text-xs text-zinc-400">Repo Path</Label>
                <Input
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="/path/to/repo"
                  className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-800"
                />
                {repo.trim() && (
                  <button
                    type="button"
                    onClick={() => setUseGitIsolation(v => !v)}
                    className={`flex items-center gap-1.5 text-[10px] font-mono transition-colors ${
                      useGitIsolation ? 'text-emerald-400' : 'text-zinc-600 hover:text-zinc-400'
                    }`}
                    title="Create an isolated git worktree branch for this agent"
                  >
                    <span className={`inline-flex w-7 h-3.5 rounded-full border transition-colors ${
                      useGitIsolation ? 'bg-emerald-700 border-emerald-600' : 'bg-zinc-800 border-zinc-700'
                    } relative`}>
                      <span className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${
                        useGitIsolation ? 'translate-x-3.5' : ''
                      }`} />
                    </span>
                    git isolation
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="font-mono text-xs text-zinc-400">Model</Label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="sonnet"
                  className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-800"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="font-mono text-xs text-zinc-400">Description <span className="text-zinc-700">(for saving as agent)</span></Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="what this agent does..."
                className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-800"
              />
            </div>

            {/* Dependencies */}
            {existingAgents.length > 0 && (
              <div className="space-y-1.5">
                <Label className="font-mono text-xs text-zinc-400">Depends On <span className="text-zinc-700">(optional)</span></Label>
                <div className="flex flex-wrap gap-1.5">
                  {existingAgents.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setDependsOn(prev =>
                        prev.includes(a.id) ? prev.filter(x => x !== a.id) : [...prev, a.id]
                      )}
                      className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                        dependsOn.includes(a.id)
                          ? 'bg-blue-950 border-blue-700 text-blue-400'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                      }`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
                {dependsOn.length > 0 && (
                  <p className="text-[10px] font-mono text-zinc-600">{dependsOn.length} dependenc{dependsOn.length === 1 ? 'y' : 'ies'} selected</p>
                )}
              </div>
            )}

            {error && <p className="text-xs text-red-400 font-mono">{error}</p>}

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={onClose} className="font-mono text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" disabled={loading}>
                cancel
              </Button>
              {typeof window !== 'undefined' && task.trim().length > 15 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const tplName = prompt('Save as template (name):');
                    if (tplName?.trim()) {
                      const templates = JSON.parse(localStorage.getItem('boardroom:templates') || '{}');
                      templates[tplName.trim()] = { task, type, model };
                      localStorage.setItem('boardroom:templates', JSON.stringify(templates));
                      window.location.reload();
                    }
                  }}
                  className="font-mono text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  save template
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveConfig}
                disabled={saving || !name.trim() || !task.trim()}
                className="font-mono border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'saving...' : 'save agent'}
              </Button>
              <Button type="submit" disabled={loading || !task.trim()} className="font-mono bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
                {loading ? 'spawning...' : 'spawn agent'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          /* ── IMPORT ── */
          <form onSubmit={handleImportSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs text-zinc-400">Directory Path</Label>
              <Input
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
                placeholder="/path/to/project"
                className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-800"
                required
              />
              <p className="text-[10px] font-mono text-zinc-600">
                Point to any directory or git repo. Git repos get branch tracking + diff viewing.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="font-mono text-xs text-zinc-400">Task (optional — leave blank to import without running)</Label>
              <Textarea
                value={importTask}
                onChange={(e) => setImportTask(e.target.value)}
                placeholder="what should the agent do with this project..."
                className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 resize-none h-20 focus:border-emerald-800 focus:ring-emerald-800/20"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="font-mono text-xs text-zinc-400">Agent Type</Label>
                <div className="flex gap-1">
                  {(['claude', 'custom'] as AgentType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setImportType(t)}
                      className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                        importType === t
                          ? 'bg-purple-950 border-purple-700 text-purple-400'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="font-mono text-xs text-zinc-400">Name</Label>
                <Input
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="project-name"
                  className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-800"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="font-mono text-xs text-zinc-400">Model</Label>
                <Input
                  value={importModel}
                  onChange={(e) => setImportModel(e.target.value)}
                  placeholder="sonnet"
                  className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-800"
                />
              </div>
            </div>

            {error && <p className="text-xs text-red-400 font-mono">{error}</p>}

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={onClose} className="font-mono text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" disabled={loading}>
                cancel
              </Button>
              <Button type="submit" disabled={loading || !importPath.trim()} className="font-mono bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50">
                {loading ? 'importing...' : importTask.trim() ? 'import + run' : 'import'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
