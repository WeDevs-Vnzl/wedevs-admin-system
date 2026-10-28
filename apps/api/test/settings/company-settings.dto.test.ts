import { describe, expect, it } from 'vitest';
import { COMPANY_FIELD_LIMITS } from '../../src/modules/settings/domain/company-settings';
import { updateCompanySettingsSchema } from '../../src/modules/settings/interface/http/dto/company-settings.dto';

/** Pins the DTO length bounds to the domain limits (the DTO repeats them for the OpenAPI document). */
describe('company settings DTO bounds', () => {
  const over = (max: number) => 'x'.repeat(max + 1);
  const at = (max: number) => 'x'.repeat(max);

  it('accepts each text field at its domain limit and refuses one character more', () => {
    const at120 = updateCompanySettingsSchema.safeParse({ name: at(COMPANY_FIELD_LIMITS.name) });
    expect(at120.success).toBe(true);
    const over120 = updateCompanySettingsSchema.safeParse({
      name: over(COMPANY_FIELD_LIMITS.name),
    });
    expect(over120.success).toBe(false);

    for (const field of ['legalName', 'taxId', 'address'] as const) {
      const max = COMPANY_FIELD_LIMITS[field];
      expect(updateCompanySettingsSchema.safeParse({ name: 'A', [field]: at(max) }).success).toBe(
        true,
      );
      expect(updateCompanySettingsSchema.safeParse({ name: 'A', [field]: over(max) }).success).toBe(
        false,
      );
    }
  });

  it('accepts a logo id of up to 64 characters and refuses 65', () => {
    expect(updateCompanySettingsSchema.safeParse({ name: 'A', logoFileId: at(64) }).success).toBe(
      true,
    );
    expect(updateCompanySettingsSchema.safeParse({ name: 'A', logoFileId: over(64) }).success).toBe(
      false,
    );
  });

  it('treats omitted and null optionals alike and requires the name', () => {
    expect(updateCompanySettingsSchema.safeParse({ name: 'A', legalName: null }).success).toBe(
      true,
    );
    expect(updateCompanySettingsSchema.safeParse({ legalName: 'B' }).success).toBe(false);
  });
});
