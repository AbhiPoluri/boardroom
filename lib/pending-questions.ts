/**
 * Resolving a pending question = recording the user's answer and waking the
 * agent (or its persona) back up with continuation context.
 */

import {
  getPendingQuestionById,
  resolvePendingQuestion,
  getOpenPendingQuestionsForAgent,
  getAgentById,
  getPersonaForAgent,
  insertLog,
  updateAgentStatus,
  setPersonaStatus,
} from './db';
import { wakePersona } from './personas';
import { resumeAgent } from './spawner';

export async function resolveQuestion(
  questionId: string,
  resolution: string,
): Promise<{ resumedAgentId: string | null }> {
  const q = getPendingQuestionById(questionId);
  if (!q) throw new Error('question not found');
  if (q.status !== 'open') throw new Error(`question is ${q.status}, not open`);

  resolvePendingQuestion(questionId, resolution);

  const agent = getAgentById(q.agent_id);
  if (!agent) return { resumedAgentId: null };

  insertLog(agent.id, 'system', `User answered: ${resolution}`);

  // If there are still other open questions for this agent, leave it parked.
  const remaining = getOpenPendingQuestionsForAgent(agent.id);
  if (remaining.length > 0) {
    return { resumedAgentId: null };
  }

  const continuation = buildContinuationPrompt(q.original_task ?? agent.task, q.question, resolution);

  // Prefer routing through the persona so persona status stays in sync.
  const persona = getPersonaForAgent(agent.id);
  if (persona) {
    await wakePersona({ persona, task: continuation, taskId: persona.current_task_id ?? undefined });
    return { resumedAgentId: agent.id };
  }

  // Bare agent (not a persona) — just resume directly.
  updateAgentStatus(agent.id, 'spawning');
  await resumeAgent(agent.id, continuation);
  return { resumedAgentId: agent.id };
}

function buildContinuationPrompt(originalTask: string | null, question: string, answer: string): string {
  const original = originalTask ? originalTask.trim() : '(unknown)';
  return [
    '# Continuation',
    '',
    'You previously paused to ask the user a question. They have responded.',
    '',
    `Original task:`,
    original.slice(0, 4000),
    '',
    `Question you asked: ${question}`,
    `User's answer: ${answer}`,
    '',
    'Continue the original task using the answer. Do not re-introduce yourself; pick up from where you stopped.',
  ].join('\n');
}
