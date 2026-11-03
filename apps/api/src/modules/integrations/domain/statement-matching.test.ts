import { describe, expect, it } from 'vitest';
import {
  StatementParseError,
  matchStatement,
  type LedgerRecord,
  type StatementLine,
} from './statement-matching';

const line = (
  rowNumber: number,
  date: string,
  amount: string,
  reference: string | null = null,
): StatementLine => ({ rowNumber, date, amount, reference, description: `row ${rowNumber}` });
const record = (
  id: string,
  date: string,
  amount: string,
  reference: string | null = null,
): LedgerRecord => ({ id, kind: 'PAYMENT', date, amount, reference });

describe('matchStatement', () => {
  it('matches a line to a record of the same amount on the same day', () => {
    const out = matchStatement(
      [line(1, '2026-11-02', '100.00')],
      [record('r1', '2026-11-02', '100.00')],
    );
    expect(out.matched).toEqual([{ rowNumber: 1, recordId: 'r1' }]);
    expect(out.unmatchedLines).toEqual([]);
    expect(out.unmatchedRecords).toEqual([]);
  });

  it('compares amounts numerically, not as text', () => {
    const out = matchStatement(
      [line(1, '2026-11-02', '100.5')],
      [record('r1', '2026-11-02', '100.50')],
    );
    expect(out.matched).toHaveLength(1);
  });

  it('matches inside the date window and refuses outside it', () => {
    const inside = matchStatement(
      [line(1, '2026-11-05', '10.00')],
      [record('r1', '2026-11-02', '10.00')],
    );
    expect(inside.matched).toHaveLength(1);
    const outside = matchStatement(
      [line(1, '2026-11-06', '10.00')],
      [record('r1', '2026-11-02', '10.00')],
    );
    expect(outside.matched).toEqual([]);
    expect(outside.unmatchedLines).toEqual([1]);
    expect(outside.unmatchedRecords).toEqual(['r1']);
  });

  it('honours a custom window', () => {
    const out = matchStatement(
      [line(1, '2026-11-03', '10.00')],
      [record('r1', '2026-11-02', '10.00')],
      { windowDays: 0 },
    );
    expect(out.matched).toEqual([]);
  });

  it('does not match a different amount, even by one cent', () => {
    const out = matchStatement(
      [line(1, '2026-11-02', '10.01')],
      [record('r1', '2026-11-02', '10.00')],
    );
    expect(out.matched).toEqual([]);
  });

  it('keeps the sign: a debit never matches a credit of the same size', () => {
    const out = matchStatement(
      [line(1, '2026-11-02', '-10.00')],
      [record('r1', '2026-11-02', '10.00')],
    );
    expect(out.matched).toEqual([]);
  });

  it('pairs duplicate amounts on one day one to one', () => {
    const out = matchStatement(
      [line(1, '2026-11-02', '50.00'), line(2, '2026-11-02', '50.00')],
      [record('r1', '2026-11-02', '50.00'), record('r2', '2026-11-02', '50.00')],
    );
    expect(out.matched).toEqual([
      { rowNumber: 1, recordId: 'r1' },
      { rowNumber: 2, recordId: 'r2' },
    ]);
  });

  it('leaves the surplus line unmatched when records are fewer', () => {
    const out = matchStatement(
      [line(1, '2026-11-02', '50.00'), line(2, '2026-11-02', '50.00')],
      [record('r1', '2026-11-02', '50.00')],
    );
    expect(out.matched).toEqual([{ rowNumber: 1, recordId: 'r1' }]);
    expect(out.unmatchedLines).toEqual([2]);
  });

  it('uses the reference to break ties between equal amounts', () => {
    const out = matchStatement(
      [line(1, '2026-11-02', '50.00', 'REF-B'), line(2, '2026-11-02', '50.00', 'REF-A')],
      [record('r1', '2026-11-02', '50.00', 'REF-A'), record('r2', '2026-11-02', '50.00', 'REF-B')],
    );
    expect(out.matched).toEqual([
      { rowNumber: 1, recordId: 'r2' },
      { rowNumber: 2, recordId: 'r1' },
    ]);
  });

  it('refuses two different references even when amount and date agree', () => {
    const out = matchStatement(
      [line(1, '2026-11-02', '50.00', 'REF-A')],
      [record('r1', '2026-11-02', '50.00', 'REF-Z')],
    );
    expect(out.matched).toEqual([]);
  });

  it('ignores the reference when either side has none', () => {
    const a = matchStatement(
      [line(1, '2026-11-02', '50.00', 'REF-A')],
      [record('r1', '2026-11-02', '50.00')],
    );
    const b = matchStatement(
      [line(1, '2026-11-02', '50.00')],
      [record('r1', '2026-11-02', '50.00', 'REF-A')],
    );
    expect(a.matched).toHaveLength(1);
    expect(b.matched).toHaveLength(1);
  });

  it('compares references ignoring case and surrounding spaces', () => {
    const out = matchStatement(
      [line(1, '2026-11-02', '50.00', ' ref-a ')],
      [record('r1', '2026-11-02', '50.00', 'REF-A')],
    );
    expect(out.matched).toHaveLength(1);
  });

  it('prefers the closest date among candidates without references', () => {
    const out = matchStatement(
      [line(1, '2026-11-03', '50.00')],
      [record('far', '2026-11-01', '50.00'), record('near', '2026-11-03', '50.00')],
    );
    expect(out.matched).toEqual([{ rowNumber: 1, recordId: 'near' }]);
    expect(out.unmatchedRecords).toEqual(['far']);
  });

  it('resolves equal candidates in input order', () => {
    const lines = [line(1, '2026-11-02', '5.00'), line(2, '2026-11-02', '5.00')];
    const records = [record('r2', '2026-11-02', '5.00'), record('r1', '2026-11-02', '5.00')];
    const out = matchStatement(lines, records);
    expect(out.matched).toEqual([
      { rowNumber: 1, recordId: 'r2' },
      { rowNumber: 2, recordId: 'r1' },
    ]);
  });

  it('returns empty sets for empty input', () => {
    expect(matchStatement([], [])).toEqual({
      matched: [],
      unmatchedLines: [],
      unmatchedRecords: [],
    });
  });
});

describe('StatementParseError', () => {
  it('is a VALIDATION error carrying the row number', () => {
    const error = new StatementParseError(7, 'validation.statement.invalidAmount');
    expect(error.code).toBe('VALIDATION');
    expect(error.rowNumber).toBe(7);
    expect(error.message).toBe('validation.statement.invalidAmount');
    expect(error.fieldErrors).toEqual({ row: ['7'] });
  });
});
