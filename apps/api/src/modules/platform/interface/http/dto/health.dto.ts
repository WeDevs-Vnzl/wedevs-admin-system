import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { timestampSchema } from '../../../../../shared/interface/common.schemas';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('up'),
  time: timestampSchema,
});

export class HealthResponseDto extends createZodDto(healthResponseSchema) {}
