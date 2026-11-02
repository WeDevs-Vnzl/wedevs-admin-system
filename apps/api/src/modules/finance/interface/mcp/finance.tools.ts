import type { Type } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import type { CurrentUser } from '../../../../shared/application/current-user';
import { idSchema } from '../../../../shared/interface/common.schemas';
import type { McpToolDefinition } from '../../../../shared/interface/mcp-tool-registry';
import { ListOpenInvoices } from '../../application/use-cases/invoices/invoice-wizard-reads.use-case';
import {
  GetInvoice,
  ListInvoices,
} from '../../application/use-cases/invoices/list-invoices.use-case';
import {
  GetPayment,
  ListPayments,
} from '../../application/use-cases/payments/payment-reads.use-case';
import {
  InvoiceIdParamsDto,
  ListInvoicesQueryDto,
  toInvoiceResponse,
  toInvoiceRowResponse,
  toOpenInvoiceResponse,
} from '../http/dto/invoices.dto';
import {
  ListPaymentsQueryDto,
  PaymentIdParamsDto,
  toPaymentResponse,
  toPaymentRowResponse,
} from '../http/dto/payments.dto';

/** Resolves an application use case of the booted app (the feature modules do not export them). */
export type ResolveUseCase = <T>(token: Type<T>) => T;

interface ToolSpec<S extends ZodType> {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  /** The grant of the tool's HTTP route (DT-195). */
  readonly grant: McpToolDefinition['grant'];
  readonly run: (actor: CurrentUser, input: z.output<S>) => Promise<unknown>;
}

/** The server validates `input` before the handler runs, so the cast only restores the parsed type. */
function tool<S extends ZodType>(spec: ToolSpec<S>): McpToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    grant: spec.grant,
    handler: (actor, input) => spec.run(actor, input as z.output<S>),
  };
}

/**
 * MCP tools of the `finance` context (DT-188): reads only. Money never moves over MCP; each tool calls the
 * use case of its HTTP route (Owner and Admin only, PRD §4.3) and answers that route's body.
 */
export function financeTools(resolve: ResolveUseCase): McpToolDefinition[] {
  return [
    tool({
      name: 'list_invoices',
      description: 'List invoices (paged).',
      input: ListInvoicesQueryDto.schema,
      grant: { resource: 'invoice', action: 'read' },
      run: async (actor, input) => {
        const page = await resolve(ListInvoices).execute(actor, input);
        return { ...page, items: page.items.map(toInvoiceRowResponse) };
      },
    }),
    tool({
      name: 'get_invoice',
      description: 'One invoice with its lines, allocations and amounts.',
      input: InvoiceIdParamsDto.schema,
      grant: { resource: 'invoice', action: 'read' },
      run: async (actor, input) =>
        toInvoiceResponse(await resolve(GetInvoice).execute(actor, input.id)),
    }),
    tool({
      name: 'list_open_invoices',
      description: 'Open invoices of a client (what a payment can still be allocated to).',
      input: z.object({ clientId: idSchema }),
      grant: { resource: 'invoice', action: 'read' },
      run: async (actor, input) =>
        (await resolve(ListOpenInvoices).execute(actor, input.clientId)).map(toOpenInvoiceResponse),
    }),
    tool({
      name: 'list_payments',
      description: 'List payments (paged).',
      input: ListPaymentsQueryDto.schema,
      grant: { resource: 'payment', action: 'read' },
      run: async (actor, input) => {
        const page = await resolve(ListPayments).execute(actor, input);
        return { ...page, items: page.items.map(toPaymentRowResponse) };
      },
    }),
    tool({
      name: 'get_payment',
      description: 'One payment with its allocations.',
      input: PaymentIdParamsDto.schema,
      grant: { resource: 'payment', action: 'read' },
      run: async (actor, input) =>
        toPaymentResponse(await resolve(GetPayment).execute(actor, input.id)),
    }),
  ];
}
