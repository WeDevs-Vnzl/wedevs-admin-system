import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { CreateShareLink } from '../../application/use-cases/shares/create-share-link.use-case';
import {
  GetShareLink,
  ListShareAccessLog,
  ListShareLinks,
} from '../../application/use-cases/shares/list-share-links.use-case';
import { RevokeShareLink } from '../../application/use-cases/shares/revoke-share-link.use-case';
import {
  SetShareDocumentAccessKey,
  type SetShareDocumentAccessKeyResult,
} from '../../application/use-cases/shares/set-share-document-access-key.use-case';
import type {
  ShareLinkDetail,
  ShareLinkListRow,
  ShareLinkMutationResult,
} from '../../application/use-cases/shares/share-support';
import { UpdateShareLink } from '../../application/use-cases/shares/update-share-link.use-case';
import type { ShareAccessLogEntry } from '../../application/ports/share-link.repository.port';
import {
  ListShareAccessLogQueryDto,
  ListShareLinksQueryDto,
  SetShareAccessKeyDto,
  SetShareAccessKeyResultDto,
  ShareAccessLogResponseDto,
  ShareLinkDetailDto,
  ShareLinkDocumentParamsDto,
  ShareLinkEditDto,
  ShareLinkFormDto,
  ShareLinkIdParamsDto,
  ShareLinkListResponseDto,
  ShareLinkMutationResultDto,
} from './dto/share-links.dto';

const refOf = (ref: EntityRef) => ({
  type: ref.type,
  id: ref.id,
  code: ref.code ?? null,
  label: ref.label,
});

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function detailResponse(link: ShareLinkDetail): ShareLinkDetailDto {
  return {
    id: link.id,
    token: link.token,
    url: link.url,
    title: link.title,
    message: link.message,
    client: link.client ? refOf(link.client) : null,
    locale: link.locale,
    allowDownload: link.allowDownload,
    expiresAt: link.expiresAt,
    revokedAt: iso(link.revokedAt),
    status: link.status,
    counters: link.counters,
    lastAccessedAt: iso(link.lastAccessedAt),
    documents: link.documents.map((doc) => ({
      document: refOf(doc.document),
      documentStatus: doc.documentStatus,
      versionId: doc.versionId,
      isLatest: doc.isLatest,
      versionNumber: doc.versionNumber,
      format: doc.format,
      order: doc.order,
      requiresAccessKey: doc.requiresAccessKey,
      accessKeyUpdatedAt: iso(doc.accessKeyUpdatedAt),
      counters: doc.counters,
    })),
    createdBy: link.createdBy,
    createdAt: link.createdAt.toISOString(),
  };
}

const mutationResponse = (result: ShareLinkMutationResult): ShareLinkMutationResultDto => ({
  share: detailResponse(result.share),
  generatedKeys: result.generatedKeys.map((key) => ({
    documentId: key.documentId,
    accessKey: key.accessKey,
  })),
});

