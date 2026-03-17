import { NextRequest, NextResponse } from 'next/server';
import { getNotifications, markNotificationRead, markAllNotificationsRead, getUnreadCount } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const unreadOnly = req.nextUrl.searchParams.get('unread') === '1';
  const notifications = getNotifications(unreadOnly);
  const unread = getUnreadCount();
  return NextResponse.json({ notifications, unread });
}

export async function POST(req: NextRequest) {
  const { action, id } = await req.json();
  if (action === 'read' && id) {
    markNotificationRead(id);
  } else if (action === 'read_all') {
    markAllNotificationsRead();
  }
  return NextResponse.json({ ok: true });
}
