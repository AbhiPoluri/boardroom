import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Cache fetched readmes to avoid hammering GitHub
const cache = new Map<string, { content: string; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 min

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  // Only allow github.com URLs
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') {
      return NextResponse.json({ error: 'Only GitHub URLs supported' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ content: cached.content });
  }

  // Convert GitHub URL to raw content URL
  // https://github.com/user/repo/tree/main/path -> raw.githubusercontent.com/user/repo/main/path
  const rawUrls = buildRawUrls(url);

  for (const rawUrl of rawUrls) {
    try {
      const res = await fetch(rawUrl, {
        headers: { 'Accept': 'text/plain' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const text = await res.text();
        // Trim to reasonable size
        const content = text.slice(0, 8000);
        cache.set(url, { content, ts: Date.now() });
        return NextResponse.json({ content });
      }
    } catch {
      continue;
    }
  }

  return NextResponse.json({ content: null, error: 'Could not fetch content' });
}

function buildRawUrls(githubUrl: string): string[] {
  const urls: string[] = [];

  // Handle tree URLs: github.com/user/repo/tree/branch/path
  const treeMatch = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
  if (treeMatch) {
    const [, owner, repo, branch, path] = treeMatch;
    // Try SKILL.md first, then README.md
    urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/SKILL.md`);
    urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/README.md`);
    urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/skill.md`);
    return urls;
  }

  // Handle plain repo URLs: github.com/user/repo
  const repoMatch = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`);
    urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`);
    urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`);
    return urls;
  }

  return urls;
}
