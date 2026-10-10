import { z } from "./zod";
import {
  dateOnlySchema,
  entityRefSchema,
  idSchema,
  listQuerySchema,
  VALIDATION_MESSAGES,
} from "./common";
import { accountMovementTypeSchema, accountTypeSchema } from "./enums";
import { currencyCodeSchema, moneyAmountSchema, rateSchema } from "./money";
import { facetSchema, optionalText, requiredText, timestampSchema } from "./catalogs";
import { isDecimalString, isZeroMoney } from "../money";

/**
 * Company-account contracts (PRD §8.7, §9.7): accounts with a **masked** identifier, transfers between
 * accounts (each side in its own currency), manual movements, ledger and reconciliation. Balances are
 * computed in `lib/finance` (C17) from payments, expenses (`accountAmount` when currencies differ),
 * transfers and movements; DTOs only carry the result.
 */

export const ACCOUNT_MESSAGES = {
  sameAccount: "accounts.validation.sameAccount",
  partnerRequired: "accounts.validation.partnerRequired",
  adjustmentNonZero: "accounts.validation.adjustmentNonZero",
} as const;

const amountPositive = moneyAmountSchema({ sign: "positive" });
const amountNonNegative = moneyAmountSchema({ sign: "nonNegative" });
const amountAny = moneyAmountSchema({ sign: "any" });

// ───────────────────────────── Masked identifier (C5) ─────────────────────────────

const MASK_MARKS = /[•*…]/;

/**
 * Reduces an account identifier to what may be stored and shown (PRD §8.7, C5): only the last 4 digits
 * of a numeric account (`•••• 1234`), or the first and last characters of a wallet/e-mail (`0x1a…9f3c`).
 * Idempotent: a value that already carries a mask mark is returned as is.
 */
export function maskAccountIdentifier(raw: string): string {
  const value = raw.trim();
  if (MASK_MARKS.test(value)) return value;
  const compact = value.replace(/[\s-]/g, "");
  if (/^\d+$/.test(compact)) return `•••• ${compact.slice(-4)}`;
  if (compact.length >= 12) return `${compact.slice(0, 4)}…${compact.slice(-4)}`;
  if (compact.length >= 3) return `${compact.slice(0, 1)}…${compact.slice(-1)}`;
  return "•".repeat(compact.length);
}

/**
 * Input field of the identifier: whatever the user types is masked **during parsing**, so the parsed
 * input (and everything downstream: service, store, logs) never holds the full identifier. Blank →
 * `undefined` (unchanged on update); `null` → `null` (clear it).
 */
export const accountIdentifierInputSchema = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((value) => {
    if (value === null) return null;
    return value ? maskAccountIdentifier(value) : undefined;
  });

// ───────────────────────────── Account ─────────────────────────────

const accountFields = {
  name: requiredText(80),
  type: accountTypeSchema,
  institution: optionalText(80),
  currency: currencyCodeSchema,
  identifierMasked: accountIdentifierInputSchema,
  holderName: optionalText(120),
  openingBalance: amountAny.default("0"),
  openingDate: dateOnlySchema,
  active: z.boolean().default(true),
  notes: optionalText(1000),
};

export const createAccountInputSchema = z.object(accountFields);
export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;

export const updateAccountInputSchema = z.object({ id: idSchema, ...accountFields });
export type UpdateAccountInput = z.infer<typeof updateAccountInputSchema>;

export const accountDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: accountTypeSchema,
  institution: z.string().nullable(),
  currency: currencyCodeSchema,
  /** Always masked; the full identifier is never stored or returned. */
  identifierMasked: z.string().nullable(),
  holderName: z.string().nullable(),
  openingBalance: amountAny,
  openingDate: dateOnlySchema,
  active: z.boolean(),
  notes: z.string().nullable(),
  /** Current balance in the account currency. */
  balance: amountAny,
  /** Balance in USD with the latest rate; `null` while the currency has no rate. */
  balanceUsd: amountAny.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type AccountDTO = z.infer<typeof accountDtoSchema>;

/** `/accounts` overview: a card per account plus the consolidated USD total of the active ones. */
export const accountsOverviewDtoSchema = z.object({
  accounts: z.array(accountDtoSchema),
  totalBalanceUsd: amountAny,
});
export type AccountsOverviewDTO = z.infer<typeof accountsOverviewDtoSchema>;

// ───────────────────────────── Transfers ─────────────────────────────

const transferFields = {
  date: dateOnlySchema,
  fromAccountId: idSchema,
  toAccountId: idSchema,
  /** Debited from the origin account (the fee is debited on top). */
  amountFrom: amountPositive,
  /** Credited to the destination account, in its own currency. */
  amountTo: amountPositive,
  feeAmount: amountNonNegative.default("0"),
  /** Cross rate between the two currencies, kept when they differ. */
  rate: rateSchema.nullish().transform((value) => value ?? undefined),
  /** Origin-currency rate to USD, for the USD snapshot. */
  usdRate: rateSchema,
  reference: optionalText(80),
  notes: optionalText(500),
};

export const createTransferInputSchema = z.object(transferFields).superRefine((input, ctx) => {
  if (input.fromAccountId === input.toAccountId) {
    ctx.addIssue({
      code: "custom",
      message: ACCOUNT_MESSAGES.sameAccount,
      path: ["toAccountId"],
    });
  }
});
export type CreateTransferInput = z.infer<typeof createTransferInputSchema>;

