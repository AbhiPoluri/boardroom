import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  gitStatus?: string | null;
}

// Prevent directory traversal
function safePath(base: string, rel: string): string | null {
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(path.resolve(base))) return null;
  return resolved;
}

const HIDDEN_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', '.DS_Store', '__pycache__', '.venv', 'venv']);

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get('repo');
  const filePath = req.nextUrl.searchParams.get('path') || '';
  const action = req.nextUrl.searchParams.get('action') || 'list';

  if (!repo) return NextResponse.json({ error: 'repo parameter required' }, { status: 400 });
  if (!fs.existsSync(repo)) return NextResponse.json({ error: 'repo not found' }, { status: 404 });

  const target = safePath(repo, filePath);
  if (!target) return NextResponse.json({ error: 'invalid path' }, { status: 400 });

  // Read file contents
  if (action === 'read') {
    if (!fs.existsSync(target)) return NextResponse.json({ error: 'file not found' }, { status: 404 });
    const stat = fs.statSync(target);
    if (stat.isDirectory()) return NextResponse.json({ error: 'path is a directory' }, { status: 400 });
    if (stat.size > 1_000_000) return NextResponse.json({ error: 'file too large (>1MB)' }, { status: 400 });

    const content = fs.readFileSync(target, 'utf-8');
    const ext = path.extname(target).slice(1);
    return NextResponse.json({ content, path: filePath, extension: ext, size: stat.size });
  }

  // List directory
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    return NextResponse.json({ error: 'not a directory' }, { status: 400 });
  }

  const entries: FileEntry[] = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (HIDDEN_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env.production.example') continue;

    const fullPath = path.join(target, entry.name);
    const relPath = path.relative(repo, fullPath);

    if (entry.isDirectory()) {
      entries.push({ name: entry.name, path: relPath, type: 'directory' });
    } else {
      const stat = fs.statSync(fullPath);
      entries.push({ name: entry.name, path: relPath, type: 'file', size: stat.size });
    }
  }

  // Sort: directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Annotate entries with git status
  let gitStatus: Record<string, string> = {};
  try {
    const output = execSync(`git -C "${repo}" status --porcelain`, { encoding: 'utf-8' });
    const statusMap: Record<string, string> = { 'M': 'modified', 'A': 'added', 'D': 'deleted', '??': 'untracked', 'MM': 'modified', 'AM': 'modified', 'AD': 'deleted' };
    for (const line of output.split('\n').filter(Boolean)) {
      const status = line.slice(0, 2).trim();
      const file = line.slice(3);
      gitStatus[file] = statusMap[status] || 'modified';
    }
  } catch {}
  const annotated = entries.map(e => ({ ...e, gitStatus: gitStatus[e.path] || null }));

  return NextResponse.json({ entries: annotated, path: filePath, repo });
}

export async function PUT(req: NextRequest) {
  const { repo, path: filePath, content } = await req.json();

  if (!repo) return NextResponse.json({ error: 'repo parameter required' }, { status: 400 });
  if (!filePath) return NextResponse.json({ error: 'path parameter required' }, { status: 400 });
  if (typeof content !== 'string') return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
  if (!fs.existsSync(repo)) return NextResponse.json({ error: 'repo not found' }, { status: 404 });

  const target = safePath(repo, filePath);
  if (!target) return NextResponse.json({ error: 'invalid path' }, { status: 400 });

  // Ensure target is a file, not a directory
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    return NextResponse.json({ error: 'path is a directory' }, { status: 400 });
  }

  fs.writeFileSync(target, content, 'utf-8');
  return NextResponse.json({ ok: true });
}
