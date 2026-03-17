import { NextRequest } from 'next/server';
import { getPtyChunks } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const afterParam = req.nextUrl.searchParams.get('after');
  let lastId = afterParam ? parseInt(afterParam, 10) : 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      // Send all existing chunks first
      const initial = getPtyChunks(id, 0);
      if (initial.length > 0) {
        send({ type: 'initial', chunks: initial });
        lastId = initial[initial.length - 1].id;
      }

      // Poll for new chunks every 500ms (was 100ms — major RAM/CPU savings)
      const interval = setInterval(() => {
        try {
          const newChunks = getPtyChunks(id, lastId);
          if (newChunks.length > 0) {
            send({ type: 'chunks', chunks: newChunks });
            lastId = newChunks[newChunks.length - 1].id;
          }
        } catch {
          clearInterval(interval);
          try { controller.close(); } catch {}
        }
      }, 500);

      // Clean up when client disconnects
      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
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
