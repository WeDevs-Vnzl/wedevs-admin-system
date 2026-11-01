import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import type {
  ArchivedDocumentOutput,
  DocumentDetail,
  DocumentLinkView,
} from '../../application/document-support';
import {
  ArchiveDocument,
  ArchiveDocuments,
} from '../../application/use-cases/records/archive-documents.use-case';
import { CreateDocument } from '../../application/use-cases/records/create-document.use-case';
import {
  CountDocumentsByCategory,
  GetDocument,
  ListDocuments,
} from '../../application/use-cases/records/list-documents.use-case';
import {
  LinkDocument,
  UnlinkDocument,
} from '../../application/use-cases/records/link-document.use-case';
import { RestoreDocument } from '../../application/use-cases/records/restore-document.use-case';
import { SetDocumentStatus } from '../../application/use-cases/records/set-document-status.use-case';
import { UpdateDocumentMeta } from '../../application/use-cases/records/update-document-meta.use-case';
import {
  ArchiveDocumentsDto,
  ArchivedDocumentDto,
  ArchivedDocumentsDto,
  CreateDocumentDto,
  DocumentDetailDto,
  DocumentIdParamsDto,
  DocumentLinkDto,
  DocumentLinkParamsDto,
  DocumentLinkTargetDto,
  DocumentListResponseDto,
  EntityRefResponseDto,
  ListDocumentsQueryDto,
  SetDocumentStatusDto,
  UpdateDocumentDto,
} from './dto/documents.dto';

const refOf = (ref: EntityRef) => ({
  type: ref.type,
  id: ref.id,
  code: ref.code ?? null,
  label: ref.label,
});

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function linkResponse(link: DocumentLinkView): DocumentLinkDto {
  return { id: link.id, entity: refOf(link.entity), createdAt: link.createdAt.toISOString() };
}

function detailResponse(doc: DocumentDetail): DocumentDetailDto {
  const version = doc.currentVersion;
  return {
    id: doc.id,
    code: doc.code,
    title: doc.title,
    type: doc.type,
    category: doc.category,
    summary: doc.summary,
    status: doc.status,
    effectiveDate: doc.effectiveDate,
    signedAt: doc.signedAt,
    expiresAt: doc.expiresAt,
    alertDaysBefore: doc.alertDaysBefore,
    currentVersion: version
      ? {
          ...version,
          file: version.file
            ? { ...version.file, createdAt: version.file.createdAt.toISOString() }
            : null,
          createdAt: version.createdAt.toISOString(),
        }
      : null,
    versionCount: doc.versionCount,
    draftContent: doc.draftContent,
    draftUpdatedAt: iso(doc.draftUpdatedAt),
    links: doc.links.map(linkResponse),
    tags: doc.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    isShared: doc.isShared,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    archivedAt: iso(doc.archivedAt),
  };
}

const archivedResponse = (archived: ArchivedDocumentOutput): ArchivedDocumentDto => ({
  id: archived.id,
  archivedAt: archived.archivedAt.toISOString(),
});

/**
 * Documents (PRD §8.9, HU-18 to HU-20). Every route is guarded by the matrix row of `document`; the use case
 * runs `can()` again as the authority (C13). `archive` needs `delete` (Owner and Admin), `restore` the trash
 * grant. Share links and the portal are other controllers.
 */