const rowResponse = (row: ShareLinkListRow) => ({
  id: row.id,
  title: row.title,
  client: row.client ? refOf(row.client) : null,
  documentCount: row.documentCount,
  protectedDocumentCount: row.protectedDocumentCount,
  status: row.status,
  expiresAt: row.expiresAt,
  counters: row.counters,
  lastAccessedAt: iso(row.lastAccessedAt),
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

const logResponse = (entry: ShareAccessLogEntry) => ({
  id: entry.id,
  shareLinkId: entry.shareLinkId,
  event: entry.event,
  documentId: entry.documentId,
  documentTitle: entry.documentTitle,
  visitor: entry.visitor,
  userAgent: entry.userAgent,
  createdAt: entry.createdAt.toISOString(),
});

const keyResponse = (result: SetShareDocumentAccessKeyResult): SetShareAccessKeyResultDto => ({
  shareLinkId: result.shareLinkId,
  documentId: result.documentId,
  action: result.action,
  requiresAccessKey: result.requiresAccessKey,
  accessKeyUpdatedAt: iso(result.accessKeyUpdatedAt),
  accessKey: result.accessKey,
});

/**
 * Share links (PRD §8.11, HU-22): management of the portal links, their access keys and their access log.
 * Owner and Admin only (`share`, PRD §4.3): every route is guarded by the matrix row and the use case runs
 * `can()` again as the authority (C13). The portal that visitors use is another controller. A clear key
 * appears only in the response of the call that generated it (`generatedKeys`, `accessKey`).
 */
@ApiTags('share-links')
@Controller('share-links')
export class ShareLinksController {
  constructor(
    private readonly listShareLinks: ListShareLinks,
    private readonly getShareLink: GetShareLink,
    private readonly createShareLink: CreateShareLink,
    private readonly updateShareLink: UpdateShareLink,
    private readonly revokeShareLink: RevokeShareLink,
    private readonly setAccessKey: SetShareDocumentAccessKey,
    private readonly listAccessLog: ListShareAccessLog,
  ) {}

  @Get()
  @RequiresGrant('share', 'read')
  @ApiOperation({ operationId: 'listShareLinks', summary: 'Share links table' })
  @ApiOkResponse({ type: ShareLinkListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListShareLinksQueryDto,
  ): Promise<ShareLinkListResponseDto> {
    const page = await this.listShareLinks.execute(user, query);
    return { ...page, items: page.items.map(rowResponse) };
  }

  @Post()
  @RequiresGrant('share', 'create')
  @ApiOperation({
    operationId: 'createShareLink',
    summary: 'Create a link; the generated access keys are returned once',
  })
  @ApiBody({ type: ShareLinkFormDto })
  @ApiCreatedResponse({ type: ShareLinkMutationResultDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: ShareLinkFormDto,
  ): Promise<ShareLinkMutationResultDto> {
    return mutationResponse(await this.createShareLink.execute(user, body));
  }

  @Get(':id')
  @RequiresGrant('share', 'read')
  @ApiOperation({
    operationId: 'getShareLink',
    summary: 'One link with its documents and counters',
  })
  @ApiOkResponse({ type: ShareLinkDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ShareLinkIdParamsDto,
  ): Promise<ShareLinkDetailDto> {
    return detailResponse(await this.getShareLink.execute(user, { id: params.id }));
  }

  @Patch(':id')
  @RequiresGrant('share', 'update')
  @ApiOperation({
    operationId: 'updateShareLink',
    summary: 'Edit the whole form of a live link; new keys are returned once',
  })
  @ApiBody({ type: ShareLinkEditDto })
  @ApiOkResponse({ type: ShareLinkMutationResultDto })
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
    @Param() params: ShareLinkIdParamsDto,
    @Body() body: ShareLinkEditDto,
  ): Promise<ShareLinkMutationResultDto> {
    return mutationResponse(await this.updateShareLink.execute(user, { ...body, id: params.id }));
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequiresGrant('share', 'update')
  @ApiOperation({
    operationId: 'revokeShareLink',
    summary: 'Revoke a link: final, the portal answers 404 from then on',
  })
  @ApiOkResponse({ type: ShareLinkDetailDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async revoke(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ShareLinkIdParamsDto,
  ): Promise<ShareLinkDetailDto> {
    return detailResponse(await this.revokeShareLink.execute(user, { id: params.id }));
  }

  @Post(':id/documents/:documentId/access-key')
  @HttpCode(200)
  @RequiresGrant('share', 'update')
  @ApiOperation({
    operationId: 'setShareDocumentAccessKey',
    summary:
      'Generate, regenerate or remove the access key of one document; the key is returned once',
  })
  @ApiBody({ type: SetShareAccessKeyDto })
  @ApiOkResponse({ type: SetShareAccessKeyResultDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async accessKey(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ShareLinkDocumentParamsDto,
    @Body() body: SetShareAccessKeyDto,
  ): Promise<SetShareAccessKeyResultDto> {
    return keyResponse(
      await this.setAccessKey.execute(user, {
        shareLinkId: params.id,
        documentId: params.documentId,
        action: body.action,
      }),
    );
  }

  @Get(':id/access-log')
  @RequiresGrant('share', 'read')
  @ApiOperation({ operationId: 'listShareAccessLog', summary: 'Access table of one link' })
  @ApiOkResponse({ type: ShareAccessLogResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async accessLog(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ShareLinkIdParamsDto,
    @Query() query: ListShareAccessLogQueryDto,
  ): Promise<ShareAccessLogResponseDto> {
    const page = await this.listAccessLog.execute(user, { shareLinkId: params.id, query });
    return { ...page, items: page.items.map(logResponse) };
  }
}
