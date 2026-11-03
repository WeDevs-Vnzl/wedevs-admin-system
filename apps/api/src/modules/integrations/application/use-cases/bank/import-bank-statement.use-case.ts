import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import { ValidationFailedError, addDays } from '../../../../../shared/domain';
import {
  DEFAULT_MATCH_WINDOW_DAYS,
  matchStatement,
  type StatementMatch,
} from '../../../domain/statement-matching';
import type { AccountLedgerForMatchPort } from '../../ports/account-ledger-for-match.port';
import type { BankPort } from '../../ports/bank.port';

/** The statement rows one import accepts; a larger file is refused whole. */
export const MAX_STATEMENT_ROWS = 2000;

export const IMPORT_BANK_STATEMENT_MESSAGES = {
  accountInactive: 'integrations.bank.validation.accountInactive',
  accountNotBank: 'integrations.bank.validation.accountNotBank',
  tooManyRows: 'integrations.bank.validation.tooManyRows',
  emptyStatement: 'integrations.bank.validation.emptyStatement',
  balanceRequired: 'integrations.bank.validation.balanceRequired',
} as const;

const BANK_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['BANCO_NACIONAL', 'BANCO_INTERNACIONAL']);

/** What the import needs of an account; finance's `GetAccount` satisfies it (DT-110). */
export interface BankStatementAccountReader {
  execute(actor: CurrentUser, accountId: string): Promise<{ type: string; active: boolean }>;
}

/** What the import needs of a reconciliation; finance's `ReconcileAccount` satisfies it (DT-110). */
export interface BankStatementReconciler<R = unknown> {
  execute(
    actor: CurrentUser,
    accountId: string,
    input: { date: string; statementBalance: string },
  ): Promise<R>;
}

export interface ImportBankStatementInput {
  readonly accountId: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** The balance the statement closes with; required with `reconcile`. Decimal string. */
  readonly statementBalance?: string | null;
  /** Records a reconciliation at the date of the last statement line. Off by default (DT-187). */
  readonly reconcile?: boolean;
}

export interface ImportBankStatementOutput<R = unknown> {
  readonly matched: StatementMatch[];
  /** Row numbers of the statement lines with no ledger record. */
  readonly unmatchedLines: number[];
  /** Ids of the ledger records in the window with no statement line. */
  readonly unmatchedRecords: string[];
  readonly statementBalance: string | null;
  /** The `ReconcileAccount` result when `reconcile` was true; `null` otherwise. */
  readonly reconciliation: R | null;
}

/**
 * `ImportBankStatement` (DT-187, A12): reconciliation input only. Needs the `ReconcileAccount` grant
 * (`update` `account`), resolves an active bank account (C14), parses through `BankPort` (a bad row fails
 * the file with its number), caps the rows, matches the lines against the account's ledger over the
 * statement window and answers the matched and unmatched sides. No statement line is stored; the only
 * write is `ReconcileAccount`, and only when `reconcile` is true.
 */
export class ImportBankStatement<R = unknown> {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly accounts: BankStatementAccountReader,
    private readonly bank: BankPort,
    private readonly ledger: AccountLedgerForMatchPort,
    private readonly reconciler: BankStatementReconciler<R>,
  ) {}

  async execute(
    actor: CurrentUser,
    input: ImportBankStatementInput,
  ): Promise<ImportBankStatementOutput<R>> {
    assertCan(this.authorization, actor, 'update', 'account');
    const statementBalance = input.statementBalance ?? null;
    if (input.reconcile === true && statementBalance === null) {
      throw fieldError('statementBalance', IMPORT_BANK_STATEMENT_MESSAGES.balanceRequired);
    }
    const account = await this.accounts.execute(actor, input.accountId);
    if (!account.active) {
      throw fieldError('accountId', IMPORT_BANK_STATEMENT_MESSAGES.accountInactive);
    }
    if (!BANK_ACCOUNT_TYPES.has(account.type)) {
      throw fieldError('accountId', IMPORT_BANK_STATEMENT_MESSAGES.accountNotBank);
    }

    const lines = await this.bank.parseStatement(input.bytes, input.contentType);
    if (lines.length === 0) {
      throw fieldError('file', IMPORT_BANK_STATEMENT_MESSAGES.emptyStatement);
    }
    if (lines.length > MAX_STATEMENT_ROWS) {
      throw fieldError('file', IMPORT_BANK_STATEMENT_MESSAGES.tooManyRows);
    }

    const dates = lines.map((line) => line.date).sort();
    const first = dates[0] as string;
    const last = dates[dates.length - 1] as string;
    const records = await this.ledger.entries(
      actor,
      input.accountId,
      addDays(first, -DEFAULT_MATCH_WINDOW_DAYS),
      addDays(last, DEFAULT_MATCH_WINDOW_DAYS),
    );
    const result = matchStatement(lines, records);

    const reconciliation =
      input.reconcile === true && statementBalance !== null
        ? await this.reconciler.execute(actor, input.accountId, {
            date: last,
            statementBalance,
          })
        : null;
    return { ...result, statementBalance, reconciliation };
  }
}

function fieldError(field: string, key: string): ValidationFailedError {
  return new ValidationFailedError({ message: key, fieldErrors: { [field]: [key] } });
}
