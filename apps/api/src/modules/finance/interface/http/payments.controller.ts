import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import {
  AllocatePayment,
  DeallocatePayment,
} from '../../application/use-cases/payments/allocate-payment.use-case';
import { CreatePayment } from '../../application/use-cases/payments/create-payment.use-case';
import {
  DetectDuplicatePayment,
  GetClientCredit,
  GetInvoiceForPayment,
  GetPayment,
  ListPayments,
} from '../../application/use-cases/payments/payment-reads.use-case';
import { SetPaymentStatus } from '../../application/use-cases/payments/set-payment-status.use-case';
import { UpdatePayment } from '../../application/use-cases/payments/update-payment.use-case';
import {
  AllocatePaymentDto,
  AllocationIdParamsDto,
  ClientCreditResponseDto,
  ClientIdParamsDto,
  CreatePaymentDto,
  DuplicatePaymentQueryDto,
  DuplicatePaymentResponseDto,
  InvoiceIdParamsDto,
  InvoicePaymentContextResponseDto,
  ListPaymentsQueryDto,
  PaymentAllocationResponseDto,
  PaymentIdParamsDto,
  PaymentListResponseDto,
  PaymentResponseDto,
  SetPaymentStatusDto,
  UpdatePaymentDto,
  toAllocationResponse,
  toCreditResponse,
  toDuplicateResponse,
  toPaymentContextResponse,
  toPaymentResponse,
  toPaymentRowResponse,
} from './dto/payments.dto';

/**
 * Payments and allocations (PRD §8.6, HU-13, HU-14). Finance routes are Owner and Admin only: Member and Viewer
 * get `FORBIDDEN` (PRD §4.3). Every handler declares its grant; the use case runs `can()` as the authority (C13).
 * `GET /payments/duplicates` is a warning only, never a refusal (HU-13 CA6). The credit hangs off the client and
 * the payment form's starting point off the invoice.
 */
@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly listPayments: ListPayments,
    private readonly getPayment: GetPayment,
    private readonly createPayment: CreatePayment,
    private readonly updatePayment: UpdatePayment,
    private readonly setStatus: SetPaymentStatus,
    private readonly allocatePayment: AllocatePayment,
    private readonly deallocatePayment: DeallocatePayment,
    private readonly duplicates: DetectDuplicatePayment,
    private readonly credit: GetClientCredit,
    private readonly paymentContext: GetInvoiceForPayment,
  ) {}

  @Get('payments')
  @RequiresGrant('payment', 'read')
  @ApiOperation({ operationId: 'listPayments', summary: 'List payments (filters, search, sort)' })
  @ApiOkResponse({ type: PaymentListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<PaymentListResponseDto> {
    const page = await this.listPayments.execute(user, query);
    return { ...page, items: page.items.map(toPaymentRowResponse) };
  }

  @Post('payments')
  @RequiresGrant('payment', 'create')
  @ApiOperation({
    operationId: 'createPayment',
    summary: 'Register a payment with IGTF, fee and optional allocations (PAG-####)',
  })
  @ApiBody({ type: CreatePaymentDto })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return toPaymentResponse(await this.createPayment.execute(user, body));
  }

  @Get('payments/duplicates')
  @RequiresGrant('payment', 'read')
  @ApiOperation({
    operationId: 'detectDuplicatePayment',
    summary: 'Possible duplicates by reference, method and account (a warning, never a refusal)',
  })
  @ApiOkResponse({ type: DuplicatePaymentResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async detectDuplicates(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: DuplicatePaymentQueryDto,
  ): Promise<DuplicatePaymentResponseDto> {
    return toDuplicateResponse(await this.duplicates.execute(user, query));
  }

  @Get('payments/:id')
  @RequiresGrant('payment', 'read')
  @ApiOperation({ operationId: 'getPayment', summary: 'Payment detail with its allocations' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: PaymentIdParamsDto,
  ): Promise<PaymentResponseDto> {
    return toPaymentResponse(await this.getPayment.execute(user, params.id));
  }

  @Patch('payments/:id')
  @RequiresGrant('payment', 'update')
  @ApiOperation({
    operationId: 'updatePayment',
    summary: 'Edit a payment (client and currency are locked while it has allocations)',
  })
  @ApiBody({ type: UpdatePaymentDto })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: PaymentIdParamsDto,
    @Body() body: UpdatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return toPaymentResponse(await this.updatePayment.execute(user, { ...body, id: params.id }));
  }

  @Post('payments/:id/status')
  @HttpCode(200)
  @RequiresGrant('payment', 'update')
  @ApiOperation({
    operationId: 'setPaymentStatus',
    summary: 'Confirm or void a payment (voiding removes its allocations)',
  })
  @ApiBody({ type: SetPaymentStatusDto })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async status(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: PaymentIdParamsDto,
    @Body() body: SetPaymentStatusDto,
  ): Promise<PaymentResponseDto> {
    return toPaymentResponse(await this.setStatus.execute(user, { ...body, id: params.id }));
  }

  @Post('payments/:id/allocations')
  @RequiresGrant('payment', 'update')
  @ApiOperation({
    operationId: 'allocatePayment',
    summary: 'Apply (part of) a confirmed payment to an open invoice',
  })
  @ApiBody({ type: AllocatePaymentDto })
  @ApiCreatedResponse({ type: PaymentAllocationResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async allocate(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: PaymentIdParamsDto,
    @Body() body: AllocatePaymentDto,
  ): Promise<PaymentAllocationResponseDto> {
    return toAllocationResponse(
      await this.allocatePayment.execute(user, { ...body, paymentId: params.id }),
    );
  }

  @Post('allocations/:id/deallocate')
  @HttpCode(200)
  @RequiresGrant('payment', 'update')
  @ApiOperation({
    operationId: 'deallocatePayment',
    summary: 'Remove an allocation (the amount goes back to the credit of the payment)',
  })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async deallocate(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: AllocationIdParamsDto,
  ): Promise<PaymentResponseDto> {
    return toPaymentResponse(
      await this.deallocatePayment.execute(user, { allocationId: params.id }),
    );
  }

  @Get('clients/:id/credit')
  @RequiresGrant('payment', 'read')
  @ApiOperation({
    operationId: 'getClientCredit',
    summary: 'Saldo a favor of a client: the unapplied remainder of its confirmed payments',
  })
  @ApiOkResponse({ type: ClientCreditResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async clientCredit(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ClientIdParamsDto,
  ): Promise<ClientCreditResponseDto> {
    return toCreditResponse(await this.credit.execute(user, params.id));
  }

  @Get('invoices/:id/payment-context')
  @RequiresGrant('payment', 'read')
  @ApiOperation({
    operationId: 'getInvoiceForPayment',
    summary: 'The client and open option a new payment starts from (404 once it takes no payment)',
  })
  @ApiOkResponse({ type: InvoicePaymentContextResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async invoiceContext(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: InvoiceIdParamsDto,
  ): Promise<InvoicePaymentContextResponseDto> {
    return toPaymentContextResponse(await this.paymentContext.execute(user, params.id));
  }
}