@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly listDocuments: ListDocuments,
    private readonly countByCategory: CountDocumentsByCategory,
    private readonly getDocument: GetDocument,
    private readonly createDocument: CreateDocument,
    private readonly updateMeta: UpdateDocumentMeta,
    private readonly setStatus: SetDocumentStatus,
    private readonly archiveDocument: ArchiveDocument,
    private readonly archiveDocuments: ArchiveDocuments,
    private readonly restoreDocument: RestoreDocument,
    private readonly linkDocument: LinkDocument,
    private readonly unlinkDocument: UnlinkDocument,
  ) {}

  @Get()
  @RequiresGrant('document', 'read')
  @ApiOperation({
    operationId: 'listDocuments',
    summary: 'Documents table (archived ones for trash roles only)',
  })
  @ApiOkResponse({ type: DocumentListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<DocumentListResponseDto> {
    const page = await this.listDocuments.execute(user, query);
    return {
      ...page,
      items: page.items.map((row) => ({
        ...row,
        links: row.links.map(refOf),
        tags: row.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
        updatedAt: row.updatedAt.toISOString(),
        archivedAt: iso(row.archivedAt),
      })),
    };
  }

  @Get('category-counts')
  @RequiresGrant('document', 'read')
  @ApiOperation({
    operationId: 'countDocumentsByCategory',
    summary: 'Live documents per category id under the list facets (the category chips)',
  })
  @ApiOkResponse({
    description: 'Count per category id; categories without documents are absent',
    schema: { type: 'object', additionalProperties: { type: 'integer' } },
  })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  countCategories(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<Record<string, number>> {
    return this.countByCategory.execute(user, query);
  }

  @Post()
  @RequiresGrant('document', 'create')
  @ApiOperation({
    operationId: 'createDocument',
    summary: 'Create a BORRADOR document, optionally with its first version (all or nothing)',
  })
  @ApiBody({ type: CreateDocumentDto })
  @ApiCreatedResponse({ type: DocumentDetailDto })
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
    @Body() body: CreateDocumentDto,
  ): Promise<DocumentDetailDto> {
    return detailResponse(await this.createDocument.execute(user, body));
  }

  @Post('archive')
  @HttpCode(200)
  @RequiresGrant('document', 'delete')
  @ApiOperation({
    operationId: 'archiveDocuments',
    summary: 'Archive several documents, all or nothing',
  })
  @ApiBody({ type: ArchiveDocumentsDto })
  @ApiOkResponse({ type: ArchivedDocumentsDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async archiveMany(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: ArchiveDocumentsDto,
  ): Promise<ArchivedDocumentsDto> {
    const result = await this.archiveDocuments.execute(user, body);
    return { archived: result.archived.map(archivedResponse) };
  }

  @Get(':id')
  @RequiresGrant('document', 'read')
  @ApiOperation({
    operationId: 'getDocument',
    summary: 'One document (archived ones for trash roles only)',
  })
  @ApiOkResponse({ type: DocumentDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentIdParamsDto,
  ): Promise<DocumentDetailDto> {
    return detailResponse(await this.getDocument.execute(user, { id: params.id }));
  }

  @Patch(':id')
  @RequiresGrant('document', 'update')
  @ApiOperation({ operationId: 'updateDocument', summary: 'Edit the metadata of a live document' })
  @ApiBody({ type: UpdateDocumentDto })
  @ApiOkResponse({ type: DocumentDetailDto })
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
    @Param() params: DocumentIdParamsDto,
    @Body() body: UpdateDocumentDto,
  ): Promise<DocumentDetailDto> {
    return detailResponse(await this.updateMeta.execute(user, { ...body, id: params.id }));
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequiresGrant('document', 'update')
  @ApiOperation({
    operationId: 'setDocumentStatus',
    summary: 'Change the status (VENCIDO is never set by a person)',
  })
  @ApiBody({ type: SetDocumentStatusDto })
  @ApiOkResponse({ type: DocumentDetailDto })
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
    @Param() params: DocumentIdParamsDto,
    @Body() body: SetDocumentStatusDto,
  ): Promise<DocumentDetailDto> {
    return detailResponse(await this.setStatus.execute(user, { ...body, id: params.id }));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequiresGrant('document', 'delete')
  @ApiOperation({ operationId: 'archiveDocument', summary: 'Archive a document (Owner and Admin)' })
  @ApiOkResponse({ type: ArchivedDocumentDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async archive(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentIdParamsDto,
  ): Promise<ArchivedDocumentDto> {
    return archivedResponse(await this.archiveDocument.execute(user, { id: params.id }));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequiresGrant('document', 'restore')
  @ApiOperation({
    operationId: 'restoreDocument',
    summary: 'Restore an archived document (trash roles)',
  })
  @ApiOkResponse({ type: EntityRefResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async restore(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentIdParamsDto,
  ): Promise<EntityRefResponseDto> {
    return refOf(await this.restoreDocument.execute(user, { id: params.id }));
  }

  @Post(':id/links')
  @RequiresGrant('document', 'update')
  @ApiOperation({
    operationId: 'linkDocument',
    summary: 'Link the document to a record (idempotent); returns every link',
  })
  @ApiBody({ type: DocumentLinkTargetDto })
  @ApiCreatedResponse({ type: [DocumentLinkDto] })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async link(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentIdParamsDto,
    @Body() body: DocumentLinkTargetDto,
  ): Promise<DocumentLinkDto[]> {
    const links = await this.linkDocument.execute(user, { documentId: params.id, target: body });
    return links.map(linkResponse);
  }

  @Delete(':id/links/:entityType/:entityId')
  @RequiresGrant('document', 'update')
  @ApiOperation({
    operationId: 'unlinkDocument',
    summary: 'Remove one link (a hard delete); returns the remaining links',
  })
  @ApiOkResponse({ type: [DocumentLinkDto] })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async unlink(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentLinkParamsDto,
  ): Promise<DocumentLinkDto[]> {
    const links = await this.unlinkDocument.execute(user, {
      documentId: params.id,
      target: { entityType: params.entityType, entityId: params.entityId },
    });
    return links.map(linkResponse);
  }
}
