'use client';
import { useState, useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';

interface Notification {
  id: number;
  agent_id: string | null;
  type: string;
  title: string;
  body: string | null;
  read: number;
  created_at: number;
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
    agent_done: 'text-emerald-400',
    agent_error: 'text-red-400',
    agent_idle: 'text-amber-400',
    merge_complete: 'text-blue-400',
    workflow_done: 'text-purple-400',
    system: 'text-zinc-400',
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
              <button onClick={markAllRead} className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300">
                mark all read
              </button>
            )}
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-xs font-mono text-zinc-700">no notifications</div>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <div
                  key={n.id}
                  className={`px-3 py-2 border-b border-zinc-800/50 ${n.read ? 'opacity-60' : ''} hover:bg-zinc-800/50 transition-colors`}
                >
                  <div className={`font-mono text-xs ${typeColor[n.type] || 'text-zinc-400'}`}>
                    {n.title}
                  </div>
                  {n.body && <div className="font-mono text-[10px] text-zinc-600 mt-0.5">{n.body}</div>}
                  <div className="font-mono text-[9px] text-zinc-700 mt-0.5">
                    {new Date(n.created_at).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
