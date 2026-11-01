/**
 * Client tax id rules (PRD §8.2, HU-03). Ported from `normalizeVeRif` / `isValidTaxIdFor` of
 * `fe/src/lib/validators/clients.ts` and `taxIdKey` / `storedTaxId` of `fe/src/mocks/services/clients.ts`.
 * Pure: no Zod, no framework.
 */

/** Venezuelan RIF: type letter, 8 digits and a check digit; dashes optional (`J-12345678-9`, `J123456789`). */
const VE_RIF_PATTERN = /^[VEJGP]-?\d{8}-?\d$/i;

export function isValidVeRif(value: string): boolean {
  return VE_RIF_PATTERN.test(value.trim());
}

/** Canonical RIF form `J-12345678-9`; the input is returned trimmed when it is not a RIF. */
export function normalizeVeRif(value: string): string {
  const trimmed = value.trim();
  if (!isValidVeRif(trimmed)) return trimmed;
  const compact = trimmed.replaceAll('-', '').toUpperCase();
  return `${compact.slice(0, 1)}-${compact.slice(1, 9)}-${compact.slice(9)}`;
}

/** An RIF for `VE`, free text (NIT, Tax ID, EIN...) for any other country. */
export function isValidTaxIdFor(country: string, taxId: string): boolean {
  return country === 'VE' ? isValidVeRif(taxId) : taxId.trim().length > 0;
}

/** Tax ids compare without case, spaces, dots or dashes: `j-30123456-7` equals `J301234567`. */
export function taxIdKey(taxId: string): string {
  return taxId.replace(/[\s.-]/g, '').toUpperCase();
}

/** The form's tax id as stored: the canonical RIF for Venezuela, trimmed text elsewhere. */
export function storedTaxId(taxId: string, country: string): string {
  return country === 'VE' ? normalizeVeRif(taxId) : taxId.trim();
}
