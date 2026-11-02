import type { BankPort } from '../../../src/modules/integrations/application/ports/bank.port';
import {
  StatementParseError,
  type StatementLine,
} from '../../../src/modules/integrations/domain/statement-matching';

export const FAKE_STATEMENT_CONTENT_TYPE = 'text/x-fake-statement';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^-?\d+(\.\d+)?$/;

/**
 * Fake `BankPort` over a trivial format: one `date;amount;reference;description` row per line, no header.
 * Row numbers start at 1. The deferred real adapter parses its bank's export and runs the same suite.
 */
export class InMemoryBank implements BankPort {
  async parseStatement(bytes: Uint8Array, contentType: string): Promise<StatementLine[]> {
    if (contentType !== FAKE_STATEMENT_CONTENT_TYPE) {
      throw new StatementParseError(0, 'validation.statement.unsupportedContentType');
    }
    const rows = Buffer.from(bytes)
      .toString('utf8')
      .split(/\r?\n/)
      .filter((row) => row.trim() !== '');
    return rows.map((row, index) => {
      const rowNumber = index + 1;
      const [date = '', amount = '', reference = '', description = ''] = row.split(';');
      if (!DATE_ONLY.test(date))
        throw new StatementParseError(rowNumber, 'validation.statement.invalidDate');
      if (!AMOUNT.test(amount))
        throw new StatementParseError(rowNumber, 'validation.statement.invalidAmount');
      return {
        rowNumber,
        date,
        amount,
        reference: reference === '' ? null : reference,
        description,
      };
    });
  }
}
