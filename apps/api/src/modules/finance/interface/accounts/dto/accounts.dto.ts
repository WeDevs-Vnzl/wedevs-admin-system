import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ACCOUNT_MOVEMENT_TYPE_VALUES,
  ACCOUNT_TYPE_VALUES,
} from '../../../../../shared/domain/enums';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import { entityRefResponseSchema } from '../../../../../shared/interface/error-envelope';
import {
  dateOnlySchema,
  decimalStringSchema,
  idSchema,
  moneyAmountSchema,
  rateSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';
import {
  LEDGER_ENTRY_KIND_VALUES,
  type LedgerRow,
} from '../../../application/ports/account.repository.port';
import type { AccountPartner } from '../../../application/ports/account-partners.port';
import {
  ACCOUNT_SORT_FIELDS,
  DEFAULT_ACCOUNT_SORT,
  DEFAULT_LEDGER_SORT,
  LEDGER_SORT_FIELDS,
  type AccountOutput,
} from '../../../application/use-cases/accounts/account-support';
import type { AccountBalanceOutput } from '../../../application/use-cases/accounts/get-account-balance.use-case';
import type { MovementOutput } from '../../../application/use-cases/accounts/create-movement.use-case';
import type { ReconciliationOutput } from '../../../application/use-cases/accounts/reconcile-account.use-case';
import type { TransferOutput } from '../../../application/use-cases/accounts/create-transfer.use-case';

/**
 * Request and response shapes of the account routes (the FE `validators/accounts`). Money travels as decimal
 * strings; the use cases repeat every rule for callers that skip the DTO (lesson B2). The identifier is masked
 * by the use case, whatever is sent (C5).
 */

const amountPositive = moneyAmountSchema({ sign: 'positive' });
const amountNonNegative = moneyAmountSchema({ sign: 'nonNegative' });
const amountAny = moneyAmountSchema({ sign: 'any' });
const currencyCodeSchema = z.string().regex(/^[A-Z][A-Z0-9]{2,9}$/, {
  message: 'validation.currency.invalid',
});
const accountTypeSchema = z.enum(ACCOUNT_TYPE_VALUES);
const movementTypeSchema = z.enum(ACCOUNT_MOVEMENT_TYPE_VALUES);
const ledgerKindSchema = z.enum(LEDGER_ENTRY_KIND_VALUES);
const text = (max: number) => z.string().trim().max(max, { message: 'validation.tooLong' });
const optionalText = (max: number) => text(max).nullish();

export class AccountIdParamsDto extends createZodDto(z.object({ id: idSchema })) {}

const accountFields = {
  name: text(80).min(1, { message: 'validation.required' }),
  type: accountTypeSchema,
  institution: optionalText(80),
  currency: currencyCodeSchema,
  /** Whatever the user typed: the use case masks it (a blank value keeps the stored one on update). */
  identifierMasked: z.string().trim().max(64).nullish(),
  holderName: optionalText(120),
  openingBalance: amountAny,
  openingDate: dateOnlySchema,
  active: z.boolean(),
  notes: optionalText(1000),
};

/** `POST /accounts`. */
export class CreateAccountDto extends createZodDto(
  z.object({
    ...accountFields,
    openingBalance: amountAny.default('0'),
    active: z.boolean().default(true),
  }),
) {}

/** `PATCH /accounts/{id}`: every field optional; an absent one keeps the stored value. */
export class UpdateAccountDto extends createZodDto(z.object(accountFields).partial()) {}

/** `GET /accounts`: paging, `q`, `sort` and the facets of the accounts table. */
export class ListAccountsQueryDto extends createListQueryDto({
  sortFields: ACCOUNT_SORT_FIELDS,
  defaultSort: DEFAULT_ACCOUNT_SORT,
  filters: {
    type: accountTypeSchema,
    currency: currencyCodeSchema,
    status: z.enum(['active', 'inactive']),
    includeInactive: z.enum(['true', 'false']),
  },
}) {}

/** `GET /accounts/{id}/ledger`: date range and entry kind; the balance of each row never changes. */
export class AccountLedgerQueryDto extends createListQueryDto({
  sortFields: LEDGER_SORT_FIELDS,
  defaultSort: DEFAULT_LEDGER_SORT,
  filters: { kind: ledgerKindSchema, dateFrom: dateOnlySchema, dateTo: dateOnlySchema },
}) {}

/** `GET /accounts/{id}/balance?at`. */
export class AccountBalanceQueryDto extends createZodDto(
  z.object({ at: dateOnlySchema.optional() }),
) {}

/** `POST /accounts/{id}/reconcile`. */
export class ReconcileAccountDto extends createZodDto(
  z.object({ date: dateOnlySchema, statementBalance: amountAny, notes: optionalText(500) }),
) {}

/** `POST /accounts/{id}/movements`: the account comes from the path. */
export class CreateMovementDto extends createZodDto(
  z.object({
    type: movementTypeSchema,
    date: dateOnlySchema,
    /** Positive for contributions and withdrawals (the type gives the sign); signed and non-zero for `AJUSTE`. */
    amount: amountAny,
    /** Account-currency rate to USD of the day, for the USD snapshot. */
    usdRate: rateSchema,
    partnerId: idSchema.nullish(),
    description: text(200).min(1, { message: 'validation.required' }),
  }),
) {}

/** `POST /transfers`. */
export class CreateTransferDto extends createZodDto(
  z.object({
    date: dateOnlySchema,
    fromAccountId: idSchema,
    toAccountId: idSchema,
    amountFrom: amountPositive,
    amountTo: amountPositive,
    feeAmount: amountNonNegative.default('0'),
    rate: rateSchema.nullish(),
    usdRate: rateSchema,
    reference: optionalText(80),
    notes: optionalText(500),
  }),
) {}

const accountResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: accountTypeSchema,
  institution: z.string().nullable(),
  currency: z.string(),
  /** Always masked; the full identifier is never stored or returned. */
  identifierMasked: z.string().nullable(),
  holderName: z.string().nullable(),
  openingBalance: decimalStringSchema,
  openingDate: dateOnlySchema,
  active: z.boolean(),
  notes: z.string().nullable(),
  /** Current balance in the account currency (cache rewritten by every money mutation). */
  balance: decimalStringSchema,
  /** Balance in USD at the rate of today; `null` while the currency has none. */
  balanceUsd: decimalStringSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export class AccountResponseDto extends createZodDto(accountResponseSchema) {}

export class AccountListResponseDto extends createZodDto(
  z.object({
    items: z.array(accountResponseSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    pageCount: z.number().int(),
  }),
) {}

const ledgerRowSchema = z.object({
  id: z.string(),
  date: dateOnlySchema,
  kind: ledgerKindSchema,
  /** The payment, expense, transfer or movement behind the entry; `null` for the opening balance. */
  source: entityRefResponseSchema.nullable(),
  description: z.string().nullable(),
  /** Signed effect on the account balance, in the account currency. */
  amount: decimalStringSchema,
  /** Running balance after this entry, over every entry of the account. */
  balance: decimalStringSchema,
});
export class AccountLedgerResponseDto extends createZodDto(
  z.object({
    items: z.array(ledgerRowSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    pageCount: z.number().int(),
  }),
) {}

export class AccountBalanceResponseDto extends createZodDto(
  z.object({
    accountId: idSchema,
    currency: z.string(),
    at: dateOnlySchema,
    balance: decimalStringSchema,
    balanceUsd: decimalStringSchema.nullable(),
  }),
) {}

export class ReconciliationResponseDto extends createZodDto(
  z.object({
    id: idSchema,
    accountId: idSchema,
    date: dateOnlySchema,
    statementBalance: decimalStringSchema,
    systemBalance: decimalStringSchema,
    /** `statementBalance − systemBalance`. */
    difference: decimalStringSchema,
    /** Signed `AJUSTE` that would close the difference; `null` when it is zero. */
    suggestedAdjustment: decimalStringSchema.nullable(),
    notes: z.string().nullable(),
    createdAt: timestampSchema,
  }),
) {}

export class TransferResponseDto extends createZodDto(
  z.object({
    id: idSchema,
    date: dateOnlySchema,
    fromAccount: entityRefResponseSchema,
    toAccount: entityRefResponseSchema,
    amountFrom: decimalStringSchema,
    amountTo: decimalStringSchema,
    feeAmount: decimalStringSchema,
    rate: decimalStringSchema.nullable(),
    amountUsd: decimalStringSchema,
    reference: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: timestampSchema,
  }),
) {}

export class MovementResponseDto extends createZodDto(
  z.object({
    id: idSchema,
    account: entityRefResponseSchema,
    type: movementTypeSchema,
    date: dateOnlySchema,
    amount: decimalStringSchema,
    amountUsd: decimalStringSchema,
    partner: entityRefResponseSchema.nullable(),
    description: z.string(),
    createdAt: timestampSchema,
  }),
) {}

export class AccountPartnerResponseDto extends createZodDto(
  z.object({ id: idSchema, name: z.string() }),
) {}

const refOf = (ref: EntityRef) => ({
  type: ref.type,
  id: ref.id,
  code: ref.code ?? null,
  label: ref.label,
});

export function toAccountResponse(account: AccountOutput): AccountResponseDto {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    institution: account.institution,
    currency: account.currency,
    identifierMasked: account.identifierMasked,
    holderName: account.holderName,
    openingBalance: account.openingBalance,
    openingDate: account.openingDate,
    active: account.active,
    notes: account.notes,
    balance: account.balance,
    balanceUsd: account.balanceUsd,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function toLedgerRowResponse(row: LedgerRow) {
  return {
    id: row.id,
    date: row.date,
    kind: row.kind,
    source: row.source && refOf(row.source),
    description: row.description,
    amount: row.amount,
    balance: row.balance,
  };
}

export function toBalanceResponse(balance: AccountBalanceOutput): AccountBalanceResponseDto {
  return { ...balance };
}

export function toReconciliationResponse(result: ReconciliationOutput): ReconciliationResponseDto {
  return { ...result };
}

export function toTransferResponse(transfer: TransferOutput): TransferResponseDto {
  return {
    id: transfer.id,
    date: transfer.date,
    fromAccount: refOf(transfer.fromAccount),
    toAccount: refOf(transfer.toAccount),
    amountFrom: transfer.amountFrom,
    amountTo: transfer.amountTo,
    feeAmount: transfer.feeAmount,
    rate: transfer.rate,
    amountUsd: transfer.amountUsd,
    reference: transfer.reference,
    notes: transfer.notes,
    createdAt: transfer.createdAt,
  };
}

export function toMovementResponse(movement: MovementOutput): MovementResponseDto {
  return {
    id: movement.id,
    account: refOf(movement.account),
    type: movement.type,
    date: movement.date,
    amount: movement.amount,
    amountUsd: movement.amountUsd,
    partner: movement.partner && refOf(movement.partner),
    description: movement.description,
    createdAt: movement.createdAt,
  };
}

export function toPartnerResponse(partner: AccountPartner): AccountPartnerResponseDto {
  return { id: partner.id, name: partner.name };
}
