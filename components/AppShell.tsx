'use client';

import { ChatBox } from '@/components/ChatBox';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex overflow-hidden bg-[#0a0a0a]">
      {/* Left: persistent orchestrator chat */}
      <div className="w-[360px] flex-shrink-0 border-r border-zinc-800 h-full flex flex-col">
        <ChatBox />
      </div>

      {/* Right: page content (changes per route) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
