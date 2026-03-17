import { createNotification, getUnreadCount } from './db';

export type NotificationType = 'agent_done' | 'agent_error' | 'agent_idle' | 'merge_complete' | 'workflow_done' | 'system';

export function notifyAgentComplete(agentId: string, agentName: string, status: string) {
  const type = status === 'error' ? 'agent_error' : status === 'idle' ? 'agent_idle' : 'agent_done';
  const title = status === 'error'
    ? `${agentName} errored out`
    : status === 'idle'
    ? `${agentName} is idle`
    : `${agentName} finished`;
  createNotification(type, title, undefined, agentId);
}

export function notifyMergeComplete(agentName: string, branch: string) {
  createNotification('merge_complete', `Merged ${agentName}`, `Branch ${branch} merged into base`);
}

export function notifyWorkflowDone(workflowName: string) {
  createNotification('workflow_done', `Workflow "${workflowName}" complete`);
}

export function notifySystem(title: string, body?: string) {
  createNotification('system', title, body);
}

export { getUnreadCount };
