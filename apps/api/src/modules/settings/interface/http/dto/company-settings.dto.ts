import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Request body of `PATCH /api/v1/settings/company` (the FE `UpdateCompanySettingsInput`). Shape and length
 * only; trimming, blank handling and the logo check are business rules of the domain and the use case.
 * The bounds repeat `COMPANY_FIELD_LIMITS` and the id bound of the domain; the DTO test pins them equal.
 */
export const updateCompanySettingsSchema = z.object({
  name: z.string().max(120),
  legalName: z.string().max(160).nullish(),
  taxId: z.string().max(30).nullish(),
  address: z.string().max(300).nullish(),
  logoFileId: z.string().max(64).nullish(),
});

export class UpdateCompanySettingsDto extends createZodDto(updateCompanySettingsSchema) {}

/** Response of the company settings endpoints: every optional field is `null` when absent. */
export const companySettingsResponseSchema = z.object({
  name: z.string(),
  legalName: z.string().nullable(),
  taxId: z.string().nullable(),
  address: z.string().nullable(),
  logoFileId: z.string().nullable(),
});

export class CompanySettingsResponseDto extends createZodDto(companySettingsResponseSchema) {}
