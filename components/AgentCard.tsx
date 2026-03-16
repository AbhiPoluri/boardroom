import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './StatusBadge';
import type { Agent } from '@/types';

interface AgentCardProps {
  agent: Agent;
  onKill?: (id: string) => void;
}

export function AgentCard({ agent, onKill }: AgentCardProps) {
  const createdAt = new Date(agent.created_at).toLocaleString();

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-zinc-100">{agent.name}</span>
            <StatusBadge status={agent.status} />
          </div>
          <span className="text-xs text-zinc-500 font-mono">{agent.type}</span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-zinc-400 mb-3 font-mono line-clamp-2">{agent.task}</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-600 font-mono">{createdAt}</span>
          <div className="flex gap-2">
            <Link href={`/agents/${agent.id}`}>
              <Button variant="outline" size="sm" className="h-7 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                View
              </Button>
            </Link>
            {['running', 'spawning', 'idle'].includes(agent.status) && onKill && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs border-red-900 text-red-400 hover:bg-red-950"
                onClick={() => onKill(agent.id)}
              >
                Kill
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
