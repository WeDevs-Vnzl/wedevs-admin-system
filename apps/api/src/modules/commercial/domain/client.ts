import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import {
  CLIENT_KIND_VALUES,
  type ClientKind,
  type ClientStatus,
} from '../../../shared/domain/enums';
import {
  FIELD_KEYS,
  isE164Phone,
  optionalEmail,
  optionalHttpUrl,
  optionalText,
  requiredText,
  tagIdList,
  type TagChipView,
} from './client-fields';
import type { ContactView } from './contact';
import { isValidTaxIdFor, storedTaxId } from './tax-id';

/**
 * Clients (PRD §8.2, HU-03). Ported from `fe/src/lib/validators/clients.ts` and
 * `fe/src/mocks/services/clients.ts`. Pure: no Zod, no framework, no clock. Rules carried here: legal name
 * only required for companies (CA1), the stored tax id (canonical RIF for `VE`), the activity diff and the
 * search projection. The tax id uniqueness, the code sequence and the archive lock need the database and
 * live in the use cases.
 */

/** Officially assigned ISO 3166-1 alpha-2 codes (249). */
// prettier-ignore
export const COUNTRY_CODE_VALUES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
] as const;
export type CountryCode = (typeof COUNTRY_CODE_VALUES)[number];

export function isCountryCode(value: string): value is CountryCode {
  return (COUNTRY_CODE_VALUES as readonly string[]).includes(value);
}

/** Maximum lengths, counted on the trimmed value (FE `requiredText` / `optionalText`). */
export const CLIENT_LIMITS = {
  tradeName: 120,
  legalName: 160,
  taxId: 40,
  address: 500,
} as const;

/** i18n keys the mock throws, reused verbatim so FE-INT needs no new message. */
export const CLIENT_DUPLICATE_TAX_ID_KEY = 'clients.errors.duplicateTaxId';
export const CLIENT_RESTORE_TAX_ID_CONFLICT_KEY = 'clients.errors.restoreTaxIdConflict';
export const CLIENT_ARCHIVE_NEEDS_CONFIRM_KEY = 'clients.errors.archiveNeedsConfirm';
/** `CONFLICT` message of a restore through the trash whose tax id a live client now holds. */
export const TRASH_TAX_ID_TAKEN_KEY = 'trash.errors.taxIdTaken';

/** Project statuses that still count as work in progress for the archive lock (PRD §7.7). */
export const ACTIVE_PROJECT_STATUSES = [
  'PROPUESTA',
  'EN_CURSO',
  'PAUSADO',
  'MANTENIMIENTO',
] as const;

/** Fields compared for the `UPDATE` activity entry, in the order they are recorded (the mock's `CLIENT_DIFF_FIELDS`). */
export const CLIENT_DIFF_FIELDS = [
  'kind',
  'tradeName',
  'legalName',
  'taxId',
  'country',
  'address',
  'phone',
  'email',
  'website',
  'tagIds',
] as const;
/** Long texts record only that they changed (C20). */
export const CLIENT_LONG_TEXT_FIELDS = ['address'] as const;

/** Sort keys of the list (the whitelist of the query schema). */
export const CLIENT_SORT_FIELDS = [
  'code',
  'tradeName',
  'kind',
  'country',
  'status',
  'projectCount',
  'totalInvoicedUsd',
  'receivableUsd',
  'lastActivityAt',
  'createdAt',
] as const;
/** Sort keys that expose money: only for callers who may see financials (C13). */
export const CLIENT_MONEY_SORT_FIELDS: readonly string[] = ['totalInvoicedUsd', 'receivableUsd'];

/** Stored values of a client, already normalized. */
export type ClientValues = {
  readonly kind: ClientKind;
  readonly tradeName: string;
  readonly legalName: string;
  readonly taxId: string;
  readonly country: string;
  readonly address: string;
  readonly phone: string;
  readonly email: string | null;
  readonly website: string | null;
};

export type ClientRecord = ClientValues & {
  readonly id: string;
  readonly code: string;
  readonly status: ClientStatus;
  readonly activatedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
};

/** What a caller sends to create or replace a client. */
export type ClientInput = {
  readonly kind: ClientKind;
  readonly tradeName: string;
  readonly legalName?: string | null;
  readonly taxId: string;
  readonly country: string;
  readonly address: string;
  readonly phone: string;
  readonly email?: string | null;
  readonly website?: string | null;
  readonly tagIds?: readonly string[];
};

