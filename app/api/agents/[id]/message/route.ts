import { NextRequest, NextResponse } from 'next/server';
import { getAgentById, insertLog } from '@/lib/db';
import { sendToAgent } from '@/lib/spawner';
import type { SendMessageRequest } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = getAgentById(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const body: SendMessageRequest = await req.json();
    const { message } = body;

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }
    if (message.length > 10000) {
      return NextResponse.json({ error: 'message exceeds maximum length of 10000 characters' }, { status: 400 });
    }

    // Try to send via stdin
    const sent = sendToAgent(id, message);

    // Log the message regardless
    insertLog(id, 'system', `[USER MESSAGE] ${message}`);

    return NextResponse.json({
      success: true,
      delivered: sent,
      message: sent ? 'Message sent to agent stdin' : 'Message logged (agent not running)',
    });
  } catch (err) {
    console.error('POST /api/agents/[id]/message error:', err);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
