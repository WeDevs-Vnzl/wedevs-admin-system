import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { ArchiveInvoice } from '../../application/use-cases/invoices/archive-invoice.use-case';
import { AttachInvoiceFile } from '../../application/use-cases/invoices/attach-invoice-file.use-case';
import { CreateInvoice } from '../../application/use-cases/invoices/create-invoice.use-case';
import {
  ListBillableInstallments,
  ListOpenInvoices,
} from '../../application/use-cases/invoices/invoice-wizard-reads.use-case';
import { IssueDraft } from '../../application/use-cases/invoices/issue-draft.use-case';
import {
  GetInvoice,
  ListInvoices,
} from '../../application/use-cases/invoices/list-invoices.use-case';
import { RestoreInvoice } from '../../application/use-cases/invoices/restore-invoice.use-case';
import { UpdateInvoice } from '../../application/use-cases/invoices/update-invoice.use-case';
import { VoidInvoice } from '../../application/use-cases/invoices/void-invoice.use-case';
import {
  AttachInvoiceFileDto,
  BillableInstallmentResponseDto,
  ClientIdParamsDto,
  CreateInvoiceDto,
  InvoiceIdParamsDto,
  InvoiceListResponseDto,
  InvoiceResponseDto,
  ListInvoicesQueryDto,
  OpenInvoiceResponseDto,
  RestoredInvoiceResponseDto,
  UpdateInvoiceDto,
  VoidInvoiceDto,
  toBillableResponse,
  toInvoiceResponse,
  toInvoiceRowResponse,
  toOpenInvoiceResponse,
} from './dto/invoices.dto';

/**
 * Invoices (PRD §8.5, HU-11, HU-12). Finance routes are Owner and Admin only: Member and Viewer get `FORBIDDEN`
 * (PRD §4.3). Every handler declares its grant; the use case runs `can()` as the authority (C13). The billing
 * wizard's reads hang off the client (`/clients/{id}/billable-installments`, `/clients/{id}/open-invoices`).
 */
@ApiTags('invoices')
@Controller()
export class InvoicesController {
  constructor(
    private readonly listInvoices: ListInvoices,
    private readonly getInvoice: GetInvoice,
    private readonly createInvoice: CreateInvoice,
    private readonly updateInvoice: UpdateInvoice,
    private readonly issueDraft: IssueDraft,
    private readonly voidInvoice: VoidInvoice,
    private readonly archiveInvoice: ArchiveInvoice,
    private readonly restoreInvoice: RestoreInvoice,
    private readonly attachFile: AttachInvoiceFile,
    private readonly listBillable: ListBillableInstallments,
    private readonly listOpen: ListOpenInvoices,
  ) {}

  @Get('invoices')
  @RequiresGrant('invoice', 'read')
  @ApiOperation({ operationId: 'listInvoices', summary: 'List invoices (filters, search, sort)' })
  @ApiOkResponse({ type: InvoiceListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListInvoicesQueryDto,
  ): Promise<InvoiceListResponseDto> {
    const page = await this.listInvoices.execute(user, query);
    return { ...page, items: page.items.map(toInvoiceRowResponse) };
  }

  @Post('invoices')
  @RequiresGrant('invoice', 'create')
  @ApiOperation({
    operationId: 'createInvoice',
    summary: 'Register an invoice with lines and per-rate tax lines (FAC-####)',
  })
  @ApiBody({ type: CreateInvoiceDto })
  @ApiCreatedResponse({ type: InvoiceResponseDto })
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
    @Body() body: CreateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    return toInvoiceResponse(await this.createInvoice.execute(user, body));
  }

