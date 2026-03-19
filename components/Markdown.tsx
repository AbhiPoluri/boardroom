'use client';

import React from 'react';

/** Lightweight markdown renderer — no dependencies. Handles the common patterns. */
export function Markdown({ content, className = '' }: { content: string; className?: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={elements.length} className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-[10px] leading-relaxed overflow-x-auto my-1">
          <code className="text-emerald-300">{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Heading
    if (line.startsWith('### ')) {
      elements.push(<div key={elements.length} className="text-[11px] font-bold text-zinc-200 mt-2 mb-0.5">{inlineFormat(line.slice(4))}</div>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<div key={elements.length} className="text-[11px] font-bold text-zinc-100 mt-2 mb-0.5">{inlineFormat(line.slice(3))}</div>);
      i++; continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<div key={elements.length} className="text-xs font-bold text-zinc-100 mt-2 mb-0.5">{inlineFormat(line.slice(2))}</div>);
      i++; continue;
    }

    // Bullet list
    if (line.match(/^[-*] /)) {
      elements.push(
        <div key={elements.length} className="flex gap-1.5 pl-1">
          <span className="text-zinc-600 flex-shrink-0">•</span>
          <span>{inlineFormat(line.slice(2))}</span>
        </div>
      );
      i++; continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s/)) {
      const num = line.match(/^(\d+)\./)?.[1];
      const text = line.replace(/^\d+\.\s*/, '');
      elements.push(
        <div key={elements.length} className="flex gap-1.5 pl-1">
          <span className="text-zinc-600 flex-shrink-0">{num}.</span>
          <span>{inlineFormat(text)}</span>
        </div>
      );
      i++; continue;
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={elements.length} className="h-1" />);
      i++; continue;
    }

    // Regular paragraph
    elements.push(<div key={elements.length}>{inlineFormat(line)}</div>);
    i++;
  }

  return <div className={`space-y-0.5 ${className}`}>{elements}</div>;
}

/** Format inline markdown: bold, italic, code, links */
function inlineFormat(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    let match = remaining.match(/^(.*?)`([^`]+)`/);
    if (match) {
      if (match[1]) parts.push(<span key={key++}>{match[1]}</span>);
      parts.push(<code key={key++} className="bg-zinc-800 text-amber-300 px-1 py-0.5 rounded text-[10px]">{match[2]}</code>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Bold
    match = remaining.match(/^(.*?)\*\*([^*]+)\*\*/);
    if (match) {
      if (match[1]) parts.push(<span key={key++}>{match[1]}</span>);
      parts.push(<strong key={key++} className="text-zinc-100 font-semibold">{match[2]}</strong>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Italic
    match = remaining.match(/^(.*?)\*([^*]+)\*/);
    if (match) {
      if (match[1]) parts.push(<span key={key++}>{match[1]}</span>);
      parts.push(<em key={key++} className="text-zinc-300 italic">{match[2]}</em>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // No more inline formatting
    parts.push(<span key={key++}>{remaining}</span>);
    break;
  }

  return parts;
}