export const transferDtoSchema = z.object({
  id: idSchema,
  date: dateOnlySchema,
  fromAccount: entityRefSchema,
  toAccount: entityRefSchema,
  amountFrom: amountPositive,
  amountTo: amountPositive,
  feeAmount: amountNonNegative,
  rate: rateSchema.nullable(),
  amountUsd: amountNonNegative,
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
});
export type TransferDTO = z.infer<typeof transferDtoSchema>;

// ───────────────────────────── Manual movements ─────────────────────────────

/**
 * `createMovement`: `APORTE_CAPITAL` (+) and `RETIRO_SOCIO` (−) take a positive amount and a partner;
 * the sign is applied by the service. `AJUSTE` is signed and non-zero.
 */
export const createMovementInputSchema = z
  .object({
    accountId: idSchema,
    type: accountMovementTypeSchema,
    date: dateOnlySchema,
    amount: amountAny,
    usdRate: rateSchema,
    /** The partner (a user) behind a contribution or withdrawal. */
    partnerId: idSchema.nullish().transform((value) => value ?? undefined),
    description: requiredText(200),
  })
  .superRefine((input, ctx) => {
    if (isDecimalString(input.amount)) {
      if (input.type === "AJUSTE") {
        if (isZeroMoney(input.amount)) {
          ctx.addIssue({
            code: "custom",
            message: ACCOUNT_MESSAGES.adjustmentNonZero,
            path: ["amount"],
          });
        }
      } else if (!amountPositive.safeParse(input.amount).success) {
        ctx.addIssue({
          code: "custom",
          message: VALIDATION_MESSAGES.moneyMustBePositive,
          path: ["amount"],
        });
      }
    }
    if (input.type !== "AJUSTE" && input.partnerId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: ACCOUNT_MESSAGES.partnerRequired,
        path: ["partnerId"],
      });
    }
  });
export type CreateMovementInput = z.infer<typeof createMovementInputSchema>;

export const movementDtoSchema = z.object({
  id: idSchema,
  account: entityRefSchema,
  type: accountMovementTypeSchema,
  date: dateOnlySchema,
  /** Signed: contributions positive, withdrawals negative. */
  amount: amountAny,
  amountUsd: amountAny,
  partner: entityRefSchema.nullable(),
  description: z.string(),
  createdAt: timestampSchema,
});
export type MovementDTO = z.infer<typeof movementDtoSchema>;

// ───────────────────────────── Ledger and balance ─────────────────────────────

export const LEDGER_ENTRY_KIND_VALUES = [
  "OPENING_BALANCE",
  "PAYMENT",
  "EXPENSE",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "APORTE_CAPITAL",
  "RETIRO_SOCIO",
  "AJUSTE",
] as const;
export const ledgerEntryKindSchema = z.enum(LEDGER_ENTRY_KIND_VALUES);
export type LedgerEntryKind = z.infer<typeof ledgerEntryKindSchema>;

/** `getAccountLedger` filters: date range and entry type (PRD §8.7). */
export const accountLedgerQuerySchema = listQuerySchema.extend({
  accountId: idSchema,
  kind: facetSchema(ledgerEntryKindSchema),
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
});
export type AccountLedgerQuery = z.infer<typeof accountLedgerQuerySchema>;

export const ledgerRowSchema = z.object({
  id: z.string().min(1),
  date: dateOnlySchema,
  kind: ledgerEntryKindSchema,
  /** The payment, expense or transfer behind the entry, when there is one. */
  source: entityRefSchema.nullable(),
  description: z.string().nullable(),
  /** Signed effect on the account balance, in the account currency. */
  amount: amountAny,
  /** Running balance after this entry. */
  balance: amountAny,
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;

/** `getAccountBalance(at)`: balance up to a date (today when omitted). */
export const getAccountBalanceInputSchema = z.object({
  accountId: idSchema,
  at: dateOnlySchema.optional(),
});
export type GetAccountBalanceInput = z.infer<typeof getAccountBalanceInputSchema>;

export const accountBalanceDtoSchema = z.object({
  accountId: idSchema,
  currency: currencyCodeSchema,
  at: dateOnlySchema,
  balance: amountAny,
  balanceUsd: amountAny.nullable(),
});
export type AccountBalanceDTO = z.infer<typeof accountBalanceDtoSchema>;

// ───────────────────────────── Reconciliation ─────────────────────────────

/** "Conciliar": records the real balance at a date; a difference suggests an `AJUSTE`. */
export const reconcileAccountInputSchema = z.object({
  accountId: idSchema,
  date: dateOnlySchema,
  statementBalance: amountAny,
  notes: optionalText(500),
});
export type ReconcileAccountInput = z.infer<typeof reconcileAccountInputSchema>;

export const reconciliationDtoSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  date: dateOnlySchema,
  statementBalance: amountAny,
  systemBalance: amountAny,
  /** `statementBalance − systemBalance`. */
  difference: amountAny,
  /** Signed `AJUSTE` amount that would close the difference; `null` when it is zero. */
  suggestedAdjustment: amountAny.nullable(),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
});
export type ReconciliationDTO = z.infer<typeof reconciliationDtoSchema>;
