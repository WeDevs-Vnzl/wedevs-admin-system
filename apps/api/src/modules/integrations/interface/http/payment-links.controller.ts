import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { CreateInvoicePaymentLink } from '../../application/use-cases/payment-links/create-invoice-payment-link.use-case';
import { DeactivateInvoicePaymentLink } from '../../application/use-cases/payment-links/deactivate-invoice-payment-link.use-case';
import { ListInvoicePaymentLinks } from '../../application/use-cases/payment-links/list-invoice-payment-links.use-case';
import { assertStripeEnabled, STRIPE_ENABLED } from './payment-links.availability';
import {
  CreatePaymentLinkDto,
  InvoiceIdParamsDto,
  InvoicePaymentLinksResponseDto,
  PaymentLinkParamsDto,
  PaymentLinkResponseDto,
  toPaymentLinkResponse,
  toPaymentLinksResponse,
} from './payment-links.dto';

/**
 * Stripe payment links of an invoice (choice 1, DT-182, DT-196). `payment` `create` creates and deactivates,
 * `payment` `read` lists (A4); the use cases run `can()` again (C13). Off (404 `NOT_FOUND`) when Stripe is not
 * configured (choice 3).
 */
@ApiTags('payment-links')
@Controller('invoices/:id/payment-links')
export class PaymentLinksController {
  constructor(
    private readonly listLinks: ListInvoicePaymentLinks,
    private readonly createLink: CreateInvoicePaymentLink,
    private readonly deactivateLink: DeactivateInvoicePaymentLink,
    @Inject(STRIPE_ENABLED) private readonly enabled: boolean,
  ) {}

  @Get()
  @RequiresGrant('payment', 'read')
  @ApiOperation({
    operationId: 'listInvoicePaymentLinks',
    summary: 'Every payment link of the invoice, newest first, with the capacity of a new one',
  })
  @ApiOkResponse({ type: InvoicePaymentLinksResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: InvoiceIdParamsDto,
  ): Promise<InvoicePaymentLinksResponseDto> {
    assertStripeEnabled(this.enabled);
    return toPaymentLinksResponse(await this.listLinks.execute(user, params.id));
  }

  @Post()
  @RequiresGrant('payment', 'create')
  @ApiOperation({
    operationId: 'createInvoicePaymentLink',
    summary:
      'Create a Stripe payment link for part or all of what remains to collect (idempotent by requestId)',
  })
  @ApiBody({ type: CreatePaymentLinkDto })
  @ApiCreatedResponse({ type: PaymentLinkResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: InvoiceIdParamsDto,
    @Body() body: CreatePaymentLinkDto,
  ): Promise<PaymentLinkResponseDto> {
    assertStripeEnabled(this.enabled);
    return toPaymentLinkResponse(
      await this.createLink.execute(user, {
        invoiceId: params.id,
        amount: body.amount,
        requestId: body.requestId,
      }),
    );
  }

  @Post(':linkId/deactivate')
  @HttpCode(200)
  @RequiresGrant('payment', 'create')
  @ApiOperation({
    operationId: 'deactivateInvoicePaymentLink',
    summary: 'Deactivate an open payment link (idempotent)',
  })
  @ApiOkResponse({ type: PaymentLinkResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async deactivate(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: PaymentLinkParamsDto,
  ): Promise<PaymentLinkResponseDto> {
    assertStripeEnabled(this.enabled);
    return toPaymentLinkResponse(
      await this.deactivateLink.execute(user, { invoiceId: params.id, linkId: params.linkId }),
    );
  }
}
