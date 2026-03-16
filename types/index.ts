export type AgentType = 'claude' | 'codex' | 'custom' | 'test';
export type AgentStatus = 'spawning' | 'running' | 'idle' | 'done' | 'error' | 'killed';
export type LogStream = 'stdout' | 'stderr' | 'system';
export type TaskStatus = 'pending' | 'assigned' | 'done';

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  task: string;
  repo: string | null;
  worktree_path: string | null;
  pid: number | null;
  port: number | null;
  created_at: number;
  updated_at: number;
}

export interface Log {
  id: number;
  agent_id: string;
  timestamp: number;
  stream: LogStream;
  content: string;
}

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  agent_id: string | null;
  created_at: number;
  result: string | null;
}

export interface AgentWithLogs extends Agent {
  logs: Log[];
}

export interface SpawnAgentRequest {
  task: string;
  type: AgentType;
  repo?: string;
  name?: string;
}

export interface SendMessageRequest {
  message: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}
