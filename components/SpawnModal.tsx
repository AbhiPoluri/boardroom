'use client';

import { useState } from 'react';
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
import type { AgentType } from '@/types';

interface SpawnModalProps {
  open: boolean;
  onClose: () => void;
  onSpawn: (data: { task: string; type: AgentType; repo?: string; name?: string }) => Promise<void>;
}

export function SpawnModal({ open, onClose, onSpawn }: SpawnModalProps) {
  const [task, setTask] = useState('');
  const [type, setType] = useState<AgentType>('claude');
  const [repo, setRepo] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) {
      setError('Task is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onSpawn({
        task: task.trim(),
        type,
        repo: repo.trim() || undefined,
        name: name.trim() || undefined,
      });
      // Reset form
      setTask('');
      setType('claude');
      setRepo('');
      setName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to spawn agent');
    } finally {
      setLoading(false);
    }
  };

  const agentTypes: AgentType[] = ['claude', 'codex', 'custom', 'test'];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-zinc-100">spawn agent</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs text-zinc-400">Name (optional)</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-agent"
                className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-800"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-xs text-zinc-400">Repo Path (optional)</Label>
              <Input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="/path/to/repo"
                className="font-mono text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-800"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 font-mono">{error}</p>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="font-mono text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              disabled={loading}
            >
              cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !task.trim()}
              className="font-mono bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              {loading ? 'spawning...' : 'spawn agent'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
