import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated } from '../../../../shared/interface/grant.decorator';
import { GetCurrentUser } from '../../application/use-cases/get-current-user.use-case';
import { GetPreferences } from '../../application/use-cases/get-preferences.use-case';
import { ResetPreference } from '../../application/use-cases/reset-preference.use-case';
import { SetPreference } from '../../application/use-cases/set-preference.use-case';
import { SetPreferenceDto, UserPreferencesDto } from './dto/me.dto';
import { UserDetailDto } from './dto/users.dto';
import { toUserDetailDto } from './mappers';

/** The caller's own profile and preferences: `@Authenticated()`, own rows only (DT-71). */
@ApiTags('identity')
@Controller('me')
@Authenticated()
export class MeController {
  constructor(
    private readonly getCurrentUser: GetCurrentUser,
    private readonly getPreferences: GetPreferences,
    private readonly setPreference: SetPreference,
    private readonly resetPreference: ResetPreference,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'getMe', summary: 'The authenticated user' })
  @ApiOkResponse({ type: UserDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'INTERNAL')
  async me(@CurrentUser() user: CurrentUserModel): Promise<UserDetailDto> {
    return toUserDetailDto(await this.getCurrentUser.execute(user));
  }

  @Get('preferences')
  @ApiOperation({ operationId: 'getMyPreferences', summary: 'Own preferences' })
  @ApiOkResponse({ type: UserPreferencesDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'INTERNAL')
  preferences(@CurrentUser() user: CurrentUserModel): Promise<UserPreferencesDto> {
    return this.getPreferences.execute(user);
  }

  @Put('preferences/:key')
  @ApiOperation({
    operationId: 'setMyPreference',
    summary: 'Set one own preference (locale, theme, timezone or table:<id>:columns)',
  })
  @ApiOkResponse({ type: UserPreferencesDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  setOne(
    @CurrentUser() user: CurrentUserModel,
    @Param('key') key: string,
    @Body() body: SetPreferenceDto,
  ): Promise<UserPreferencesDto> {
    return this.setPreference.execute(user, { key, value: body.value });
  }

  @Delete('preferences/:key')
  @ApiOperation({
    operationId: 'resetMyPreference',
    summary: 'Reset one own preference so its default applies again',
  })
  @ApiOkResponse({ type: UserPreferencesDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  resetOne(
    @CurrentUser() user: CurrentUserModel,
    @Param('key') key: string,
  ): Promise<UserPreferencesDto> {
    return this.resetPreference.execute(user, { key });
  }
}
