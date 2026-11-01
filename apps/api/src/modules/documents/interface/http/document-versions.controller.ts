import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import type { DocumentDetail } from '../../application/document-support';
import type {
  DocumentVersionRow,
  DocumentVersionWithContent,
} from '../../application/ports/document-version.repository.port';
import { PublishVersion } from '../../application/use-cases/versions/publish-version.use-case';
import {
  GetDocumentVersion,
  ListDocumentVersions,
} from '../../application/use-cases/versions/read-document-versions.use-cases';
import { RestoreVersion } from '../../application/use-cases/versions/restore-version.use-case';
import { SaveDraft } from '../../application/use-cases/versions/save-draft.use-case';
import { UploadVersion } from '../../application/use-cases/versions/upload-version.use-case';
import { DocumentDetailDto, DocumentIdParamsDto } from './dto/documents.dto';
import {
  DocumentVersionDetailDto,
  DocumentVersionParamsDto,
  DocumentVersionRowDto,
  PublishVersionDto,
  RestoreVersionDto,
  SaveDraftDto,
  SaveDraftResponseDto,
  toUploadVersionInput,
  UploadVersionDto,
} from './dto/document-versions.dto';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function versionRowResponse(version: DocumentVersionRow): DocumentVersionRowDto {
  return {
    id: version.id,
    documentId: version.documentId,
    versionNumber: version.versionNumber,
    format: version.format,
    file: version.file
      ? { ...version.file, createdAt: version.file.createdAt.toISOString() }
      : null,
    url: version.url,
    changelog: version.changelog,
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
    isCurrent: version.isCurrent,
  };
}

const versionDetailResponse = (version: DocumentVersionWithContent): DocumentVersionDetailDto => ({
  ...versionRowResponse(version),
  content: version.content,
});

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
    currentVersion: version ? versionDetailResponse(version) : null,
    versionCount: doc.versionCount,
    draftContent: doc.draftContent,
    draftUpdatedAt: iso(doc.draftUpdatedAt),
    links: doc.links.map((link) => ({
      id: link.id,
      entity: {
        type: link.entity.type,
        id: link.entity.id,
        code: link.entity.code ?? null,
        label: link.entity.label,
      },
      createdAt: link.createdAt.toISOString(),
    })),
    tags: doc.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    isShared: doc.isShared,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    archivedAt: iso(doc.archivedAt),
  };
}

/**
 * Document versions and the markdown draft (PRD §8.9.3, HU-18, HU-19). Every route is guarded by the matrix
 * row of `document`; the use case runs `can()` again as the authority (C13). Reads need `read`, every write
 * `update` (Member `CRU`, Viewer `R`). The raw markdown is returned as stored: the FE sanitizes it (C4).
 */
@ApiTags('documents')
@Controller('documents')
export class DocumentVersionsController {
  constructor(
    private readonly listVersions: ListDocumentVersions,
    private readonly getVersion: GetDocumentVersion,
    private readonly saveDraft: SaveDraft,
    private readonly publishVersion: PublishVersion,
    private readonly uploadVersion: UploadVersion,
    private readonly restoreVersion: RestoreVersion,
  ) {}

  @Get(':id/versions')
  @RequiresGrant('document', 'read')
  @ApiOperation({
    operationId: 'listDocumentVersions',
    summary: 'Version history, newest first, without content',
  })
  @ApiOkResponse({ type: [DocumentVersionRowDto] })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentIdParamsDto,
  ): Promise<DocumentVersionRowDto[]> {
    const versions = await this.listVersions.execute(user, { documentId: params.id });
    return versions.map(versionRowResponse);
  }

  @Get(':id/versions/:versionId')
  @RequiresGrant('document', 'read')
  @ApiOperation({
    operationId: 'getDocumentVersion',
    summary: 'One version with its raw markdown (the FE diff reads two of them)',
  })
  @ApiOkResponse({ type: DocumentVersionDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentVersionParamsDto,
  ): Promise<DocumentVersionDetailDto> {
    return versionDetailResponse(
      await this.getVersion.execute(user, { documentId: params.id, versionId: params.versionId }),
    );
  }

  @Put(':id/draft')
  @RequiresGrant('document', 'update')
  @ApiOperation({
    operationId: 'saveDocumentDraft',
    summary: 'Explicit "Save draft" of a markdown document (no autosave, creates no version)',
  })
  @ApiBody({ type: SaveDraftDto })
  @ApiOkResponse({ type: SaveDraftResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async draft(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentIdParamsDto,
    @Body() body: SaveDraftDto,
  ): Promise<SaveDraftResponseDto> {
    const saved = await this.saveDraft.execute(user, {
      documentId: params.id,
      content: body.content,
    });
    return { documentId: saved.documentId, draftUpdatedAt: saved.draftUpdatedAt.toISOString() };
  }

  @Post(':id/versions/publish')
  @RequiresGrant('document', 'update')
  @ApiOperation({
    operationId: 'publishDocumentVersion',
    summary: 'Freeze the sent text (or the stored draft) as the next immutable markdown version',
  })
  @ApiBody({ type: PublishVersionDto })
  @ApiCreatedResponse({ type: DocumentDetailDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async publish(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentIdParamsDto,
    @Body() body: PublishVersionDto,
  ): Promise<DocumentDetailDto> {
    return detailResponse(
      await this.publishVersion.execute(user, {
        documentId: params.id,
        content: body.content ?? null,
        changelog: body.changelog ?? null,
      }),
    );
  }

  @Post(':id/versions')
  @RequiresGrant('document', 'update')
  @ApiOperation({
    operationId: 'uploadDocumentVersion',
    summary: 'Next version from a READY file or an http(s) link',
  })
  @ApiBody({ type: UploadVersionDto })
  @ApiCreatedResponse({ type: DocumentDetailDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async upload(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentIdParamsDto,
    @Body() body: UploadVersionDto,
  ): Promise<DocumentDetailDto> {
    return detailResponse(
      await this.uploadVersion.execute(user, toUploadVersionInput(params.id, body)),
    );
  }

  @Post(':id/versions/:versionId/restore')
  @RequiresGrant('document', 'update')
  @ApiOperation({
    operationId: 'restoreDocumentVersion',
    summary: 'A new current version copying the chosen one; the history is never rewritten',
  })
  @ApiBody({ type: RestoreVersionDto })
  @ApiCreatedResponse({ type: DocumentDetailDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async restore(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: DocumentVersionParamsDto,
    @Body() body: RestoreVersionDto,
  ): Promise<DocumentDetailDto> {
    return detailResponse(
      await this.restoreVersion.execute(user, {
        documentId: params.id,
        versionId: params.versionId,
        changelog: body.changelog ?? null,
      }),
    );
  }
}
