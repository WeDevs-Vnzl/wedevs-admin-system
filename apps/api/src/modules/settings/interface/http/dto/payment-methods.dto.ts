import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Body of `POST /api/v1/payment-methods`: shape only; the code, name and flag rules are the domain's. */
export const createPaymentMethodSchema = z.object({
  code: z.string(),
  name: z.string(),
  nameEn: z.string().nullish(),
  requiresReference: z.boolean().optional(),
  suggestsIgtf: z.boolean().optional(),
  active: z.boolean().optional(),
});

export class CreatePaymentMethodDto extends createZodDto(createPaymentMethodSchema) {}

/** Body of `PATCH /api/v1/payment-methods/{id}`: every editable field; the code never changes. */
export const updatePaymentMethodSchema = createPaymentMethodSchema.omit({ code: true });

export class UpdatePaymentMethodDto extends createZodDto(updatePaymentMethodSchema) {}

export const paymentMethodResponseSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  requiresReference: z.boolean(),
  suggestsIgtf: z.boolean(),
  active: z.boolean(),
});

export class PaymentMethodResponseDto extends createZodDto(paymentMethodResponseSchema) {}
