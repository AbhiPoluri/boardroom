'use client';

import { useEffect, useRef, useState } from 'react';

interface PtyTerminalProps {
  agentId: string;
  isActive: boolean;
  fontSize?: number;
}

export function PtyTerminal({ agentId, isActive, fontSize = 13 }: PtyTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const fitRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    // Dynamically import xterm (avoids SSR issues)
    Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ]).then(([{ Terminal }, { FitAddon }]) => {
      if (cancelled || !containerRef.current) return;

      const term = new Terminal({
        theme: {
          background: '#09090b',
          foreground: '#e4e4e7',
          cursor: '#10b981',
          cursorAccent: '#09090b',
          black: '#18181b',
          red: '#f87171',
          green: '#4ade80',
          yellow: '#facc15',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#d4d4d8',
          brightBlack: '#3f3f46',
          brightRed: '#fca5a5',
          brightGreen: '#86efac',
          brightYellow: '#fde047',
          brightBlue: '#93c5fd',
          brightMagenta: '#d8b4fe',
          brightCyan: '#67e8f9',
          brightWhite: '#f4f4f5',
          selectionBackground: '#3f3f46',
        },
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        fontSize,
        lineHeight: 1.4,
        cursorBlink: isActive,
        cursorStyle: 'block',
        scrollback: 10000,
        convertEol: true,
        allowTransparency: false,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current!);
      fit.fit();

      termRef.current = term;
      fitRef.current = fit;

      // Resize observer to keep terminal sized to container
      const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
      ro.observe(containerRef.current!);

      // Connect to PTY stream
      const es = new EventSource(`/api/stream/pty/${agentId}`);
      esRef.current = es;

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'initial' && msg.chunks && msg.chunks.length > 0) {
            setHasData(true);
            for (const chunk of msg.chunks) {
              term.write(Buffer.from(chunk.data, 'base64'));
            }
          } else if (msg.type === 'chunks' && msg.chunks && msg.chunks.length > 0) {
            setHasData(true);
            for (const chunk of msg.chunks) {
              term.write(Buffer.from(chunk.data, 'base64'));
            }
          }
        } catch {}
      };

      return () => {
        ro.disconnect();
        es.close();
        term.dispose();
      };
    });

    return () => {
      cancelled = true;
      esRef.current?.close();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [agentId, isActive]);

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: '#09090b' }}>
      <div
        ref={containerRef}
        className="w-full h-full overflow-hidden"
        style={{ padding: '8px' }}
      />
      {!hasData && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <p className="font-mono text-sm text-zinc-700">no terminal output yet</p>
          <p className="font-mono text-xs text-zinc-800 mt-1">send a message to the orchestrator to see output here</p>
        </div>
      )}
    </div>
  );
}
