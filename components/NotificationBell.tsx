'use client';
import { useState, useEffect, useRef } from 'react';
import { Bell, CheckCircle, XCircle, CheckCheck } from 'lucide-react';

interface Notification {
  id: number;
  agent_id: string | null;
  type: string;
  title: string;
  body: string | null;
  read: number;
  created_at: number;
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poll = () => {
      fetch('/api/notifications')
        .then(r => r.json())
        .then(data => {
          setNotifications(data.notifications || []);
          setUnread(data.unread || 0);
        })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const markAllRead = async () => {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read_all' }),
    });
    setUnread(0);
    setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
  };

  const typeColor: Record<string, string> = {
    agent_done: 'text-blue-400',
    agent_error: 'text-red-400',
    agent_idle: 'text-amber-400',
    push_approved: 'text-emerald-400',
    push_rejected: 'text-red-400',
    merge_complete: 'text-blue-400',
    workflow_done: 'text-purple-400',
    system: 'text-zinc-400',
  };

  const TypeIcon = ({ type }: { type: string }) => {
    if (type === 'push_approved') return <CheckCircle className="w-3 h-3 text-emerald-400 flex-shrink-0" />;
    if (type === 'push_rejected') return <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />;
    if (type === 'agent_done') return <CheckCheck className="w-3 h-3 text-blue-400 flex-shrink-0" />;
    return null;
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-mono text-white flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="font-mono text-xs text-zinc-300">notifications</span>
            {unread > 0 && (
              <span className="text-[9px] font-mono text-zinc-600">{unread} unread</span>
            )}
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-xs font-mono text-zinc-700">no notifications</div>
            ) : (
              notifications.slice(0, 10).map((n) => (
                <div
                  key={n.id}
                  className={`px-3 py-2 border-b border-zinc-800/50 ${n.read ? 'opacity-60' : ''} hover:bg-zinc-800/50 transition-colors`}
                >
                  <div className="flex items-start gap-1.5">
                    <TypeIcon type={n.type} />
                    <div className="flex-1 min-w-0">
                      <div className={`font-mono text-xs ${typeColor[n.type] || 'text-zinc-400'} truncate`}>
                        {n.title}
                      </div>
                      {n.body && <div className="font-mono text-[10px] text-zinc-600 mt-0.5 line-clamp-2">{n.body}</div>}
                      <div className="font-mono text-[9px] text-zinc-700 mt-0.5">
                        {relativeTime(n.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {notifications.length > 0 && (
            <div className="px-3 py-2 border-t border-zinc-800">
              <button
                onClick={markAllRead}
                className="w-full text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors text-center"
              >
                mark all read
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
