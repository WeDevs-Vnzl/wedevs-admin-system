import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { CreateDocumentCategory } from '../../application/use-cases/create-document-category.use-case';
import { DeleteDocumentCategory } from '../../application/use-cases/delete-document-category.use-case';
import { ListDocumentCategories } from '../../application/use-cases/list-document-categories.use-case';
import { ReorderDocumentCategories } from '../../application/use-cases/reorder-document-categories.use-case';
import { UpdateDocumentCategory } from '../../application/use-cases/update-document-category.use-case';
import {
  DocumentCategoryBodyDto,
  DocumentCategoryResponseDto,
  ReorderDocumentCategoriesDto,
} from './dto/document-categories.dto';
import { DeletedRefDto } from './dto/document-types.dto';

/**
 * Document categories (PRD §8.9.1, HU-21). Reads of the reference catalog need only authentication (DT-71);
 * writes need the `settings` grant (Owner and Admin). Each use case runs `can()` again (C13).
 */
@ApiTags('settings')
@Controller('document-categories')
export class DocumentCategoriesController {
  constructor(
    private readonly listCategories: ListDocumentCategories,
    private readonly createCategory: CreateDocumentCategory,
    private readonly updateCategory: UpdateDocumentCategory,
    private readonly reorderCategories: ReorderDocumentCategories,
    private readonly deleteCategory: DeleteDocumentCategory,
  ) {}

  @Get()
  @Authenticated()
  @ApiOperation({
    operationId: 'listDocumentCategories',
    summary: 'Document categories in order, each with its types (any signed-in user)',
  })
  @ApiOkResponse({ type: [DocumentCategoryResponseDto] })
  @ApiErrorResponses('UNAUTHENTICATED', 'INTERNAL')
  async list(@CurrentUser() user: CurrentUserModel): Promise<DocumentCategoryResponseDto[]> {
    return this.listCategories.execute(user);
  }

  @Post()
  @RequiresGrant('settings', 'create')
  @ApiOperation({
    operationId: 'createDocumentCategory',
    summary: 'Create a document category at the end (settings grant)',
  })
  @ApiBody({ type: DocumentCategoryBodyDto })
  @ApiOkResponse({ type: DocumentCategoryResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: DocumentCategoryBodyDto,
  ): Promise<DocumentCategoryResponseDto> {
    return this.createCategory.execute(user, body);
  }

  // Declared before `:id` so `reorder` is never read as a category id.
  @Post('reorder')
  @HttpCode(200)
  @RequiresGrant('settings', 'update')
  @ApiOperation({
    operationId: 'reorderDocumentCategories',
    summary: 'Reorder every category: the full id set, all or nothing (settings grant)',
  })
  @ApiBody({ type: ReorderDocumentCategoriesDto })
  @ApiOkResponse({ type: [DocumentCategoryResponseDto] })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async reorder(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: ReorderDocumentCategoriesDto,
  ): Promise<DocumentCategoryResponseDto[]> {
    return this.reorderCategories.execute(user, body);
  }

  @Patch(':id')
  @RequiresGrant('settings', 'update')
  @ApiOperation({
    operationId: 'updateDocumentCategory',
    summary: 'Edit a category name, English name and colour (settings grant)',
  })
  @ApiBody({ type: DocumentCategoryBodyDto })
  @ApiOkResponse({ type: DocumentCategoryResponseDto })
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
    @Param('id') id: string,
    @Body() body: DocumentCategoryBodyDto,
  ): Promise<DocumentCategoryResponseDto> {
    return this.updateCategory.execute(user, { ...body, id });
  }

  @Delete(':id')
  @RequiresGrant('settings', 'delete')
  @ApiOperation({
    operationId: 'deleteDocumentCategory',
    summary: 'Delete an empty category for good (settings grant)',
  })
  @ApiOkResponse({ type: DeletedRefDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTEGRITY_LOCK', 'INTERNAL')
  async delete(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
  ): Promise<DeletedRefDto> {
    return this.deleteCategory.execute(user, { id });
  }
}
