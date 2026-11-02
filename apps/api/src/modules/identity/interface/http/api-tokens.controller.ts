import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated } from '../../../../shared/interface/grant.decorator';
import { IssueApiToken } from '../../application/use-cases/api-tokens/issue-api-token.use-case';
import { ListApiTokens } from '../../application/use-cases/api-tokens/list-api-tokens.use-case';
import { RevokeApiToken } from '../../application/use-cases/api-tokens/revoke-api-token.use-case';
import {
  ApiTokenDto,
  ApiTokenIdParamsDto,
  ApiTokenListDto,
  IssueApiTokenDto,
  IssuedApiTokenDto,
  toApiTokenDto,
  toIssuedApiTokenDto,
} from './api-tokens.dto';

/**
 * The caller's own personal access tokens (A9, DT-189): `@Authenticated()` with a Clerk session, own rows only
 * (DT-195). A personal access token cannot manage tokens: it is accepted on `POST /mcp` only (DT-190).
 */
@ApiTags('identity')
@Controller('me/api-tokens')
@Authenticated()
export class ApiTokensController {
  constructor(
    private readonly listApiTokens: ListApiTokens,
    private readonly issueApiToken: IssueApiToken,
    private readonly revokeApiToken: RevokeApiToken,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listMyApiTokens', summary: 'Own personal access tokens' })
  @ApiOkResponse({ type: ApiTokenListDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'INTERNAL')
  async list(@CurrentUser() user: CurrentUserModel): Promise<ApiTokenListDto> {
    return { items: (await this.listApiTokens.execute(user)).map(toApiTokenDto) };
  }

  @Post()
  @ApiOperation({
    operationId: 'issueMyApiToken',
    summary: 'Issue a personal access token (the secret is returned once)',
  })
  @ApiBody({ type: IssueApiTokenDto })
  @ApiCreatedResponse({ type: IssuedApiTokenDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async issue(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: IssueApiTokenDto,
  ): Promise<IssuedApiTokenDto> {
    return toIssuedApiTokenDto(await this.issueApiToken.execute(user, body));
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({ operationId: 'revokeMyApiToken', summary: 'Revoke one own token' })
  @ApiOkResponse({ type: ApiTokenDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async revoke(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ApiTokenIdParamsDto,
  ): Promise<ApiTokenDto> {
    return toApiTokenDto(await this.revokeApiToken.execute(user, { id: params.id }));
  }
}
