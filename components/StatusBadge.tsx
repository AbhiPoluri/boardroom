import { Badge } from '@/components/ui/badge';
import type { AgentStatus } from '@/types';

interface StatusBadgeProps {
  status: AgentStatus;
}

const statusConfig: Record<AgentStatus, { label: string; className: string }> = {
  spawning: {
    label: 'spawning',
    className: 'bg-amber-400/10 text-amber-400 border-amber-400/20 hover:bg-amber-400/20',
  },
  running: {
    label: 'running',
    className: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20 hover:bg-emerald-400/20',
  },
  idle: {
    label: 'idle',
    className: 'bg-zinc-400/10 text-zinc-400 border-zinc-400/20 hover:bg-zinc-400/20',
  },
  done: {
    label: 'done',
    className: 'bg-blue-400/10 text-blue-400 border-blue-400/20 hover:bg-blue-400/20',
  },
  error: {
    label: 'error',
    className: 'bg-red-400/10 text-red-400 border-red-400/20 hover:bg-red-400/20',
  },
  killed: {
    label: 'killed',
    className: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20 hover:bg-zinc-500/20',
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.idle;
  return (
    <Badge
      variant="outline"
      className={`font-mono text-xs ${config.className}`}
    >
      {['running', 'spawning'].includes(status) && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      )}
      {config.label}
    </Badge>
  );
}
