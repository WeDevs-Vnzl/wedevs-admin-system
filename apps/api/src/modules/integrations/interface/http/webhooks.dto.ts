import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Same shape as the Clerk webhook answer; `outcome` is what became of the event. */
export class StripeWebhookResponseDto extends createZodDto(
  z.object({
    received: z.literal(true),
    outcome: z.enum(['processed', 'duplicate', 'ignored', 'parked']),
  }),
) {}
