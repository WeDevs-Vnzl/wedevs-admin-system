import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { CreateDocumentType } from '../../application/use-cases/create-document-type.use-case';
import { DeleteDocumentType } from '../../application/use-cases/delete-document-type.use-case';
import { GetDocumentType } from '../../application/use-cases/get-document-type.use-case';
import { ListDocumentTypes } from '../../application/use-cases/list-document-types.use-case';
import { SetDocumentTypeActive } from '../../application/use-cases/set-document-type-active.use-case';
import { UpdateDocumentType } from '../../application/use-cases/update-document-type.use-case';
import {
  DeletedRefDto,
  DocumentTypeBodyDto,
  DocumentTypeDetailDto,
  DocumentTypeListResponseDto,
  ListDocumentTypesQueryDto,
  SetDocumentTypeActiveDto,
} from './dto/document-types.dto';

/**
 * Document types (PRD §8.9.1, HU-21). Reads need only authentication (DT-71); writes need the `settings`
 * grant. A type in use cannot be deleted (C19); it is deactivated.
 */
@ApiTags('settings')
@Controller('document-types')
export class DocumentTypesController {
  constructor(
    private readonly listTypes: ListDocumentTypes,
    private readonly getType: GetDocumentType,
    private readonly createType: CreateDocumentType,
    private readonly updateType: UpdateDocumentType,
    private readonly setActive: SetDocumentTypeActive,
    private readonly deleteType: DeleteDocumentType,
  ) {}

  @Get()
  @Authenticated()
  @ApiOperation({
    operationId: 'listDocumentTypes',
    summary: 'Document types, filtered, searched, sorted and paged (any signed-in user)',
  })
  @ApiOkResponse({ type: DocumentTypeListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListDocumentTypesQueryDto,
  ): Promise<DocumentTypeListResponseDto> {
    return this.listTypes.execute(user, query);
  }

  @Post()
  @RequiresGrant('settings', 'create')
  @ApiOperation({
    operationId: 'createDocumentType',
    summary: 'Create a document type inside a category (settings grant)',
  })
  @ApiBody({ type: DocumentTypeBodyDto })
  @ApiOkResponse({ type: DocumentTypeDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: DocumentTypeBodyDto,
  ): Promise<DocumentTypeDetailDto> {
    return this.createType.execute(user, body);
  }

  @Get(':id')
  @Authenticated()
  @ApiOperation({
    operationId: 'getDocumentType',
    summary: 'One document type with its category and document count (any signed-in user)',
  })
  @ApiOkResponse({ type: DocumentTypeDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
  ): Promise<DocumentTypeDetailDto> {
    return this.getType.execute(user, { id });
  }

  @Patch(':id')
  @RequiresGrant('settings', 'update')
  @ApiOperation({
    operationId: 'updateDocumentType',
    summary: 'Replace every field of a document type (settings grant)',
  })
  @ApiBody({ type: DocumentTypeBodyDto })
  @ApiOkResponse({ type: DocumentTypeDetailDto })
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
    @Body() body: DocumentTypeBodyDto,
  ): Promise<DocumentTypeDetailDto> {
    return this.updateType.execute(user, { ...body, id });
  }

  @Post(':id/active')
  @HttpCode(200)
  @RequiresGrant('settings', 'update')
  @ApiOperation({
    operationId: 'setDocumentTypeActive',
    summary: 'Activate or deactivate a document type (settings grant)',
  })
  @ApiBody({ type: SetDocumentTypeActiveDto })
  @ApiOkResponse({ type: DocumentTypeDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async activation(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
    @Body() body: SetDocumentTypeActiveDto,
  ): Promise<DocumentTypeDetailDto> {
    return this.setActive.execute(user, { id, active: body.active });
  }

  @Delete(':id')
  @RequiresGrant('settings', 'delete')
  @ApiOperation({
    operationId: 'deleteDocumentType',
    summary: 'Delete an unused document type for good (settings grant)',
  })
  @ApiOkResponse({ type: DeletedRefDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTEGRITY_LOCK', 'INTERNAL')
  async delete(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
  ): Promise<DeletedRefDto> {
    return this.deleteType.execute(user, { id });
  }
}
