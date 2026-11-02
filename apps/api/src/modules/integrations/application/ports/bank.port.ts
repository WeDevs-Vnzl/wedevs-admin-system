import type { StatementLine } from '../../domain/statement-matching';

/** DT-110 token; bound to a bank adapter (deferred to the VPS deploy stage, DT-186) or a fake. */
export const BANK = Symbol('BANK');

/**
 * Turns a statement export into lines. A malformed row throws `StatementParseError` with its row number;
 * nothing is stored (DT-187).
 */
export interface BankPort {
  parseStatement(bytes: Uint8Array, contentType: string): Promise<StatementLine[]>;
}
