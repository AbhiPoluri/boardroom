/**
 * Extract a human-readable recap from a finished agent's PTY output.
 *
 * Claude Code in --dangerously-skip-permissions mode prints the assistant's
 * response prefixed with "⏺" in the terminal. Our TUI-chrome filter strips
 * status bars, "Baking…" spinners, and context bars, but the actual answer
 * text survives the strip — we can recover it from the raw PTY chunks.
 */

import { getPtyChunks } from './db';

const ANSI_CSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const ANSI_OSC = /\x1b\][^\x07]*\x07/g;
const ANSWER_PREFIX = /^[\s]*[⏺•·]\s*/;

function decodeChunks(chunks: { data: string }[]): string {
  const parts: string[] = [];
  for (const c of chunks) {
    try { parts.push(Buffer.from(c.data, 'base64').toString('utf-8')); } catch { /* skip */ }
  }
  let text = parts.join('');
  text = text.replace(ANSI_CSI, '');
  text = text.replace(ANSI_OSC, '');
  // Stray escape leftovers (some terminal modes use unusual final bytes)
  text = text.replace(/\x1b[<>]?\d*[a-zA-Z]/g, '');
  text = text.replace(/\x1b\[[\d;>?]*[a-zA-Z]/g, '');
  text = text.replace(/\r/g, '\n');
  return text;
}

function isTuiNoise(line: string): boolean {
  const l = line.trim();
  if (l.length < 2) return true;
  // Status bars + progress bars
  if (/Context\s*[░█▓▒]+\s*\d+%/i.test(l)) return true;
  if (/Usage\s*[░█▓▒]+/i.test(l)) return true;
  if (/[░█▓▒]{3,}/.test(l)) return true;
  // Spinner frames — Claude Code has dozens of cute progress verbs (Baking,
  // Germinating, Flummoxing, Whirring, Crunched, etc.). Catch ANY short
  // spinner-prefixed line, plus the bare verb on its own.
  if (/^[✻✶✳✴✷✸✹★✽✿◐◓◑◒]\s*\S/.test(l) && l.length < 80) return true;
  if (/^\S+ing[…\.]+\s*$/i.test(l)) return true; // "Germinating…", "Whirring…"
  if (/^\S+ed\s+for\s+\d/i.test(l)) return true; // "Crunched for 1m 3s"
  if (/Determining/i.test(l) && l.length < 40) return true;
  if (/^\(?[\d.]+\s*(m|s|min|sec|ms)\b/i.test(l) && l.length < 60) return true; // "(1m 3s · ↓894 tokens)"
  if (/↓\s*\d+\s*tokens/i.test(l)) return true;
  if (/running\s*stop\s*ho/i.test(l)) return true; // matches truncated "running stop hooks/hos…"
  // Boxes / dividers
  if (/^[─━┌└┘┐│┴┬├┤╭╮╯╰╴╵╶╷]{2,}/.test(l)) return true;
  // Claude Code chrome (regex tolerant to TUI cell rendering eating spaces)
  if (/^\[(Sonnet|Haiku|Opus)\s/i.test(l)) return true;
  if (/Claude\s*Code\s*has\s*switched/i.test(l)) return true;
  if (/native\s*installer/i.test(l)) return true;
  if (/running stop hooks/i.test(l)) return true;
  if (/^\?\s*for\s*shortcuts/i.test(l)) return true;
  if (/^[>›❯]\s*$/.test(l)) return true;
  if (/cwd:/.test(l) && l.length < 80) return true;
  if (/Resume this session/.test(l)) return true;
  if (/claude\s*--?resume/i.test(l)) return true;
  if (/^\s*\d+%\s*│?/.test(l)) return true;
  // ◐/◓/◒/◑ + (low|medium|high) · /effort  — Claude Code effort indicator
  if (/[◐◓◑◒]\s*(low|medium|high)\s*·\s*\/effort/i.test(l)) return true;
  // Status hints / mode indicators
  if (/MCP\s*server[s]?\s*(failed|connected|disconnected)/i.test(l)) return true;
  if (/Claude\s*in\s*Chrome\s*enabled/i.test(l)) return true;
  if (/^\^?\[?\[?[<>]?\d*\s*[mu]?$/.test(l)) return true; // raw escape leftovers like ^[[>4 m^[[<u
  if (/^\s*[\^\[<>]+\s*$/.test(l)) return true;
  if (/^\[<[a-z]\s*$/i.test(l)) return true; // "[<u"
  return false;
}

export interface AgentRecap {
  text: string;
  short: string;
}

/**
 * Re-insert spaces that the TUI ate when it redrew text using cursor
 * positioning. Claude Code's TUI sometimes renders camelCase-looking strings
 * like "Typeslietoyourface" because the layout uses fixed-cell drawing.
 * Heuristic: insert a space before a lowercase→uppercase boundary, and after
 * common short words. Imperfect but readable.
 */
function loosenRunOnWords(s: string): string {
  // Lowercase letter immediately followed by uppercase letter → split
  let out = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Common 2-3 letter words that often sit glued to neighbors
  out = out.replace(/([a-z])(to|of|in|at|on|by|the|and|or|but|if|when|while|as|with|for|a|an|is|are|was|were)([A-Z])/g, '$1 $2 $3');
  // Number→letter
  out = out.replace(/(\d)([a-zA-Z])/g, '$1 $2');
  // Letter→number
  out = out.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  return out;
}

const DIVIDER_LINE = /^[─━]{15,}/;
const TUI_BOTTOM_MARKERS = /(bypass\s*permissions|Resume this session|claude --resume|Claude Code has switched|\[Sonnet|\[Haiku|\[Opus|Context\s+[░█])/i;

/** Produce a clean recap of an agent's terminal output. */
export function extractAgentRecap(agentId: string, limit = 4000): AgentRecap | null {
  const chunks = getPtyChunks(agentId);
  if (!chunks.length) return null;
  const text = decodeChunks(chunks);

  // Anchor on Claude Code's response prefix character. The agent's actual
  // answer follows the LAST ⏺ in the buffer. Multi-bullet responses get
  // re-rendered across multiple TUI panels with dividers + chrome between
  // them, so we skip dividers/chrome rather than stopping at the first one.
  const lastMarker = text.lastIndexOf('⏺');
  if (lastMarker !== -1) {
    const body = text.slice(lastMarker + 1);

    const rawLines = body.split('\n').map(l => l.trim());
    const kept: string[] = [];
    let lastWasBlank = false;
    for (const l of rawLines) {
      if (!l) {
        // Collapse runs of blank lines to a single paragraph break.
        if (kept.length && !lastWasBlank) {
          kept.push('');
          lastWasBlank = true;
        }
        continue;
      }
      if (DIVIDER_LINE.test(l)) continue;
      if (TUI_BOTTOM_MARKERS.test(l)) continue;
      if (isTuiNoise(l)) continue;
      if (/^❯\s*/.test(l)) continue;
      kept.push(l);
      lastWasBlank = false;
    }
    // Trim trailing blank
    while (kept.length && kept[kept.length - 1] === '') kept.pop();

    if (kept.length) {
      const looseLines = kept.map(l => l ? loosenRunOnWords(l) : l);
      const full = looseLines.join('\n').slice(0, limit).trim();
      if (full) {
        const firstReal = looseLines.find(l => l.length > 2) || looseLines[0];
        const short = (firstReal || '').slice(0, 200).trim();
        return { text: full, short };
      }
    }
  }

  // Fallback: bottom-up walk (used when no ⏺ marker present, e.g. non-claude agents)
  const lines = text.split('\n').map(l => l.trim());
  const kept: string[] = [];
  let charCount = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (!raw) continue;
    if (isTuiNoise(raw)) continue;
    if (TUI_BOTTOM_MARKERS.test(raw)) continue;
    if (DIVIDER_LINE.test(raw)) continue;
    const cleaned = raw.replace(ANSWER_PREFIX, '').trim();
    if (!cleaned) continue;
    if (/^#\s*Task\b/i.test(cleaned)) break;
    if (cleaned.startsWith('Default behavior:')) break;
    if (cleaned.startsWith('Protocol:')) break;
    if (cleaned.startsWith('You are "')) break;
    if (cleaned.startsWith('You are ') && cleaned.includes(',')) break;
    kept.unshift(loosenRunOnWords(cleaned));
    charCount += cleaned.length + 1;
    if (charCount > limit) break;
  }

  if (kept.length === 0) return null;
  const full = kept.join('\n').trim();
  if (!full) return null;
  const short = (kept.find(l => l.length > 2) ?? kept[0]).slice(0, 200).trim();
  return { text: full, short };
}
