import { describe, expect, it } from 'vitest';
import type { BankPort } from '../../../src/modules/integrations/application/ports/bank.port';
import {
  StatementParseError,
  type StatementLine,
} from '../../../src/modules/integrations/domain/statement-matching';

export interface StatementFixture {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/**
 * Parameters of the suite: the fixture path and content type are inputs, so the deferred bank adapter runs the
 * same suite unchanged over its anonymized sample (DT-186, C5).
 */
export interface BankHarness {
  readonly port: BankPort;
  readonly valid: StatementFixture & { readonly expected: readonly StatementLine[] };
  /** A statement whose row `rowNumber` cannot be read. */
  readonly malformed: StatementFixture & { readonly rowNumber: number };
  readonly unsupportedContentType: string;
}

/** Contract of `BankPort` (A7, A12). */
export function bankContract(
  name: string,
  factory: () => Promise<BankHarness> | BankHarness,
): void {
  describe(`BankPort contract: ${name}`, () => {
    it('parses a statement into lines', async () => {
      const h = await factory();
      const lines = await h.port.parseStatement(h.valid.bytes, h.valid.contentType);
      expect(lines).toEqual(h.valid.expected);
    });

    it('numbers rows from 1 in order, with date-only dates and decimal-string amounts', async () => {
      const h = await factory();
      const lines = await h.port.parseStatement(h.valid.bytes, h.valid.contentType);
      expect(lines.map((line) => line.rowNumber)).toEqual(lines.map((_, index) => index + 1));
      for (const line of lines) {
        expect(line.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(line.amount).toMatch(/^-?\d+(\.\d+)?$/);
      }
    });

    it('fails with a typed error that names the offending row', async () => {
      const h = await factory();
      const error = await h.port.parseStatement(h.malformed.bytes, h.malformed.contentType).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(StatementParseError);
      expect((error as StatementParseError).rowNumber).toBe(h.malformed.rowNumber);
      expect((error as StatementParseError).code).toBe('VALIDATION');
    });

    it('refuses a content type it does not read', async () => {
      const h = await factory();
      const error = await h.port.parseStatement(h.valid.bytes, h.unsupportedContentType).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toMatchObject({ code: 'VALIDATION' });
    });
  });
}
