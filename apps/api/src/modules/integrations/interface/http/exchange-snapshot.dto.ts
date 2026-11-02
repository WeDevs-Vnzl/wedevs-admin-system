import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  decimalStringSchema,
  idSchema,
  timestampSchema,
} from '../../../../shared/interface/common.schemas';

/** An exchange amount stays the decimal string the exchange sent (C15). */
const exchangeAmountSchema = z.string().regex(/^\d+(\.\d+)?$/);

const exchangeSnapshotResponseSchema = z.object({
  accountId: idSchema,
  /** `null` until the first poll ran. */
  snapshot: z
    .object({
      syncedAt: timestampSchema,
      balances: z.array(
        z.object({
          asset: z.string(),
          free: exchangeAmountSchema,
          locked: exchangeAmountSchema,
        }),
      ),
    })
    .nullable(),
  systemBalance: z.object({
    currency: z.string(),
    balance: decimalStringSchema,
    balanceUsd: decimalStringSchema.nullable(),
  }),
});

export class ExchangeSnapshotAccountParamsDto extends createZodDto(z.object({ id: idSchema })) {}
export class ExchangeSnapshotResponseDto extends createZodDto(exchangeSnapshotResponseSchema) {}