export type NormalizedClient = {
  readonly values: ClientValues;
  readonly tagIds: string[];
};

/**
 * Validates and normalizes a client form. Every failing field is reported together in `fieldErrors`
 * (`VALIDATION`, 422); nothing is partially accepted. The legal name is required for `EMPRESA` and
 * defaults to the trade name for `PERSONA`; the tax id is stored as the canonical RIF for `VE`.
 */
export function normalizeClient(input: ClientInput): NormalizedClient {
  const errors: FieldErrors = {};

  if (!(CLIENT_KIND_VALUES as readonly string[]).includes(input.kind)) {
    errors.kind = [FIELD_KEYS.invalidOption];
  }
  const tradeName = requiredText(errors, 'tradeName', input.tradeName, CLIENT_LIMITS.tradeName);
  const legalNameText = optionalText(errors, 'legalName', input.legalName, CLIENT_LIMITS.legalName);
  if (input.kind === 'EMPRESA' && legalNameText === null && !errors.legalName) {
    errors.legalName = [FIELD_KEYS.required];
  }

  const taxIdText = requiredText(errors, 'taxId', input.taxId, CLIENT_LIMITS.taxId);
  if (!errors.taxId && !isValidTaxIdFor(input.country, taxIdText)) {
    errors.taxId = [FIELD_KEYS.invalidFormat];
  }
  if (!isCountryCode(input.country)) errors.country = [FIELD_KEYS.invalidOption];

  const address = requiredText(errors, 'address', input.address, CLIENT_LIMITS.address);
  const phone = input.phone.trim();
  if (phone.length === 0) errors.phone = [FIELD_KEYS.required];
  else if (!isE164Phone(phone)) errors.phone = [FIELD_KEYS.invalidFormat];
  const email = optionalEmail(errors, 'email', input.email);
  const website = optionalHttpUrl(errors, 'website', input.website);
  const tagIds = tagIdList(errors, 'tagIds', input.tagIds);

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  return {
    values: {
      kind: input.kind,
      tradeName,
      legalName: legalNameText ?? tradeName,
      taxId: storedTaxId(taxIdText, input.country),
      country: input.country,
      address,
      phone,
      email,
      website,
    },
    tagIds,
  };
}

/**
 * The `UPDATE` change set: the form fields plus the tag names as one readable string, `address` as
 * "changed" (C20). `null` when nothing changed, so nothing is logged.
 */
export function clientChanges(
  before: ClientValues,
  after: ClientValues,
  tagNames: { readonly before: string; readonly after: string },
): ActivityChanges | null {
  return diffFields(
    { ...before, tagIds: tagNames.before },
    { ...after, tagIds: tagNames.after },
    { fields: CLIENT_DIFF_FIELDS, longText: CLIENT_LONG_TEXT_FIELDS },
  );
}

export function toClientRef(record: Pick<ClientRecord, 'id' | 'code' | 'tradeName'>): EntityRef {
  return { type: 'CLIENT', id: record.id, code: record.code, label: record.tradeName };
}

/** The `SearchEntry` projection of a client: code, trade name, legal name, tax id and e-mail, and status (X5). */
export function clientSearchEntry(record: ClientRecord) {
  return {
    entityType: 'CLIENT' as const,
    entityId: record.id,
    code: record.code,
    title: record.tradeName,
    subtitle: record.legalName,
    body: [record.taxId, record.email].filter((part) => part !== null).join(' '),
    status: record.status,
    archived: record.deletedAt !== null,
  };
}

/** A client with its live contacts (primary first) and tags: the detail read model. No financials (Q-BE2-4). */
export type ClientDetailView = {
  readonly client: ClientRecord;
  readonly tags: TagChipView[];
  readonly contacts: ContactView[];
};

/** One row of the list; money fields are `null` without `canSeeFinancials` (C13). */
export type ClientListRow = {
  readonly client: ClientRecord;
  readonly projectCount: number;
  readonly lastActivityAt: Date | null;
  readonly totalInvoicedUsd: string | null;
  readonly receivableUsd: string | null;
  readonly tags: TagChipView[];
};
