import { NextRequest } from 'next/server';
import { getAgentById, getLogsSince, getLogsForAgent } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const agent = getAgentById(id);
  if (!agent) {
    return new Response(JSON.stringify({ error: 'Agent not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial batch of logs
      const initialLogs = getLogsForAgent(id, 200);
      let lastId = 0;

      if (initialLogs.length > 0) {
        lastId = initialLogs[initialLogs.length - 1].id;
        const data = `data: ${JSON.stringify({ type: 'initial', logs: initialLogs })}\n\n`;
        controller.enqueue(encoder.encode(data));
      } else {
        const data = `data: ${JSON.stringify({ type: 'initial', logs: [] })}\n\n`;
        controller.enqueue(encoder.encode(data));
      }

      // Poll for new logs every 1s (was 500ms)
      let doneChecks = 0;
      const interval = setInterval(() => {
        try {
          const newLogs = getLogsSince(id, lastId);
          if (newLogs.length > 0) {
            lastId = newLogs[newLogs.length - 1].id;
            for (const log of newLogs) {
              const data = `data: ${JSON.stringify({ type: 'log', log })}\n\n`;
              controller.enqueue(encoder.encode(data));
            }
          }

          // Check if agent is done/killed/error - send terminal status and stop polling
          const currentAgent = getAgentById(id);
          if (currentAgent && ['done', 'killed', 'error'].includes(currentAgent.status)) {
            const data = `data: ${JSON.stringify({ type: 'status', status: currentAgent.status })}\n\n`;
            controller.enqueue(encoder.encode(data));
            // After agent finishes, check a few more times for trailing logs then stop
            doneChecks++;
            if (doneChecks >= 5) {
              clearInterval(interval);
              clearInterval(heartbeat);
              try { controller.close(); } catch {}
            }
          }
        } catch {
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }, 1000);

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
          clearInterval(interval);
        }
      }, 30000);

      // Cleanup when stream is cancelled
      return () => {
        clearInterval(interval);
        clearInterval(heartbeat);
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
