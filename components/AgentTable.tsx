'use client';

import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './StatusBadge';
import type { Agent } from '@/types';

interface AgentTableProps {
  agents: Agent[];
  onKill?: (id: string) => void;
}

export function AgentTable({ agents, onKill }: AgentTableProps) {
  if (agents.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-600 font-mono text-sm">
        no agents running. spawn one to get started.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            <TableHead className="font-mono text-xs text-zinc-500 uppercase tracking-wider">Name</TableHead>
            <TableHead className="font-mono text-xs text-zinc-500 uppercase tracking-wider">Type</TableHead>
            <TableHead className="font-mono text-xs text-zinc-500 uppercase tracking-wider">Status</TableHead>
            <TableHead className="font-mono text-xs text-zinc-500 uppercase tracking-wider">Task</TableHead>
            <TableHead className="font-mono text-xs text-zinc-500 uppercase tracking-wider">Created</TableHead>
            <TableHead className="font-mono text-xs text-zinc-500 uppercase tracking-wider">PID</TableHead>
            <TableHead className="font-mono text-xs text-zinc-500 uppercase tracking-wider text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
            <TableRow key={agent.id} className="border-zinc-800 hover:bg-zinc-900/50">
              <TableCell className="font-mono text-sm text-zinc-200">{agent.name}</TableCell>
              <TableCell>
                <span className="font-mono text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                  {agent.type}
                </span>
              </TableCell>
              <TableCell>
                <StatusBadge status={agent.status} />
              </TableCell>
              <TableCell className="font-mono text-xs text-zinc-400 max-w-xs truncate">
                {agent.task}
              </TableCell>
              <TableCell className="font-mono text-xs text-zinc-600">
                {new Date(agent.created_at).toLocaleString()}
              </TableCell>
              <TableCell className="font-mono text-xs text-zinc-600">
                {agent.pid || '—'}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex gap-2 justify-end">
                  <Link href={`/agents/${agent.id}`}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                    >
                      Logs
                    </Button>
                  </Link>
                  {['running', 'spawning', 'idle'].includes(agent.status) && onKill && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-red-500 hover:text-red-400 hover:bg-red-950/30"
                      onClick={() => onKill(agent.id)}
                    >
                      Kill
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
