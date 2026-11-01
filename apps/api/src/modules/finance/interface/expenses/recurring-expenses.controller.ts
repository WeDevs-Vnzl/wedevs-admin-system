import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import {
  CreateRecurringExpense,
  GetRecurringExpense,
  ListRecurringExpenses,
  SetRecurringExpenseStatus,
  UpdateRecurringExpense,
} from '../../application/use-cases/expenses/recurring-expense.use-cases';
import {
  CreateRecurringExpenseDto,
  ExpenseIdParamsDto,
  ListRecurringExpensesQueryDto,
  RecurringExpenseListResponseDto,
  RecurringExpenseResponseDto,
  SetRecurringExpenseStatusDto,
  UpdateRecurringExpenseDto,
  toRecurringExpenseResponse,
} from './expenses.dto';

/**
 * Recurring expenses (PRD §8.8, §8.13.2, HU-17 CA1). The generation step has no route: BE-5 schedules it.
 * Finance routes are Owner and Admin only (PRD §4.3).
 */
@ApiTags('recurring-expenses')
@Controller('recurring-expenses')
export class RecurringExpensesController {
  constructor(
    private readonly listRecurring: ListRecurringExpenses,
    private readonly getRecurring: GetRecurringExpense,
    private readonly createRecurring: CreateRecurringExpense,
    private readonly updateRecurring: UpdateRecurringExpense,
    private readonly setStatus: SetRecurringExpenseStatus,
  ) {}

  @Get()
  @RequiresGrant('expense', 'read')
  @ApiOperation({
    operationId: 'listRecurringExpenses',
    summary: 'List recurring expenses (filters, search, sort)',
  })
  @ApiOkResponse({ type: RecurringExpenseListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListRecurringExpensesQueryDto,
  ): Promise<RecurringExpenseListResponseDto> {
    const page = await this.listRecurring.execute(user, query);
    return { ...page, items: page.items.map(toRecurringExpenseResponse) };
  }

  @Post()
  @RequiresGrant('expense', 'create')
  @ApiOperation({ operationId: 'createRecurringExpense', summary: 'Create a recurring expense' })
  @ApiBody({ type: CreateRecurringExpenseDto })
  @ApiCreatedResponse({ type: RecurringExpenseResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreateRecurringExpenseDto,
  ): Promise<RecurringExpenseResponseDto> {
    return toRecurringExpenseResponse(await this.createRecurring.execute(user, body));
  }

  @Get(':id')
  @RequiresGrant('expense', 'read')
  @ApiOperation({ operationId: 'getRecurringExpense', summary: 'Recurring expense detail' })
  @ApiOkResponse({ type: RecurringExpenseResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ExpenseIdParamsDto,
  ): Promise<RecurringExpenseResponseDto> {
    return toRecurringExpenseResponse(await this.getRecurring.execute(user, params.id));
  }

  @Patch(':id')
  @RequiresGrant('expense', 'update')
  @ApiOperation({
    operationId: 'updateRecurringExpense',
    summary: 'Edit a recurring expense (affects only the periods not generated yet)',
  })
  @ApiBody({ type: UpdateRecurringExpenseDto })
  @ApiOkResponse({ type: RecurringExpenseResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ExpenseIdParamsDto,
    @Body() body: UpdateRecurringExpenseDto,
  ): Promise<RecurringExpenseResponseDto> {
    return toRecurringExpenseResponse(
      await this.updateRecurring.execute(user, { ...body, id: params.id }),
    );
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequiresGrant('expense', 'update')
  @ApiOperation({
    operationId: 'setRecurringExpenseStatus',
    summary: 'Pause, resume or finish a recurring expense (finished is final)',
  })
  @ApiBody({ type: SetRecurringExpenseStatusDto })
  @ApiOkResponse({ type: RecurringExpenseResponseDto })
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
    @Param() params: ExpenseIdParamsDto,
    @Body() body: SetRecurringExpenseStatusDto,
  ): Promise<RecurringExpenseResponseDto> {
    return toRecurringExpenseResponse(
      await this.setStatus.execute(user, { id: params.id, status: body.status }),
    );
  }
}
