type Level = 'error' | 'warn' | 'info' | 'debug';

const order: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const secrets = new Set<string>();
let threshold: Level = (process.env.ARTEMIS_LOG_LEVEL as Level) || 'info';

export function registerSecrets(values: string[]): void {
  for (const value of values) {
    if (value) secrets.add(value);
  }
}

export function setLevel(level: Level): void {
  threshold = level;
}

function redact(text: string): string {
  let out = text;
  for (const secret of secrets) {
    out = out.split(secret).join('***');
  }
  return out;
}

function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emit(level: Level, args: unknown[]): void {
  if (order[level] > order[threshold]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${args.map(format).join(' ')}`;
  process.stderr.write(`${redact(line)}\n`);
}

export const logger = {
  error: (...args: unknown[]) => emit('error', args),
  warn: (...args: unknown[]) => emit('warn', args),
  info: (...args: unknown[]) => emit('info', args),
  debug: (...args: unknown[]) => emit('debug', args),
};
