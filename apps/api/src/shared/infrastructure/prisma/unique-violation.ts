const MAX_DEPTH = 5;

function hasUniqueSignal(error: unknown, depth: number): boolean {
  if (typeof error !== 'object' || error === null || depth > MAX_DEPTH) return false;
  const e = error as Record<string, unknown>;
  if (
    e.code === 'P2002' ||
    e.code === '23505' ||
    e.originalCode === '23505' ||
    e.kind === 'UniqueConstraintViolation'
  ) {
    return true;
  }
  return hasUniqueSignal(e.cause, depth + 1) || hasUniqueSignal(e.meta, depth + 1);
}

/** Keys of the error graph that name the violated constraint (structured, never call-site text). */
const NAMING_KEYS = new Set(['constraint', 'index', 'target', 'fields', 'originalMessage']);

/**
 * Prisma's `message` embeds the caller's source snippet, so it is never scanned whole: only the tail
 * after the driver's own phrase is read.
 */
function violationText(message: string): string {
  const at = Math.max(
    message.lastIndexOf('Unique constraint failed'),
    message.lastIndexOf('duplicate key value'),
  );
  return at === -1 ? '' : message.slice(at);
}

function collectNames(value: unknown, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((v) => collectNames(v, depth + 1, out));
    return;
  }
  if (value instanceof Error) out.push(violationText(value.message));
  for (const [key, v] of Object.entries(value)) {
    if (key === 'message' && typeof v === 'string') out.push(violationText(v));
    else if (NAMING_KEYS.has(key)) collectStrings(v, depth + 1, out);
    else collectNames(v, depth + 1, out);
  }
}

function collectStrings(value: unknown, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH) return;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, depth + 1, out));
  else if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) collectStrings(v, depth + 1, out);
  }
}

/**
 * `true` when `error` is a Postgres unique violation, as surfaced by Prisma (`P2002`), raw SQLSTATE
 * `23505` or the driver-adapter shape (`UniqueConstraintViolation`), at any depth of the `cause`/`meta`
 * chain. With `constraint`, the violation must also name that unique index (partial uniques such as
 * `contact_one_primary` appear by name in the driver message or in `meta`).
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!hasUniqueSignal(error, 0)) return false;
  if (constraint === undefined) return true;
  const strings: string[] = [];
  collectNames(error, 0, strings);
  return strings.some((s) => s.includes(constraint));
}
