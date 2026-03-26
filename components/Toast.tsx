'use client';

import { useEffect, useRef, useState } from 'react';
import { toast as toastBus } from '@/lib/toast';
import type { ToastMessage } from '@/lib/toast';
import { X } from 'lucide-react';

const BORDER_COLOR: Record<ToastMessage['type'], string> = {
  success: 'border-l-emerald-500',
  error:   'border-l-red-500',
  info:    'border-l-blue-500',
};

const LABEL_COLOR: Record<ToastMessage['type'], string> = {
  success: 'text-emerald-400',
  error:   'text-red-400',
  info:    'text-blue-400',
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const prevIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = toastBus.subscribe((next) => {
      // Detect newly added toasts
      for (const t of next) {
        if (!prevIds.current.has(t.id)) {
        }
      }
      prevIds.current = new Set(next.map(t => t.id));
      setToasts(next);
    });
    return () => { unsub(); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map(t => (
        <div
          key={t.id}
          className={`
            pointer-events-auto
            flex items-start gap-3
            min-w-[260px] max-w-[360px]
            bg-zinc-900 border border-zinc-700 border-l-4 ${BORDER_COLOR[t.type]}
            rounded-lg shadow-2xl px-4 py-3
            font-mono text-[12px]
            animate-slide-in-right
          `}
          role="alert"
        >
          <span className={`flex-1 leading-snug text-zinc-200`}>
            <span className={`${LABEL_COLOR[t.type]} mr-1.5 font-semibold`}>
              {t.type}
            </span>
            {t.message}
          </span>
          <button
            onClick={() => toastBus.dismiss(t.id)}
            className="flex-shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors mt-0.5"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
