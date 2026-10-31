import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { ApplyInstallmentTemplate } from '../../application/use-cases/billing/apply-installment-template.use-case';
import { CancelInstallment } from '../../application/use-cases/billing/cancel-installment.use-case';
import { CreateInstallment } from '../../application/use-cases/billing/create-installment.use-case';
import { CreateRecurringCharge } from '../../application/use-cases/billing/create-recurring-charge.use-case';
import { GenerateMissingPeriods } from '../../application/use-cases/billing/generate-missing-periods.use-case';
import { GetBillingPage } from '../../application/use-cases/billing/get-billing-page.use-case';
import { SetRecurringChargeStatus } from '../../application/use-cases/billing/set-recurring-charge-status.use-case';
import { UpdateInstallment } from '../../application/use-cases/billing/update-installment.use-case';
import { UpdateRecurringCharge } from '../../application/use-cases/billing/update-recurring-charge.use-case';
import { UpsertBillingPlan } from '../../application/use-cases/billing/upsert-billing-plan.use-case';
import {
  ApplyInstallmentTemplateDto,
  BillingIdParamsDto,
  BillingPageResponseDto,
  CreateInstallmentDto,
  CreateRecurringChargeDto,
  GenerateMissingPeriodsDto,
  GenerateMissingPeriodsResponseDto,
  SetRecurringChargeStatusDto,
  UpdateInstallmentDto,
  UpdateRecurringChargeDto,
  UpsertBillingPlanDto,
  toBillingPageResponse,
} from './dto/billing.dto';

const ERRORS = ['UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL'] as const;

/**
 * Billing (PRD §8.4, HU-09, HU-10): plan, installments and recurring charges of a project. Finance roles
 * only: Member and Viewer hold no `billing` grant (C13, PRD §4.3). Every handler declares its grant and the
 * use case runs `can()` as the authority. Each mutation answers the whole billing page of the project.
 */
