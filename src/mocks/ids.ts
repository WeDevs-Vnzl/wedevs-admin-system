// MOCK — stable readable ids and the mock code sequences of Hito 1 (data-rules.md §2, §5, C9).
// Deleted with `src/mocks/` at the close of Hito 2, when ids are cuids and codes come from the `Sequence` table.

/** Prefixes of the immutable entity codes (`CLI-0007`), one mock sequence each (data-rules.md §5). */
export const CODE_PREFIX_VALUES = ["CLI", "PRY", "FAC", "PAG", "GAS", "DOC"] as const;
export type CodePrefix = (typeof CODE_PREFIX_VALUES)[number];

/** Last value handed out per prefix. Starts at 0, so the first code is `<PREFIX>-0001`. */
export type MockSequences = Record<CodePrefix, number>;

export function createMockSequences(): MockSequences {
  return { CLI: 0, PRY: 0, FAC: 0, PAG: 0, GAS: 0, DOC: 0 };
}

/** `("CLI", 7)` → `CLI-0007`. The 4-digit pad is a minimum: `CLI-10000` keeps growing. */
export function formatCode(prefix: CodePrefix, value: number): string {
  return `${prefix}-${String(value).padStart(4, "0")}`;
}

/** Numeric part of a code of `prefix` (`CLI-0007` → 7); `null` when the code is not one of that prefix. */
export function parseCode(prefix: CodePrefix, code: string): number | null {
  const match = new RegExp(`^${prefix}-(\\d{4,})$`).exec(code);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** Allocates the next code of `prefix`, mirroring `UPDATE "Sequence" SET value = value + 1` (never `max + 1`). */
export function nextMockCode(sequences: MockSequences, prefix: CodePrefix): string {
  sequences[prefix] += 1;
  return formatCode(prefix, sequences[prefix]);
}

/** Raises each sequence to the highest code found in `codes`, so new codes never collide with fixtures. */
export function syncMockSequences(
  sequences: MockSequences,
  codes: Partial<Record<CodePrefix, Iterable<string>>>,
): void {
  for (const prefix of CODE_PREFIX_VALUES) {
    for (const code of codes[prefix] ?? []) {
      const value = parseCode(prefix, code);
      if (value !== null && value > sequences[prefix]) sequences[prefix] = value;
    }
  }
}

/**
 * Fixture id: a lower-case kind plus a readable key, e.g. `mockId("cli", "kairos")` → `cli_kairos`.
 * Fixtures reference each other across modules through these (`data-rules.md` §2 "Identifiers").
 */
export function mockId(kind: string, key: string): string {
  const id = `${kind}_${key}`;
  if (!/^[a-z][a-z0-9]*_[A-Za-z0-9_-]+$/.test(id) || id.length > 64) {
    throw new RangeError(`Invalid mock id: ${JSON.stringify(id)}`);
  }
  return id;
}

/** Counters for ids created at runtime (uploaded files, new tags…), one per kind. */
export type MockIdCounters = Record<string, number>;

/**
 * Id of a record created at runtime: `fil_0001`, `fil_0002`… Skips ids already taken (fixtures may use the
 * same shape), so it never collides.
 */
export function nextMockId(
  counters: MockIdCounters,
  kind: string,
  isTaken: (id: string) => boolean = () => false,
): string {
  let id: string;
  do {
    counters[kind] = (counters[kind] ?? 0) + 1;
    id = mockId(kind, String(counters[kind]).padStart(4, "0"));
  } while (isTaken(id));
  return id;
}
