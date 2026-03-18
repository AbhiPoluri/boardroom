/**
 * Strips ANSI escape codes and Claude Code TUI chrome from PTY output.
 * Returns only meaningful content lines.
 */

export function stripAnsi(text: string): string {
  return text
    // Replace cursor movement CSI sequences (H, C, G, d, f — cursor positioning) with space
    // so column-positioned text doesn't merge into one word
    .replace(/\x1b\[\d*(?:;\d+)*[HCGdf]/g, ' ')
    // Strip remaining CSI sequences (colors, modes, etc.)
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][0-9A-B]/g, '')
    .replace(/\x1b[\x20-\x2f]*[\x30-\x7e]/g, '')
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\r(?!\n)/g, '\n')   // CR without LF = line wrap, treat as newline
    .replace(/\r\n/g, '\n')       // normalize CRLF
    .replace(/ {2,}/g, ' ');      // collapse multiple spaces from cursor replacement
}

const TUI_CHROME_PATTERNS = [
  /^[─━┄┈│┃┌┐└┘├┤┬┴┼╭╮╰╯═╔╗╚╝╠╣╦╩╬\s\-]+$/,           // box-drawing borders
  /^[⏵⏴⏶⏷⏺●◐◑◒◓✽✢▶▷►▻❯⊙·•]+/,                         // spinner/status (short lines only)
  /bypass\s*permissions?\s*on/i,
  /shift\+tab\s*to\s*cycle/i,
  /esc\s*to\s*interrupt/i,
  /MCP server (failed|enabled)/i,
  /Claude in Chrome/i,
  /^[A-Z][a-z]+(…|\.{2,})\s*$/,                              // ALL single-word spinner labels (Pollinating…, Ebbing..., etc.)
  /^\(thinking\)\s*$/i,                                     // thinking indicator
  /^\*?\s*\(thinking\)/i,                                     // (thinking) or * (thinking) variant
  /^\*\s*[A-Z][a-z]+(…|\.{2,})/,                              // * Roosting… / * Moonwalking... (spinner with asterisk)
  /running\s*stop\s*hook/i,
  /^❯/,                                                     // prompt line (❯ /exit, ❯ anything)
  /^Resume this session with:$/i,
  /^claude --resume\s/,
  /^\/(exit|clear|help|mcp|chrome)\s*$/,
  /thought for \d+s\)?$/,
  /MCP\s*server/i,                                          // MCP status (with possible ANSI remnants)
  /^(medium|high|low)\s*·?\s*\/effort/i,
  /^\[\d+C/,                                                // cursor movement artifacts like [1C
  /^Tip:/i,                                                  // Claude Code tips
  /^Use\s*\/btw/i,                                           // "Use /btw to ask..."
  /^\*[a-z]{1,3}\s+\*[a-z]{1,3}/,                           // partial cursor-addressed garbage (*ot *eo *Pc)
  /^[A-Z][a-z]+ing_/,                                       // "Percolating_running stophok" style junk
  /^[a-z]*[A-Z][a-z]+ed\s+for\s+\d+s/,                     // "eRaked for 36s" style progress
  /tokens\s*remaining/i,                                     // token budget displays
  /^\d+[kKmM]?\s*tokens?\s*$/,                              // bare token counts
  /Welcome\s*back/i,                                         // Claude Code welcome screen
  /Ask\s*Claude\s*to/i,                                      // onboarding prompt
  /Recent\s*activity/i,                                      // recent activity panel
  /No\s*recent\s*activity/i,                                  // empty activity panel
  /Tips\s*for\s*getting\s*started/i,                          // tips panel
  /Getting\s*started/i,                                       // getting started
  /^\|[^|]+\|$/,                                              // pipe-delimited TUI table rows
  /dangerously-skip-permissions/,                             // CLI flag echoed back
  /^[A-Z][a-z]+ing[.…]+\s*(thinking|working)/i,              // "Wibbling... thinking..." spinner
  /^[A-Z][a-z]+(…|\.{2,})\s*\(thinking\)/i,                  // "Discombobulating… (thinking)" spinner
  /^[✻✶✳⎿*\s]*thinking[.…]*$/i,                              // "thinking", "* thinking", "✻ thinking..."
  /^thinking[.…]*$/i,                                         // bare "thinking" or "Thinking..."
];

export function isTuiChrome(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 4) return true;
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
