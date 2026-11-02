import type { CurrentUser } from '../../../shared/application/current-user';
import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import type { SettingRepository } from './ports/setting.repository';

/** `Setting` key holding where provider money lands (DT-183, DT-184). */
export const INTEGRATION_MAPPING_KEY = 'integrations.mapping';

export const INTEGRATION_MAPPING_MESSAGES = {
  invalidId: 'validation.id.invalid',
  accountNotFound: 'integrations.mapping.accountInvalid',
  accountNotWallet: 'integrations.mapping.accountNotWallet',
  methodInvalid: 'integrations.mapping.methodInvalid',
} as const;

export interface StripeMapping {
  readonly accountId: string;
  readonly paymentMethodId: string;
}
export interface BinanceMapping {
  readonly accountId: string;
}

/** The mapping as stored and returned: `null` for an integration the Owner has not set up. */
export interface IntegrationMappingSettings {
  readonly stripe: StripeMapping | null;
  readonly binance: BinanceMapping | null;
}

export interface IntegrationMappingInput {
  readonly stripe?: { readonly accountId?: string; readonly paymentMethodId?: string } | null;
  readonly binance?: { readonly accountId?: string } | null;
}

export const EMPTY_INTEGRATION_MAPPING: IntegrationMappingSettings = {
  stripe: null,
  binance: null,
};

/**
 * What the mapping validation needs from finance and the method catalog (C14): the account's type and
 * state, and whether a payment method is active. `null` when the account does not exist.
 */
export interface IntegrationMappingReferences {
  account(
    actor: CurrentUser,
    id: string,
  ): Promise<{ readonly active: boolean; readonly type: string } | null>;
  methodIsActive(id: string): Promise<boolean>;
}
export const INTEGRATION_MAPPING_REFERENCES = Symbol('INTEGRATION_MAPPING_REFERENCES');

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** Reads a stored row tolerantly: anything malformed counts as "not configured". */
export function mappingFromStored(value: unknown): IntegrationMappingSettings {
  if (typeof value !== 'object' || value === null) return EMPTY_INTEGRATION_MAPPING;
  const row = value as {
    stripe?: Record<string, unknown> | null;
    binance?: Record<string, unknown> | null;
  };
  const stripeAccount = text(row.stripe?.accountId);
  const stripeMethod = text(row.stripe?.paymentMethodId);
  const binanceAccount = text(row.binance?.accountId);
  return {
    stripe:
      stripeAccount && stripeMethod
        ? { accountId: stripeAccount, paymentMethodId: stripeMethod }
        : null,
    binance: binanceAccount ? { accountId: binanceAccount } : null,
  };
}

export function mappingChanges(
  before: IntegrationMappingSettings,
  after: IntegrationMappingSettings,
): ActivityChanges | null {
  const flat = (m: IntegrationMappingSettings) => ({
    'stripe.accountId': m.stripe?.accountId ?? null,
    'stripe.paymentMethodId': m.stripe?.paymentMethodId ?? null,
    'binance.accountId': m.binance?.accountId ?? null,
  });
  return diffFields(flat(before), flat(after), {
    fields: ['stripe.accountId', 'stripe.paymentMethodId', 'binance.accountId'],
  });
}

/**
 * Reads the mapping from `Setting`. Exported for `integrations` (DT-110): the webhook and the worker run as
 * `SYSTEM` and read it without `can()`; the HTTP read goes through `GetIntegrationMapping`.
 */
export class IntegrationMappingQuery {
  constructor(private readonly settings: SettingRepository) {}

  async read(): Promise<IntegrationMappingSettings> {
    const stored = await this.settings.find(INTEGRATION_MAPPING_KEY);
    return mappingFromStored(stored?.value);
  }
}
