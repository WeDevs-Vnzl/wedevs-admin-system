import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Redirect,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated } from '../../../../shared/interface/grant.decorator';
import { ConfirmUpload } from '../../application/use-cases/confirm-upload.use-case';
import { DeleteFile } from '../../application/use-cases/delete-file.use-case';
import { GetFileDownload } from '../../application/use-cases/get-file-download.use-case';
import { RequestUpload } from '../../application/use-cases/request-upload.use-case';
import {
  ConfirmUploadDto,
  FileIdParamsDto,
  FileResponseDto,
  RequestUploadDto,
  UploadIntentResponseDto,
} from './dto/files.dto';

type ConfirmedFile = Awaited<ReturnType<ConfirmUpload['execute']>>;

function toFileResponse(file: ConfirmedFile): FileResponseDto {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    status: file.status,
    uploadedById: file.uploadedById,
    createdAt: file.createdAt.toISOString(),
  };
}

/**
 * Files (DT-85, `api-contract.md` §6). Every route is `@Authenticated()`: the use cases run `can()` on the
 * resource the file belongs to (Q-BE1-3), so no route-level grant fits.
 */
@ApiTags('files')
@Authenticated()
@Controller('files')
export class FilesController {
  constructor(
    private readonly requestUpload: RequestUpload,
    private readonly confirmUpload: ConfirmUpload,
    private readonly getDownload: GetFileDownload,
    private readonly deleteFile: DeleteFile,
  ) {}

  @Post('upload-intent')
  @ApiOperation({
    operationId: 'requestFileUpload',
    summary: 'Register a PENDING file and get the signed Cloudinary upload parameters',
  })
  @ApiCreatedResponse({ type: UploadIntentResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async intent(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: RequestUploadDto,
  ): Promise<UploadIntentResponseDto> {
    const out = await this.requestUpload.execute(user, body);
    return {
      fileId: out.fileId,
      url: out.url,
      fields: { ...out.fields },
      expiresAt: out.expiresAt.toISOString(),
    };
  }

  @Post()
  @ApiOperation({
    operationId: 'confirmFileUpload',
    summary: 'Verify the uploaded bytes (size, magic-byte type) and mark the file READY',
  })
  @ApiCreatedResponse({ type: FileResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async confirm(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: ConfirmUploadDto,
  ): Promise<FileResponseDto> {
    return toFileResponse(await this.confirmUpload.execute(user, { fileId: body.fileId }));
  }

  @Get(':id/download')
  @Redirect()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'downloadFile',
    summary: 'Redirect (302) to a short-lived signed URL of the file',
  })
  @ApiFoundResponse({ description: 'Location: signed download URL, valid for 60 seconds' })
  @ApiErrorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'INTERNAL')
  async download(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: FileIdParamsDto,
  ): Promise<{ url: string; statusCode: 302 }> {
    const out = await this.getDownload.execute(user, { fileId: params.id });
    return { url: out.url, statusCode: 302 };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteFile',
    summary: 'Delete the caller’s own unattached file (asset destroyed, row soft-deleted)',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'INTEGRITY_LOCK', 'INTERNAL')
  async remove(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: FileIdParamsDto,
  ): Promise<void> {
    await this.deleteFile.execute(user, { fileId: params.id });
  }
}
