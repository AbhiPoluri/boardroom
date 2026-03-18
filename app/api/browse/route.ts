import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

interface BrowseEntry {
  name: string;
  path: string;
  isGit: boolean;
}

export async function GET(req: NextRequest) {
  const dir = req.nextUrl.searchParams.get('dir') || os.homedir();

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return NextResponse.json({ error: 'not a directory' }, { status: 400 });
  }

  // Prevent traversal above home
  const home = os.homedir();
  const resolved = path.resolve(dir);

  const entries: BrowseEntry[] = [];
  const HIDDEN = new Set(['.git', 'node_modules', '.next', 'dist', '.DS_Store', '__pycache__', '.venv', 'Library', '.Trash', '.cache', '.npm', '.nvm']);

  try {
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
      if (HIDDEN.has(entry.name)) continue;

      const fullPath = path.join(resolved, entry.name);
      let isGit = false;
      try {
        isGit = fs.existsSync(path.join(fullPath, '.git'));
      } catch {}

      entries.push({ name: entry.name, path: fullPath, isGit });
    }
  } catch {
    return NextResponse.json({ error: 'cannot read directory' }, { status: 403 });
  }

  // Sort: git repos first, then alphabetical
  entries.sort((a, b) => {
    if (a.isGit !== b.isGit) return a.isGit ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Check if current dir is a git repo
  const currentIsGit = fs.existsSync(path.join(resolved, '.git'));

  return NextResponse.json({
    dir: resolved,
    parent: resolved !== '/' ? path.dirname(resolved) : null,
    isGit: currentIsGit,
    entries,
  });
}