@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly getPage: GetBillingPage,
    private readonly upsertPlan: UpsertBillingPlan,
    private readonly applyTemplate: ApplyInstallmentTemplate,
    private readonly createInstallment: CreateInstallment,
    private readonly updateInstallment: UpdateInstallment,
    private readonly cancelInstallment: CancelInstallment,
    private readonly createCharge: CreateRecurringCharge,
    private readonly updateCharge: UpdateRecurringCharge,
    private readonly setChargeStatus: SetRecurringChargeStatus,
    private readonly generateMissing: GenerateMissingPeriods,
  ) {}

  @Get('projects/:id/billing')
  @RequiresGrant('billing', 'read')
  @ApiOperation({
    operationId: 'getBillingPage',
    summary: 'Plan, installments and recurring charges',
  })
  @ApiOkResponse({ type: BillingPageResponseDto })
  @ApiErrorResponses(...ERRORS)
  async page(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: BillingIdParamsDto,
  ): Promise<BillingPageResponseDto> {
    return toBillingPageResponse(await this.getPage.execute(user, params.id));
  }

  @Put('projects/:id/billing-plan')
  @RequiresGrant('billing', 'update')
  @ApiOperation({
    operationId: 'upsertBillingPlan',
    summary: 'Create or update the plan (USD snapshot taken when the contract or currency changes)',
  })
  @ApiBody({ type: UpsertBillingPlanDto })
  @ApiOkResponse({ type: BillingPageResponseDto })
  @ApiErrorResponses(...ERRORS, 'INTEGRITY_LOCK', 'CONFLICT')
  async upsert(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: BillingIdParamsDto,
    @Body() body: UpsertBillingPlanDto,
  ): Promise<BillingPageResponseDto> {
    return toBillingPageResponse(
      await this.upsertPlan.execute(user, { ...body, projectId: params.id }),
    );
  }

  @Post('projects/:id/billing-plan/template')
  @HttpCode(200)
  @RequiresGrant('billing', 'create')
  @ApiOperation({
    operationId: 'applyInstallmentTemplate',
    summary: 'Generate the installments from a quick template or a custom list',
  })
  @ApiBody({ type: ApplyInstallmentTemplateDto })
  @ApiOkResponse({ type: BillingPageResponseDto })
  @ApiErrorResponses(...ERRORS, 'CONFLICT')
  async template(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: BillingIdParamsDto,
    @Body() body: ApplyInstallmentTemplateDto,
  ): Promise<BillingPageResponseDto> {
    return toBillingPageResponse(
      await this.applyTemplate.execute(user, { ...body, projectId: params.id }),
    );
  }

  @Post('projects/:id/installments')
  @HttpCode(200)
  @RequiresGrant('billing', 'create')
  @ApiOperation({ operationId: 'createInstallment', summary: 'Add a manual installment' })
  @ApiBody({ type: CreateInstallmentDto })
  @ApiOkResponse({ type: BillingPageResponseDto })
  @ApiErrorResponses(...ERRORS, 'CONFLICT')
  async createOne(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: BillingIdParamsDto,
    @Body() body: CreateInstallmentDto,
  ): Promise<BillingPageResponseDto> {
    return toBillingPageResponse(
      await this.createInstallment.execute(user, { ...body, projectId: params.id }),
    );
  }

  @Patch('installments/:id')
  @RequiresGrant('billing', 'update')
  @ApiOperation({
    operationId: 'updateInstallment',
    summary: 'Edit an installment (a billed one only accepts a new label)',
  })
  @ApiBody({ type: UpdateInstallmentDto })
  @ApiOkResponse({ type: BillingPageResponseDto })
  @ApiErrorResponses(...ERRORS, 'INTEGRITY_LOCK', 'CONFLICT')
  async updateOne(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: BillingIdParamsDto,
    @Body() body: UpdateInstallmentDto,
  ): Promise<BillingPageResponseDto> {
    return toBillingPageResponse(
      await this.updateInstallment.execute(user, { ...body, id: params.id }),
    );
  }

  @Post('installments/:id/cancel')
  @HttpCode(200)
  @RequiresGrant('billing', 'update')
  @ApiOperation({ operationId: 'cancelInstallment', summary: 'Cancel an unbilled installment' })
  @ApiOkResponse({ type: BillingPageResponseDto })
  @ApiErrorResponses(...ERRORS, 'INTEGRITY_LOCK', 'CONFLICT')
  async cancelOne(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: BillingIdParamsDto,
  ): Promise<BillingPageResponseDto> {
    return toBillingPageResponse(await this.cancelInstallment.execute(user, params.id));
  }

  @Post('projects/:id/recurring-charges')
  @HttpCode(200)
  @RequiresGrant('billing', 'create')
  @ApiOperation({ operationId: 'createRecurringCharge', summary: 'Add a recurring charge' })
  @ApiBody({ type: CreateRecurringChargeDto })
  @ApiOkResponse({ type: BillingPageResponseDto })
  @ApiErrorResponses(...ERRORS, 'CONFLICT')
  async createRecurring(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: BillingIdParamsDto,
    @Body() body: CreateRecurringChargeDto,
  ): Promise<BillingPageResponseDto> {
    return toBillingPageResponse(
      await this.createCharge.execute(user, { ...body, projectId: params.id }),
    );
  }

  @Patch('recurring-charges/:id')
  @RequiresGrant('billing', 'update')
  @ApiOperation({
    operationId: 'updateRecurringCharge',
    summary: 'Edit a recurring charge (only periods not generated yet are affected)',
  })
  @ApiBody({ type: UpdateRecurringChargeDto })
  @ApiOkResponse({ type: BillingPageResponseDto })
  @ApiErrorResponses(...ERRORS, 'CONFLICT')
  async updateRecurring(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: BillingIdParamsDto,
    @Body() body: UpdateRecurringChargeDto,
  ): Promise<BillingPageResponseDto> {
    return toBillingPageResponse(await this.updateCharge.execute(user, { ...body, id: params.id }));
  }

  @Post('recurring-charges/:id/status')
  @HttpCode(200)
  @RequiresGrant('billing', 'update')
  @ApiOperation({
    operationId: 'setRecurringChargeStatus',
    summary: 'Pause, resume or finish a recurring charge (finished is final)',
  })
  @ApiBody({ type: SetRecurringChargeStatusDto })
  @ApiOkResponse({ type: BillingPageResponseDto })
  @ApiErrorResponses(...ERRORS, 'CONFLICT')
  async setStatus(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: BillingIdParamsDto,
    @Body() body: SetRecurringChargeStatusDto,
  ): Promise<BillingPageResponseDto> {
    return toBillingPageResponse(
      await this.setChargeStatus.execute(user, { id: params.id, status: body.status }),
    );
  }

  @Post('recurring-charges/:id/generate-missing-periods')
  @HttpCode(200)
  @RequiresGrant('billing', 'create')
  @ApiOperation({
    operationId: 'generateMissingPeriods',
    summary: 'Create the periods skipped while a charge was paused',
  })
  @ApiBody({ type: GenerateMissingPeriodsDto })
  @ApiOkResponse({ type: GenerateMissingPeriodsResponseDto })
  @ApiErrorResponses(...ERRORS, 'CONFLICT')
  async generate(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: BillingIdParamsDto,
    @Body() body: GenerateMissingPeriodsDto,
  ): Promise<GenerateMissingPeriodsResponseDto> {
    const result = await this.generateMissing.execute(user, {
      recurringChargeId: params.id,
      upTo: body.upTo,
    });
    return { created: result.created, periodStarts: [...result.periodStarts] };
  }
}
