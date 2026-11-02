import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  decimalStringSchema,
  idSchema,
  moneyAmountSchema,
  timestampSchema,
} from '../../../../shared/interface/common.schemas';
import type { InvoicePaymentLinksOutput } from '../../application/use-cases/payment-links/list-invoice-payment-links.use-case';
import type { PaymentLinkOutput } from '../../application/use-cases/payment-links/payment-link-support';

export class InvoiceIdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
export class PaymentLinkParamsDto extends createZodDto(
  z.object({ id: idSchema, linkId: idSchema }),
) {}

/**
 * `POST /invoices/{id}/payment-links` (choice 1): the amount is a decimal string in the invoice currency; the
 * `requestId` is the UUID the caller generates per click (the use case checks its shape and answers
 * `validation.uuid.invalid`). Capacity, minimum and currency live in the use case (DT-196, DT-197).
 */
export class CreatePaymentLinkDto extends createZodDto(
  z.object({
    amount: moneyAmountSchema({ sign: 'positive' }),
    requestId: z.string().meta({ format: 'uuid' }),
  }),
) {}

const LINK_STATUSES = [
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'SETTLED',
  'DEACTIVATED',
] as const satisfies readonly PaymentLinkOutput['status'][];

const nullableTimestamp = timestampSchema.nullable();

export const paymentLinkResponseSchema = z.object({
  id: idSchema,
  invoiceId: idSchema,
  requestId: z.string(),
  amount: decimalStringSchema,
  currency: z.string(),
  status: z.enum(LINK_STATUSES),
  url: z.string().nullable(),
  externalId: z.string().nullable(),
  paymentId: z.string().nullable(),
  deactivationReason: z.string().nullable(),
  createdAt: timestampSchema,
  deactivatedAt: nullableTimestamp,
  settledAt: nullableTimestamp,
});
export class PaymentLinkResponseDto extends createZodDto(paymentLinkResponseSchema) {}

export class InvoicePaymentLinksResponseDto extends createZodDto(
  z.object({
    links: z.array(paymentLinkResponseSchema),
    /** What a new link may still carry; zero when the invoice cannot carry links. */
    capacity: decimalStringSchema,
  }),
) {}

export const toPaymentLinkResponse = (link: PaymentLinkOutput): PaymentLinkResponseDto => ({
  ...link,
});

export const toPaymentLinksResponse = (
  output: InvoicePaymentLinksOutput,
): InvoicePaymentLinksResponseDto => ({
  links: output.links.map(toPaymentLinkResponse),
  capacity: output.capacity,
});
