import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const clerkWebhookResponseSchema = z.object({
  received: z.literal(true),
  outcome: z.enum([
    'created',
    'updated',
    'deleted',
    'unchanged',
    'recorded',
    'duplicate',
    'ignored',
  ]),
});
export class ClerkWebhookResponseDto extends createZodDto(clerkWebhookResponseSchema) {}
