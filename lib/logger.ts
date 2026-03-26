const isProd = process.env.NODE_ENV === 'production';

type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, message: string, extra?: unknown): void {
  if (isProd) {
    const entry: Record<string, unknown> = {
      level,
      ts: new Date().toISOString(),
      msg: message,
    };
    if (extra !== undefined) entry['data'] = extra;
    process.stderr.write(JSON.stringify(entry) + '\n');
  } else {
    const prefix = `[${level.toUpperCase()}]`;
    if (extra !== undefined) {
      console.error(prefix, message, extra);
    } else {
      console.error(prefix, message);
    }
  }
}

export const log = {
  info: (message: string, extra?: unknown) => write('info', message, extra),
  warn: (message: string, extra?: unknown) => write('warn', message, extra),
  error: (message: string, extra?: unknown) => write('error', message, extra),
};
