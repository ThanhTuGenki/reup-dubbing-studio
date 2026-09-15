const REDACTED = '[Redacted]';
const SENSITIVE_KEYS = /^(?:authorization|cookie|set-cookie|token|accessToken|refreshToken|secret|apiKey|password)$/iu;
const URL_KEYS = /^(?:url|href|uri)$/iu;
const QUERY_KEYS = /^(?:query|queryString|search)$/iu;

/** Returns a redacted clone suitable for structured logging. */
export function redactLog(value: unknown): unknown {
  return redactValue(value, new WeakMap<object, unknown>());
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) clone.push(redactValue(item, seen));
    return clone;
  }

  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.test(key) || QUERY_KEYS.test(key)) {
      clone[key] = REDACTED;
    } else if (URL_KEYS.test(key) && typeof child === 'string') {
      clone[key] = redactUrl(child);
    } else {
      clone[key] = redactValue(child, seen);
    }
  }
  return clone;
}

function redactUrl(value: string): string {
  const queryStart = value.indexOf('?');
  if (queryStart < 0) return value;
  const fragmentStart = value.indexOf('#', queryStart);
  const suffix = fragmentStart < 0 ? '' : value.slice(fragmentStart);
  return `${value.slice(0, queryStart + 1)}${REDACTED}${suffix}`;
}
