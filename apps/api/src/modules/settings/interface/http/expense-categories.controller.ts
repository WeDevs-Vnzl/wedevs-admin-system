import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { CreateExpenseCategory } from '../../application/use-cases/create-expense-category.use-case';
import { ListExpenseCategories } from '../../application/use-cases/list-expense-categories.use-case';
import { UpdateExpenseCategory } from '../../application/use-cases/update-expense-category.use-case';
import { IncludeInactiveQueryDto } from './dto/currencies.dto';
import {
  CreateExpenseCategoryDto,
  ExpenseCategoryNodeDto,
  ExpenseCategoryResponseDto,
  UpdateExpenseCategoryDto,
} from './dto/expense-categories.dto';

type ExpenseCategoryOutput = Awaited<ReturnType<CreateExpenseCategory['execute']>>;
type ExpenseCategoryNodeOutput = Awaited<ReturnType<ListExpenseCategories['execute']>>[number];

@ApiTags('settings')
@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(
    @Inject(ListExpenseCategories) private readonly listExpenseCategories: ListExpenseCategories,
    @Inject(CreateExpenseCategory) private readonly createExpenseCategory: CreateExpenseCategory,
    @Inject(UpdateExpenseCategory) private readonly updateExpenseCategory: UpdateExpenseCategory,
  ) {}

  @Authenticated()
  @Get()
  @ApiOperation({
    operationId: 'listExpenseCategories',
    summary: 'Expense category tree, two levels (active by default)',
  })
  @ApiOkResponse({
    description: 'The roots, each with its children',
    type: [ExpenseCategoryNodeDto],
  })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: IncludeInactiveQueryDto,
  ): Promise<ExpenseCategoryNodeDto[]> {
    const tree = await this.listExpenseCategories.execute(user, query);
    return tree.map(toNode);
  }

  @RequiresGrant('settings', 'create')
  @Post()
  @ApiOperation({
    operationId: 'createExpenseCategory',
    summary: 'Add a root or a child of a root (settings grant)',
  })
  @ApiBody({ type: CreateExpenseCategoryDto })
  @ApiCreatedResponse({ description: 'The created category', type: ExpenseCategoryResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreateExpenseCategoryDto,
  ): Promise<ExpenseCategoryResponseDto> {
    return toResponse(await this.createExpenseCategory.execute(user, body));
  }

  @RequiresGrant('settings', 'update')
  @Patch(':id')
  @ApiOperation({
    operationId: 'updateExpenseCategory',
    summary: 'Edit an expense category (settings grant)',
  })
  @ApiBody({ type: UpdateExpenseCategoryDto })
  @ApiOkResponse({ description: 'The saved category', type: ExpenseCategoryResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION',
    'CONFLICT',
    'INTERNAL',
  )
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
    @Body() body: UpdateExpenseCategoryDto,
  ): Promise<ExpenseCategoryResponseDto> {
    return toResponse(await this.updateExpenseCategory.execute(user, id, body));
  }
}

function toResponse(category: ExpenseCategoryOutput): ExpenseCategoryResponseDto {
  return {
    id: category.id,
    name: category.name,
    nameEn: category.nameEn,
    color: category.color,
    parentId: category.parentId,
    active: category.active,
  };
}

function toNode(node: ExpenseCategoryNodeOutput): ExpenseCategoryNodeDto {
  return { ...toResponse(node), children: node.children.map(toResponse) };
}
