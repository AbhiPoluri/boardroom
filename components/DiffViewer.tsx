'use client';
import { useState } from 'react';
import { ChevronRight, FileCode } from 'lucide-react';

interface DiffViewerProps {
  diff: string;
}

// Parse unified diff into file sections
function parseDiff(diff: string) {
  const files: { path: string; chunks: string[] }[] = [];
  let current: { path: string; chunks: string[] } | null = null;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/b\/(.+)$/);
      current = { path: match?.[1] || 'unknown', chunks: [] };
      files.push(current);
    } else if (current) {
      current.chunks.push(line);
    }
  }
  return files;
}

export function DiffViewer({ diff }: DiffViewerProps) {
  const files = parseDiff(diff);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    files.forEach(f => init[f.path] = true);
    return init;
  });

  if (!diff.trim()) {
    return <div className="text-xs font-mono text-zinc-600 p-4">no changes</div>;
  }

  return (
    <div className="space-y-2">
      {files.map((file, i) => (
        <div key={i} className="border border-zinc-800 rounded-lg overflow-hidden">
          <button
            onClick={() => setExpanded(prev => ({ ...prev, [file.path]: !prev[file.path] }))}
            className="w-full flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 transition-colors text-left"
          >
            <ChevronRight className={`w-3 h-3 text-zinc-500 transition-transform ${expanded[file.path] ? 'rotate-90' : ''}`} />
            <FileCode className="w-3.5 h-3.5 text-zinc-500" />
            <span className="font-mono text-xs text-zinc-300">{file.path}</span>
          </button>
          {expanded[file.path] && (
            <div className="overflow-x-auto">
              <pre className="text-[11px] font-mono leading-5">
                {file.chunks.map((line, j) => {
                  let cls = 'px-3 ';
                  if (line.startsWith('+') && !line.startsWith('+++')) {
                    cls += 'bg-emerald-950/40 text-emerald-300';
                  } else if (line.startsWith('-') && !line.startsWith('---')) {
                    cls += 'bg-red-950/40 text-red-300';
                  } else if (line.startsWith('@@')) {
                    cls += 'bg-blue-950/30 text-blue-400';
                  } else {
                    cls += 'text-zinc-500';
                  }
                  return (
                    <div key={j} className={cls}>
                      {line}
                    </div>
                  );
                })}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
