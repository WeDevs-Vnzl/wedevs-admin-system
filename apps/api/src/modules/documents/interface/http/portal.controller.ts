import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { Public } from '../../../../shared/interface/public.decorator';
import { GetSharedDocumentDelivery } from '../../application/use-cases/portal/get-shared-document-delivery.use-case';
import { GetSharedDocument } from '../../application/use-cases/portal/get-shared-document.use-case';
import type { PortalVisitor } from '../../application/use-cases/portal/portal-support';
import { RecordShareView } from '../../application/use-cases/portal/record-share-view.use-case';
import { ResolveShareToken } from '../../application/use-cases/portal/resolve-share-token.use-case';
import { UnlockSharedDocument } from '../../application/use-cases/portal/unlock-shared-document.use-case';
import {
  PortalDocumentParamsDto,
  PortalDocumentViewDto,
  PortalFileQueryDto,
  PortalShareDto,
  PortalTokenParamsDto,
  RecordViewDto,
  RecordViewResultDto,
  UnlockDocumentDto,
  UnlockDocumentResultDto,
} from './dto/portal.dto';
import { PortalThrottlerGuard } from './portal-throttler.guard';
import { readUnlockCookie, unlockSetCookie } from './unlock-cookie';

/** The request IP follows `TRUST_PROXY_HOPS` (DT-143); the cookie is the only source of "unlocked". */
function visitorOf(req: Request): PortalVisitor {
  const agent = req.headers['user-agent'];
  return {
    ip: req.ip ?? 'unknown',
    userAgent: typeof agent === 'string' ? agent : undefined,
    unlockCookie: readUnlockCookie(req.headers.cookie),
  };
}

/**
 * The public portal (PRD §8.11, HU-22; C22, C24): the only unauthenticated surface besides health and webhooks.
 * Every route is `@Public()`, runs behind the portal throttler and carries the C22 headers (set by the
 * middleware `PortalModule` binds to this controller). The token in the path is the authority (DT-84):
 * unknown, malformed, revoked or expired tokens, and a document outside the link, are one bare `NOT_FOUND`.
 */
@ApiTags('portal')
@Public()
@UseGuards(PortalThrottlerGuard)
@Controller('portal')
export class PortalController {
  constructor(
    private readonly resolveShareToken: ResolveShareToken,
    private readonly recordShareView: RecordShareView,
    private readonly unlockSharedDocument: UnlockSharedDocument,
    private readonly getSharedDocument: GetSharedDocument,
    private readonly getDelivery: GetSharedDocumentDelivery,
  ) {}

  @Get(':token')
  @ApiOperation({
    operationId: 'resolvePortalToken',
    summary: 'The portal page of a share link (no side effect, no log row)',
  })
  @ApiOkResponse({ type: PortalShareDto })
  @ApiErrorResponses('NOT_FOUND', 'RATE_LIMITED', 'INTERNAL')
  async resolve(
    @Param() params: PortalTokenParamsDto,
    @Req() req: Request,
  ): Promise<PortalShareDto> {
    const share = await this.resolveShareToken.execute({
      token: params.token,
      visitor: visitorOf(req),
    });
    return { ...share, documents: [...share.documents] };
  }

  @Post(':token/views')
  @ApiOperation({
    operationId: 'recordPortalView',
    summary: 'Logs a VIEW of the link, or of one of its documents',
  })
  @ApiBody({ type: RecordViewDto })
  @ApiCreatedResponse({ type: RecordViewResultDto })
  @ApiErrorResponses('NOT_FOUND', 'VALIDATION', 'RATE_LIMITED', 'INTERNAL')
  recordView(
    @Param() params: PortalTokenParamsDto,
    @Body() body: RecordViewDto,
    @Req() req: Request,
  ): Promise<RecordViewResultDto> {
    return this.recordShareView.execute({
      token: params.token,
      documentId: body.documentId,
      visitor: visitorOf(req),
    });
  }

  @Post(':token/documents/:documentId/unlock')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'unlockPortalDocument',
    summary: 'Checks the access key of a document; a right key sets the signed unlock cookie',
  })
  @ApiBody({ type: UnlockDocumentDto })
  @ApiOkResponse({ type: UnlockDocumentResultDto })
  @ApiErrorResponses(
    'NOT_FOUND',
    'VALIDATION',
    'ACCESS_KEY_INVALID',
    'ACCESS_KEY_LOCKED',
    'RATE_LIMITED',
    'INTERNAL',
  )
  async unlock(
    @Param() params: PortalDocumentParamsDto,
    @Body() body: UnlockDocumentDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UnlockDocumentResultDto> {
    const result = await this.unlockSharedDocument.execute({
      token: params.token,
      documentId: params.documentId,
      key: body.key,
      visitor: visitorOf(req),
    });
    if (result.unlockCookie !== null) {
      res.setHeader('Set-Cookie', unlockSetCookie(params.token, result.unlockCookie));
    }
    return { documentId: result.documentId, unlocked: true };
  }

  @Get(':token/documents/:documentId')
  @ApiOperation({
    operationId: 'getPortalDocument',
    summary: 'What the viewer renders for one document; a locked one is FORBIDDEN',
  })
  @ApiOkResponse({ type: PortalDocumentViewDto })
  @ApiErrorResponses('NOT_FOUND', 'FORBIDDEN', 'RATE_LIMITED', 'INTERNAL')
  get(
    @Param() params: PortalDocumentParamsDto,
    @Req() req: Request,
  ): Promise<PortalDocumentViewDto> {
    return this.getSharedDocument.execute({
      token: params.token,
      documentId: params.documentId,
      visitor: visitorOf(req),
    });
  }

  @Get(':token/files/:documentId')
  @ApiOperation({
    operationId: 'getPortalFile',
    summary:
      'Delivers a document: 302 to a signed 5-minute URL or to the stored link, or the markdown as text/markdown. DOWNLOAD is logged only for attachment',
  })
  @ApiResponse({ status: 200, description: 'Markdown body (text/markdown; charset=utf-8)' })
  @ApiResponse({ status: 302, description: 'Redirect to the signed file URL or the stored link' })
  @ApiErrorResponses('NOT_FOUND', 'FORBIDDEN', 'VALIDATION', 'RATE_LIMITED', 'INTERNAL')
  async file(
    @Param() params: PortalDocumentParamsDto,
    @Query() query: PortalFileQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const delivery = await this.getDelivery.execute({
      token: params.token,
      documentId: params.documentId,
      disposition: query.disposition,
      visitor: visitorOf(req),
    });
    if (delivery.kind === 'redirect') {
      res.redirect(302, delivery.url);
      return;
    }
    res
      .status(200)
      .setHeader('Content-Type', 'text/markdown; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `${delivery.attachment ? 'attachment' : 'inline'}; filename="${delivery.fileName}"`,
      )
      .setHeader('X-Content-Type-Options', 'nosniff')
      .setHeader('Content-Security-Policy', 'sandbox')
      .send(delivery.body);
  }
}
