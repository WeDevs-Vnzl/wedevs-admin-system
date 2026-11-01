import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ALERT_TYPE_VALUES } from '../../application/use-cases/alerts/alert-support';
import { USER_ROLE_VALUES } from '../../../../shared/domain/enums';
import { dateOnlySchema, decimalStringSchema } from '../../../../shared/interface/common.schemas';

export const shellResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.enum(USER_ROLE_VALUES),
  }),
  /** The VES chip: today's rate or the latest earlier one; `null` when there is none at all. */
  vesRate: z
    .object({
      date: dateOnlySchema,
      usdRate: decimalStringSchema,
      source: z.string().nullable(),
    })
    .nullable(),
  /** A business day without a VES rate (or no rate at all). */
  vesRateMissing: z.boolean(),
  /** The caller's own bell counters (DT-79). */
  alerts: z.object({
    total: z.number().int().nonnegative(),
    unread: z.number().int().nonnegative(),
    byType: z.partialRecord(z.enum(ALERT_TYPE_VALUES), z.number().int().positive()),
  }),
});
export class ShellResponseDto extends createZodDto(shellResponseSchema) {}
