'use client';
import { useState, useEffect } from 'react';
import { GitBranch, GitMerge, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Agent } from '@/types';

interface BranchInfo {
  agentId: string;
  agentName: string;
  status: string;
  branch?: string;
  baseBranch?: string;
  aheadBy?: number;
  changedFiles?: { path: string; status: string }[];
}

interface MergePanelProps {
  agents: Agent[];
}

export function MergePanel({ agents }: MergePanelProps) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState<string | null>(null);
  const [merged, setMerged] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const repoAgents = agents.filter(a => a.repo && (a.status === 'done' || a.status === 'idle'));

  useEffect(() => {
    if (repoAgents.length === 0) { setLoading(false); return; }

    Promise.all(
      repoAgents.map(async (agent) => {
        try {
          const res = await fetch(`/api/agents/${agent.id}/git`);
          const data = await res.json();
          return {
            agentId: agent.id,
            agentName: agent.name,
            status: agent.status,
            branch: data.git?.branch,
            baseBranch: data.git?.baseBranch,
            aheadBy: data.git?.aheadBy,
            changedFiles: data.git?.changedFiles,
          };
        } catch {
          return { agentId: agent.id, agentName: agent.name, status: agent.status };
        }
      })
    ).then(results => {
      setBranches(results.filter(b => b.branch));
      setLoading(false);
    });
  }, [agents]);

  const handleMerge = async (agentId: string) => {
    setMerging(agentId);
    setError('');
    try {
      const res = await fetch(`/api/agents/${agentId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge' }),
      });
      if (!res.ok) throw new Error('Merge failed');
      setMerged(prev => new Set([...prev, agentId]));
    } catch {
      setError(`Failed to merge ${agentId.slice(0, 8)}`);
    } finally {
      setMerging(null);
    }
  };

  if (loading) {
    return <div className="p-4 text-xs font-mono text-zinc-600">loading branches...</div>;
  }

  if (branches.length === 0) {
    return (
      <div className="p-6 text-center">
        <GitBranch className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
        <p className="text-xs font-mono text-zinc-600">no branches to merge</p>
        <p className="text-[10px] font-mono text-zinc-700 mt-1">agents need a repo + done status</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {error && <p className="text-xs font-mono text-red-400 px-3">{error}</p>}
      {branches.map((b) => (
        <div key={b.agentId} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-950">
          <GitBranch className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-zinc-200 truncate">{b.agentName}</span>
              <span className="text-[10px] font-mono text-zinc-600">{b.branch}</span>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              {b.aheadBy !== undefined && (
                <span className="text-[10px] font-mono text-emerald-500">{b.aheadBy} commit{b.aheadBy !== 1 ? 's' : ''} ahead</span>
              )}
              {b.changedFiles && (
                <span className="text-[10px] font-mono text-zinc-600">{b.changedFiles.length} file{b.changedFiles.length !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>
          {merged.has(b.agentId) ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Button
              size="sm"
              onClick={() => handleMerge(b.agentId)}
              disabled={merging !== null}
              className="font-mono text-[10px] h-6 px-2 bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {merging === b.agentId ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3 mr-1" />}
              merge
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
