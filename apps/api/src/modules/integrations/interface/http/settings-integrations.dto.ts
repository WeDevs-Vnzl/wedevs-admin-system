import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { IntegrationMappingSettings } from '../../../settings/application/integration-mapping';

const stripeSchema = z.object({ accountId: z.string(), paymentMethodId: z.string() });
const binanceSchema = z.object({ accountId: z.string() });

/**
 * `PUT /settings/integrations`: the whole mapping. A missing or `null` key clears that integration; the ids are
 * resolved by the use case (accounts active, the Binance one a `WALLET_CRIPTO`, the method active; C14).
 */
export class UpdateIntegrationMappingDto extends createZodDto(
  z.object({
    stripe: stripeSchema.nullish(),
    binance: binanceSchema.nullish(),
  }),
) {}

export class IntegrationMappingResponseDto extends createZodDto(
  z.object({ stripe: stripeSchema.nullable(), binance: binanceSchema.nullable() }),
) {}

export const toMappingResponse = (
  mapping: IntegrationMappingSettings,
): IntegrationMappingResponseDto => ({
  stripe: mapping.stripe ? { ...mapping.stripe } : null,
  binance: mapping.binance ? { ...mapping.binance } : null,
});
