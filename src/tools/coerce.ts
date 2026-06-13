export function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Several Artemis management operations return their result as a JSON string. */
export function parseJsonArray(value: unknown): Record<string, unknown>[] {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
}
