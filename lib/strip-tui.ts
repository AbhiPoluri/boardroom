/**
 * Strips ANSI escape codes and Claude Code TUI chrome from PTY output.
 * Returns only meaningful content lines.
 */

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][0-9A-B]/g, '')
    .replace(/\x1b[\x20-\x2f]*[\x30-\x7e]/g, '')
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\r(?!\n)/g, '\n')   // CR without LF = line wrap, treat as newline
    .replace(/\r\n/g, '\n');       // normalize CRLF
}

const TUI_CHROME_PATTERNS = [
  /^[─━┄┈│┃┌┐└┘├┤┬┴┼╭╮╰╯═╔╗╚╝╠╣╦╩╬\s\-]+$/,           // box-drawing borders
  /^[⏵⏴⏶⏷⏺●◐◑◒◓✽✢▶▷►▻❯⊙·•]+/,                         // spinner/status (short lines only)
  /bypass\s*permissions?\s*on/i,
  /shift\+tab\s*to\s*cycle/i,
  /esc\s*to\s*interrupt/i,
  /MCP server (failed|enabled)/i,
  /Claude in Chrome/i,
  /^[A-Z][a-z]+…\s*$/,                                     // ALL single-word spinner labels (Pollinating…, Ebbing…, Boondoggling…, etc.)
  /^\(thinking\)\s*$/i,                                     // thinking indicator
  /running\s*stop\s*hook/i,
  /^❯/,                                                     // prompt line (❯ /exit, ❯ anything)
  /^Resume this session with:$/i,
  /^claude --resume\s/,
  /^\/(exit|clear|help|mcp|chrome)\s*$/,
  /thought for \d+s\)?$/,
  /MCP\s*server/i,                                          // MCP status (with possible ANSI remnants)
  /^(medium|high|low)\s*·?\s*\/effort/i,
  /^\[\d+C/,                                                // cursor movement artifacts like [1C
];

export function isTuiChrome(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 3) return true;
  for (const pattern of TUI_CHROME_PATTERNS) {
    if (pattern.test(trimmed)) {
      // spinner/status pattern only filters short lines (actual content can start with these chars)
      if (pattern === TUI_CHROME_PATTERNS[1] && trimmed.length >= 80) continue;
      return true;
    }
  }
  return false;
}

/** Strip ANSI + filter TUI chrome from a log line. Returns clean text or null if junk. */
export function cleanLogLine(content: string): string | null {
  const clean = stripAnsi(content).trim();
  if (isTuiChrome(clean)) return null;
  return clean;
}
