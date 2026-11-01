import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { CreateExpense } from '../../application/use-cases/expenses/create-expense.use-case';
import {
  GetExpense,
  ListExpenses,
} from '../../application/use-cases/expenses/list-expenses.use-case';
import { MarkExpensePaid } from '../../application/use-cases/expenses/mark-expense-paid.use-case';
import { UpdateExpense } from '../../application/use-cases/expenses/update-expense.use-case';
import { VoidExpense } from '../../application/use-cases/expenses/void-expense.use-case';
import {
  CreateExpenseDto,
  ExpenseIdParamsDto,
  ExpenseListResponseDto,
  ExpenseResponseDto,
  ListExpensesQueryDto,
  MarkExpensePaidDto,
  UpdateExpenseDto,
  VoidExpenseDto,
  toExpenseResponse,
} from './expenses.dto';

/**
 * Expenses (PRD §8.8, HU-17). Finance routes are Owner and Admin only: Member and Viewer get `FORBIDDEN`
 * (PRD §4.3). Every handler declares its grant; the use case runs `can()` as the authority (C13).
 */
@ApiTags('expenses')
@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly listExpenses: ListExpenses,
    private readonly getExpense: GetExpense,
    private readonly createExpense: CreateExpense,
    private readonly updateExpense: UpdateExpense,
    private readonly markPaid: MarkExpensePaid,
    private readonly voidExpense: VoidExpense,
  ) {}

  @Get()
  @RequiresGrant('expense', 'read')
  @ApiOperation({ operationId: 'listExpenses', summary: 'List expenses (filters, search, sort)' })
  @ApiOkResponse({ type: ExpenseListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListExpensesQueryDto,
  ): Promise<ExpenseListResponseDto> {
    const page = await this.listExpenses.execute(user, query);
    return { ...page, items: page.items.map(toExpenseResponse) };
  }

  @Post()
  @RequiresGrant('expense', 'create')
  @ApiOperation({
    operationId: 'createExpense',
    summary: 'Create an expense, pending or paid (GAS-####)',
  })
  @ApiBody({ type: CreateExpenseDto })
  @ApiCreatedResponse({ type: ExpenseResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    return toExpenseResponse(await this.createExpense.execute(user, body));
  }

  @Get(':id')
  @RequiresGrant('expense', 'read')
  @ApiOperation({ operationId: 'getExpense', summary: 'Expense detail' })
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ExpenseIdParamsDto,
  ): Promise<ExpenseResponseDto> {
    return toExpenseResponse(await this.getExpense.execute(user, params.id));
  }

  @Patch(':id')
  @RequiresGrant('expense', 'update')
  @ApiOperation({ operationId: 'updateExpense', summary: 'Edit a pending expense' })
  @ApiBody({ type: UpdateExpenseDto })
  @ApiOkResponse({ type: ExpenseResponseDto })
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
    @Body() body: UpdateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    return toExpenseResponse(await this.updateExpense.execute(user, { ...body, id: params.id }));
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequiresGrant('expense', 'update')
  @ApiOperation({
    operationId: 'markExpensePaid',
    summary: 'Mark a pending expense as paid (debits the account)',
  })
  @ApiBody({ type: MarkExpensePaidDto })
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async pay(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ExpenseIdParamsDto,
    @Body() body: MarkExpensePaidDto,
  ): Promise<ExpenseResponseDto> {
    return toExpenseResponse(await this.markPaid.execute(user, { ...body, id: params.id }));
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequiresGrant('expense', 'update')
  @ApiOperation({ operationId: 'voidExpense', summary: 'Void an expense (ANULADO is final)' })
  @ApiBody({ type: VoidExpenseDto })
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async void(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ExpenseIdParamsDto,
    @Body() body: VoidExpenseDto,
  ): Promise<ExpenseResponseDto> {
    return toExpenseResponse(await this.voidExpense.execute(user, { ...body, id: params.id }));
  }
}
