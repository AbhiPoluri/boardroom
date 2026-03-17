import { NextRequest, NextResponse } from 'next/server';
import { postBusMessage, getBusMessages, getBusChannels } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get('channel');
  const since = req.nextUrl.searchParams.get('since');

  if (!channel) {
    const channels = getBusChannels();
    return NextResponse.json({ channels });
  }

  const messages = getBusMessages(channel, since ? parseInt(since) : undefined);
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const { from, channel, content, to } = await req.json();
  if (!from || !channel || !content) {
    return NextResponse.json({ error: 'from, channel, and content required' }, { status: 400 });
  }
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  postBusMessage(from, channel, contentStr, to);
  return NextResponse.json({ ok: true }, { status: 201 });
}
