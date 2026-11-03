import { DomainError, compareMoney, daysBetween } from '../../../shared/domain';

/**
 * Bank-agnostic statement matching (DT-187, A12). A parsed statement line is compared with the account's
 * own records; the result is reconciliation input only, nothing is stored.
 */

/** One parsed statement row. `date` is a date-only `YYYY-MM-DD`; `amount` a signed decimal string. */
export interface StatementLine {
  readonly rowNumber: number;
  readonly date: string;
  readonly amount: string;
  readonly description: string;
  readonly reference: string | null;
}

export type LedgerRecordKind = 'PAYMENT' | 'EXPENSE' | 'TRANSFER' | 'MOVEMENT';

/** One record of the account in the statement window; `amount` is signed from the account's side. */
export interface LedgerRecord {
  readonly id: string;
  readonly kind: LedgerRecordKind;
  readonly date: string;
  readonly amount: string;
  readonly reference: string | null;
}

export interface StatementMatch {
  readonly rowNumber: number;
  readonly recordId: string;
}

export interface StatementMatchResult {
  readonly matched: StatementMatch[];
  readonly unmatchedLines: number[];
  readonly unmatchedRecords: string[];
}

/** Calendar days either side of a line's date that still count as the same operation. */
export const DEFAULT_MATCH_WINDOW_DAYS = 3;

/** A statement that cannot be read: a typed failure that names the offending row (`BankPort`). */
export class StatementParseError extends DomainError {
  constructor(
    readonly rowNumber: number,
    message: string,
  ) {
    super('VALIDATION', { message, fieldErrors: { row: [String(rowNumber)] } });
  }
}

function normalizeReference(reference: string | null): string | null {
  const trimmed = reference?.trim().toUpperCase() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Greedy, deterministic one-to-one matching in two passes. A candidate needs an equal amount, a date
 * inside the window and, when both sides carry a reference, equal references. Pass one pairs lines whose
 * references agree; pass two pairs the rest by the closest date, then by input order. A line matches at
 * most one record and a record at most one line.
 */
export function matchStatement(
  lines: readonly StatementLine[],
  records: readonly LedgerRecord[],
  options: { readonly windowDays?: number } = {},
): StatementMatchResult {
  const window = options.windowDays ?? DEFAULT_MATCH_WINDOW_DAYS;
  const ordered = [...lines].sort((a, b) => a.rowNumber - b.rowNumber);
  const used = new Set<string>();
  const pairs = new Map<number, string>();

  const pass = (referenceRequired: boolean): void => {
    for (const line of ordered) {
      if (pairs.has(line.rowNumber)) continue;
      const lineRef = normalizeReference(line.reference);
      if (referenceRequired && lineRef === null) continue;
      let best: { record: LedgerRecord; distance: number } | null = null;
      for (const record of records) {
        if (used.has(record.id)) continue;
        if (compareMoney(line.amount, record.amount) !== 0) continue;
        const distance = Math.abs(daysBetween(line.date, record.date));
        if (distance > window) continue;
        const recordRef = normalizeReference(record.reference);
        const referencesAgree = lineRef !== null && recordRef !== null && lineRef === recordRef;
        const referencesClash = lineRef !== null && recordRef !== null && lineRef !== recordRef;
        if (referencesClash) continue;
        if (referenceRequired && !referencesAgree) continue;
        if (best === null || distance < best.distance) best = { record, distance };
      }
      if (best !== null) {
        used.add(best.record.id);
        pairs.set(line.rowNumber, best.record.id);
      }
    }
  };
  pass(true);
  pass(false);

  return {
    matched: ordered
      .filter((line) => pairs.has(line.rowNumber))
      .map((line) => ({
        rowNumber: line.rowNumber,
        recordId: pairs.get(line.rowNumber) as string,
      })),
    unmatchedLines: ordered
      .filter((line) => !pairs.has(line.rowNumber))
      .map((line) => line.rowNumber),
    unmatchedRecords: records.filter((record) => !used.has(record.id)).map((record) => record.id),
  };
}