  @Get('invoices/:id')
  @RequiresGrant('invoice', 'read')
  @ApiOperation({
    operationId: 'getInvoice',
    summary: 'Invoice detail with lines, totals and payments',
  })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: InvoiceIdParamsDto,
  ): Promise<InvoiceResponseDto> {
    return toInvoiceResponse(await this.getInvoice.execute(user, params.id));
  }

  @Patch('invoices/:id')
  @RequiresGrant('invoice', 'update')
  @ApiOperation({
    operationId: 'updateInvoice',
    summary: 'Edit an invoice (the whole invoice again)',
  })
  @ApiBody({ type: UpdateInvoiceDto })
  @ApiOkResponse({ type: InvoiceResponseDto })
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
    @Param() params: InvoiceIdParamsDto,
    @Body() body: UpdateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    return toInvoiceResponse(await this.updateInvoice.execute(user, { ...body, id: params.id }));
  }

  @Post('invoices/:id/issue')
  @HttpCode(200)
  @RequiresGrant('invoice', 'update')
  @ApiOperation({ operationId: 'issueInvoice', summary: 'Issue a draft invoice' })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INTERNAL')
  async issue(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: InvoiceIdParamsDto,
  ): Promise<InvoiceResponseDto> {
    return toInvoiceResponse(await this.issueDraft.execute(user, { id: params.id }));
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  @RequiresGrant('invoice', 'update')
  @ApiOperation({ operationId: 'voidInvoice', summary: 'Void an invoice with a reason' })
  @ApiBody({ type: VoidInvoiceDto })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async void(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: InvoiceIdParamsDto,
    @Body() body: VoidInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    return toInvoiceResponse(await this.voidInvoice.execute(user, { ...body, id: params.id }));
  }

  @Post('invoices/:id/archive')
  @HttpCode(200)
  @RequiresGrant('invoice', 'delete')
  @ApiOperation({ operationId: 'archiveInvoice', summary: 'Archive an invoice (frees its number)' })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async archive(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: InvoiceIdParamsDto,
  ): Promise<InvoiceResponseDto> {
    return toInvoiceResponse(await this.archiveInvoice.execute(user, { id: params.id }));
  }

  @Post('invoices/:id/restore')
  @HttpCode(200)
  @RequiresGrant('invoice', 'restore')
  @ApiOperation({ operationId: 'restoreInvoice', summary: 'Restore an archived invoice' })
  @ApiOkResponse({ type: RestoredInvoiceResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INTERNAL')
  async restore(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: InvoiceIdParamsDto,
  ): Promise<RestoredInvoiceResponseDto> {
    const restored = await this.restoreInvoice.execute(user, params.id);
    return {
      entity: {
        type: restored.entity.type,
        id: restored.entity.id,
        code: restored.entity.code ?? null,
        label: restored.entity.label,
      },
      restoredAt: restored.restoredAt.toISOString(),
    };
  }

  @Put('invoices/:id/file')
  @RequiresGrant('invoice', 'update')
  @ApiOperation({
    operationId: 'attachInvoiceFile',
    summary: 'Attach, replace or detach (null) the PDF of the invoice',
  })
  @ApiBody({ type: AttachInvoiceFileDto })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async attach(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: InvoiceIdParamsDto,
    @Body() body: AttachInvoiceFileDto,
  ): Promise<InvoiceResponseDto> {
    return toInvoiceResponse(
      await this.attachFile.execute(user, { id: params.id, fileId: body.fileId }),
    );
  }

  @Get('clients/:id/billable-installments')
  @RequiresGrant('invoice', 'read')
  @ApiOperation({
    operationId: 'listBillableInstallments',
    summary: 'Pending installments of the client projects (the billing wizard)',
  })
  @ApiOkResponse({ type: [BillableInstallmentResponseDto] })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async billable(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ClientIdParamsDto,
  ): Promise<BillableInstallmentResponseDto[]> {
    return (await this.listBillable.execute(user, params.id)).map(toBillableResponse);
  }

  @Get('clients/:id/open-invoices')
  @RequiresGrant('invoice', 'read')
  @ApiOperation({
    operationId: 'listOpenInvoices',
    summary: 'Open invoices of the client (the payment form)',
  })
  @ApiOkResponse({ type: [OpenInvoiceResponseDto] })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async open(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ClientIdParamsDto,
  ): Promise<OpenInvoiceResponseDto[]> {
    return (await this.listOpen.execute(user, params.id)).map(toOpenInvoiceResponse);
  }
}
