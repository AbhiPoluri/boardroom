import { NextRequest } from 'next/server';
import { runOrchestrator, OrchestratorEvent } from '@/lib/orchestrator';
import { getAgentById, getLogsForAgent, saveChatMessage, getChatHistory, clearChatHistory, getAllAgents } from '@/lib/db';
import { cleanLogLine } from '@/lib/strip-tui';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = getChatHistory(200);
  const messages = rows.map(r => ({
    role: r.role,
    content: r.content,
    events: r.events_json ? JSON.parse(r.events_json) : [],
  }));
  return Response.json({ messages });
}

export async function DELETE() {
  clearChatHistory();
  return Response.json({ success: true });
}

async function waitForAgents(ids: string[], timeoutMs = 600000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const allDone = ids.every(id => {
      const agent = getAgentById(id);
      if (!agent) return true;
      return agent.status === 'done' || agent.status === 'error' || agent.status === 'killed';
    });
    if (allDone) return;
    await new Promise(r => setTimeout(r, 2000));
  }
}


function buildContinuationMessage(spawnedIds: string[]): string {
  const sections: string[] = [
    '[SYSTEM: Your spawned agents have finished. Their outputs are below. Review the results and decide whether to spawn more agents, resume them with follow-up tasks, or declare the work complete. If the task is fully done, say so clearly. When spawning follow-up agents that need files from multiple branches, tell them to merge the relevant branches first.]',
  ];
  for (const id of spawnedIds) {
    const agent = getAgentById(id);
    if (!agent) continue;
    const logs = getLogsForAgent(id, 500);
    const stdout = logs
      .filter(l => l.stream === 'stdout')
      .map(l => cleanLogLine(l.content))
      .filter(Boolean)
      .join('\n');
    const branchInfo = agent.repo ? ` branch: boardroom/${id}` : '';
    sections.push(`\n--- ${agent.name} (${id.slice(0, 8)}) [${agent.status}]${branchInfo} ---\n${stdout || '(no output)'}`);
  }
  return sections.join('\n');
}

export async function POST(req: NextRequest) {
  const { message } = await req.json();

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: 'message required' }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Grab history BEFORE saving current message (so it's prior context only)
      const dbHistory = getChatHistory(20);
      const history = dbHistory
        .filter(r => r.content)
        .map(r => ({ role: r.role as 'user' | 'assistant', content: r.content }));

      // Save user message now (after history snapshot)
      saveChatMessage('user', message);

      // send() swallows controller errors — stream continues even if client disconnected
      // so saves always happen regardless of navigation
      const send = (event: OrchestratorEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client disconnected — ignore, keep running so saves complete
        }
      };

      let currentMessage = message;
      let currentHistory = history;
      const MAX_ITERATIONS = 8;

      try {
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
          const iterEvents: OrchestratorEvent[] = [];
          const spawnedIds: string[] = [];
          let iterReply = '';

          for await (const event of runOrchestrator(currentMessage, currentHistory)) {
            send(event);
            iterEvents.push(event);

            if (event.type === 'text') {
              iterReply += event.content || '';
            }

            if (event.type === 'tool_result') {
              const result = event.result as Record<string, unknown> | null;
              if (
                (event.tool === 'spawn_agent' || event.tool === 'resume_agent') &&
                result?.id && typeof result.id === 'string'
              ) {
                const shortId = result.id as string;
                const fullId = shortId.length === 36
                  ? shortId
                  : getAllAgents().find(a => a.id.startsWith(shortId))?.id ?? shortId;
                spawnedIds.push(fullId);
              }
            }
          }

          // Always save assistant turn — even if reply is empty (just actions)
          saveChatMessage('assistant', iterReply || '(spawning agents)', iterEvents);

          // Update history for next iteration
          currentHistory = [
            ...currentHistory,
            { role: 'user' as const, content: currentMessage },
            { role: 'assistant' as const, content: iterReply || '(spawning agents)' },
          ];

          if (spawnedIds.length === 0) break;

          send({ type: 'text', content: `\n\n⏳ waiting for ${spawnedIds.length} agent(s) to finish…` });
          await waitForAgents(spawnedIds);
          send({ type: 'text', content: ` done.\n` });

          currentMessage = buildContinuationMessage(spawnedIds);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Orchestrator error';
        send({ type: 'error', error: msg });
      } finally {
        send({ type: 'done' });
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
