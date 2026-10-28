import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Body of `PATCH /api/v1/settings/fiscal` (the FE `updateFiscalSettingsInputSchema`): the whole set of parameters.
 * An omitted field takes its default (DT-44, DT-70), as the FE schema does. Rates and amounts are decimal strings.
 */
export const updateFiscalSettingsSchema = z.object({
  ivaRates: z.array(z.string()).optional(),
  ivaDefaultRate: z.string().optional(),
  igtfRate: z.string().optional(),
  igtfCurrencies: z.array(z.string()).optional(),
  invoiceDefaultDueDays: z.number().int().optional(),
});

export class UpdateFiscalSettingsDto extends createZodDto(updateFiscalSettingsSchema) {}

export const fiscalSettingsResponseSchema = z.object({
  ivaRates: z.array(z.string()),
  ivaDefaultRate: z.string(),
  igtfRate: z.string(),
  igtfCurrencies: z.array(z.string()),
  invoiceDefaultDueDays: z.number().int(),
});

export class FiscalSettingsResponseDto extends createZodDto(fiscalSettingsResponseSchema) {}
