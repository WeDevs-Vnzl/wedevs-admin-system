import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const tableColumnsSchema = z.object({
  order: z.array(z.string()),
  visibility: z.record(z.string(), z.boolean()),
  widths: z.record(z.string(), z.number().int()),
});

export const userPreferencesSchema = z.object({
  locale: z.enum(['es', 'en']),
  theme: z.enum(['light', 'dark', 'system']),
  timezone: z.string(),
  tableColumns: z.record(z.string(), tableColumnsSchema),
});
export class UserPreferencesDto extends createZodDto(userPreferencesSchema) {}

/**
 * Body of `PUT /me/preferences/{key}`. The shape of `value` depends on the key and is validated by the use
 * case against the key's rules (locale, theme, timezone or a table column layout).
 */
export const setPreferenceSchema = z.object({ value: z.unknown() });
export class SetPreferenceDto extends createZodDto(setPreferenceSchema) {}
