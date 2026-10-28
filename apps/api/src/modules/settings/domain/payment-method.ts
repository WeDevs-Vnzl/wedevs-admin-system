import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import {
  ConflictError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../shared/domain/domain-error';

/**
 * Payment method catalog (PRD §8.15, §10.2 `PaymentMethod`). Ported from the payment-method part of
 * `fe/src/lib/validators/catalogs.ts` and `fe/src/mocks/services/catalogs.ts`. Pure: no framework, no clock.
 * A method in use is retired by deactivating it (C19); its stable `code` never changes.
 */

/** Stable machine code (`ZELLE`, `PAGO_MOVIL`): upper snake case, 2 to 40 characters. */
export const PAYMENT_METHOD_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;

export const PAYMENT_METHOD_LIMITS = { name: 120, nameEn: 120 } as const;

/** Fields compared for the `SETTINGS_CHANGE` activity of an update. */
export const PAYMENT_METHOD_CHANGE_FIELDS = [
  'name',
  'nameEn',
  'requiresReference',
  'suggestsIgtf',
  'active',
] as const;

/** i18n keys of the payment method rules (namespace `catalogs`; shape errors in `validation`). */
export const PAYMENT_METHOD_MESSAGES = {
  codeTaken: 'catalogs.paymentMethods.errors.codeTaken',
  nameTaken: 'catalogs.paymentMethods.errors.nameTaken',
  invalidCode: 'catalogs.validation.invalidCode',
  required: 'validation.required',
  tooLong: 'validation.tooLong',
} as const;

export type PaymentMethod = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly requiresReference: boolean;
  readonly suggestsIgtf: boolean;
  readonly active: boolean;
};

/** The editable part of a payment method (everything but the id and the code). */
export type PaymentMethodFields = {
  readonly name: string;
  readonly nameEn: string | null;
  readonly requiresReference: boolean;
  readonly suggestsIgtf: boolean;
  readonly active: boolean;
};

/** What a caller sends. Defaults: requiresReference true, suggestsIgtf false, active true. */
export type PaymentMethodFieldsInput = {
  readonly name: string;
  readonly nameEn?: string | null | undefined;
  readonly requiresReference?: boolean | undefined;
  readonly suggestsIgtf?: boolean | undefined;
  readonly active?: boolean | undefined;
};

/** Trims a required text; records the field error and returns the trimmed text either way. */
function requiredText(value: string, max: number, field: string, errors: FieldErrors): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) (errors[field] ??= []).push(PAYMENT_METHOD_MESSAGES.required);
  else if (trimmed.length > max) (errors[field] ??= []).push(PAYMENT_METHOD_MESSAGES.tooLong);
  return trimmed;
}

/** A code of the wrong shape is a validation error on create. */
export function assertPaymentMethodCode(code: string): void {
  if (!PAYMENT_METHOD_CODE_PATTERN.test(code)) {
    throw new ValidationFailedError({
      fieldErrors: { code: [PAYMENT_METHOD_MESSAGES.invalidCode] },
    });
  }
}

/** Validates and normalizes the editable fields; blank English names become `null`. */
export function normalizePaymentMethodFields(input: PaymentMethodFieldsInput): PaymentMethodFields {
  const errors: FieldErrors = {};
  const name = requiredText(input.name, PAYMENT_METHOD_LIMITS.name, 'name', errors);

  const rawNameEn = (input.nameEn ?? '').trim();
  let nameEn: string | null = null;
  if (rawNameEn.length > PAYMENT_METHOD_LIMITS.nameEn) {
    errors.nameEn = [PAYMENT_METHOD_MESSAGES.tooLong];
  } else if (rawNameEn.length > 0) {
    nameEn = rawNameEn;
  }

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  return {
    name,
    nameEn,
    requiresReference: input.requiresReference ?? true,
    suggestsIgtf: input.suggestsIgtf ?? false,
    active: input.active ?? true,
  };
}

/** Case-insensitive text equality of two names. */
const sameText = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Refuses a code or a name that another method already has (`CONFLICT`, one field error per clash). `exceptId`
 * is the method being updated, which may keep its own name.
 */
export function assertUniquePaymentMethod(
  rows: readonly PaymentMethod[],
  probe: { readonly code?: string | undefined; readonly name: string },
  exceptId?: string,
): void {
  const others = rows.filter((row) => row.id !== exceptId);
  const fieldErrors: FieldErrors = {};
  if (probe.code !== undefined && others.some((row) => row.code === probe.code)) {
    fieldErrors.code = [PAYMENT_METHOD_MESSAGES.codeTaken];
  }
  if (others.some((row) => sameText(row.name, probe.name))) {
    fieldErrors.name = [PAYMENT_METHOD_MESSAGES.nameTaken];
  }
  if (Object.keys(fieldErrors).length > 0) throw new ConflictError({ fieldErrors });
}

/** Stable order for pickers and Settings: by name, locale-aware (the catalog has no stored sort column). */
export function sortPaymentMethods(rows: readonly PaymentMethod[]): PaymentMethod[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

/** The `SETTINGS_CHANGE` change set of an update, or `null` when nothing changed. */
export function paymentMethodChanges(
  before: PaymentMethod,
  after: PaymentMethodFields,
): ActivityChanges | null {
  return diffFields(before, after, { fields: PAYMENT_METHOD_CHANGE_FIELDS });
}

/** The `SETTINGS_CHANGE` change set of a creation: the code, from nothing. */
export function paymentMethodCreationChanges(code: string): ActivityChanges {
  return { paymentMethod: [null, code] };
}
