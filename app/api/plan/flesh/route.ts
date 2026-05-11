import { NextRequest, NextResponse } from 'next/server';
import { runClaudeCLI } from '@/lib/orchestrator';

interface FleshOutResult {
  title: string;
  desc: string;
  agent: 'claude' | 'codex' | 'opencode' | 'shell';
  est: string;
  tokens: string;
}

const SYSTEM_PROMPT = `You expand short engineering briefs into actionable plan-board tasks. Given a one-line brief, return ONE task as STRICT JSON. No markdown, no prose around it, no code fences.

Schema:
{
  "title": string,    // 4–8 words. Imperative, lowercase, no trailing period.
  "desc": string,     // 1–2 sentences (≤200 chars). Concrete success criteria. Lowercase, mono-friendly.
  "agent": "claude" | "codex" | "opencode" | "shell",
  "est": string,      // rough wall time, e.g. "12m" or "1h"
  "tokens": string    // rough token budget, e.g. "~8k"
}

Agent routing:
- claude: feature work, debugging, architecture, refactors, anything ambiguous
- codex: codemods, repo-wide grep/sed jobs, deterministic transforms
- opencode: docs, READMEs, tests, polish passes
- shell: scripted environment audits, dep checks, deterministic shell-only work`;

function buildPrompt(brief: string): string {
  return `${SYSTEM_PROMPT}\n\nBrief: ${brief.trim()}\n\nReturn only the JSON object.`;
}

function parseResult(raw: string): FleshOutResult | null {
  // Pull the first {...} block out of whatever Claude returned
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<FleshOutResult>;
    if (!parsed.title || !parsed.desc) return null;
    const agent = (['claude', 'codex', 'opencode', 'shell'] as const).includes(parsed.agent as never)
      ? (parsed.agent as FleshOutResult['agent'])
      : 'claude';
    return {
      title: String(parsed.title).slice(0, 80),
      desc: String(parsed.desc).slice(0, 240),
      agent,
      est: String(parsed.est || '12m').slice(0, 8),
      tokens: String(parsed.tokens || '~8k').slice(0, 8),
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: { brief?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }); }

  const brief = (body.brief ?? '').trim();
  if (!brief) return NextResponse.json({ error: 'brief is required' }, { status: 400 });
  if (brief.length > 500) return NextResponse.json({ error: 'brief too long' }, { status: 400 });

  try {
    const cli = await runClaudeCLI(buildPrompt(brief));
    const result = parseResult(cli.text);
    if (!result) {
      return NextResponse.json({ error: 'orchestrator returned unparseable response', raw: cli.text.slice(0, 200) }, { status: 502 });
    }
    return NextResponse.json({ task: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'orchestrator call failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
