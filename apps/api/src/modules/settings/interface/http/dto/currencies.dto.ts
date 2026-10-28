import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `GET /currencies?includeInactive=` (the FE `currencyListInputSchema`): active rows by default. */
export const includeInactiveQuerySchema = z.object({
  includeInactive: z.union([z.boolean(), z.stringbool()]).default(false),
});

export class IncludeInactiveQueryDto extends createZodDto(includeInactiveQuerySchema) {}

/** Body of `POST /api/v1/currencies`: the code is the key. Shape only; the bounds are the domain's. */
export const createCurrencySchema = z.object({
  code: z.string(),
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().optional(),
  active: z.boolean().optional(),
});

export class CreateCurrencyDto extends createZodDto(createCurrencySchema) {}

/** Body of `PATCH /api/v1/currencies/{code}`: every editable field; an omitted one takes its default. */
export const updateCurrencySchema = createCurrencySchema.omit({ code: true });

export class UpdateCurrencyDto extends createZodDto(updateCurrencySchema) {}

export const currencyResponseSchema = z.object({
  code: z.string(),
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int(),
  active: z.boolean(),
});

export class CurrencyResponseDto extends createZodDto(currencyResponseSchema) {}
