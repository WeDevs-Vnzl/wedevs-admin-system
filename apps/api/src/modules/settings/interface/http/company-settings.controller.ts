import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import {
  GetCompanySettings,
  type CompanySettingsOutput,
} from '../../application/use-cases/get-company-settings.use-case';
import { UpdateCompanySettings } from '../../application/use-cases/update-company-settings.use-case';
import { CompanySettingsResponseDto, UpdateCompanySettingsDto } from './dto/company-settings.dto';

@ApiTags('settings')
@Controller('settings/company')
export class CompanySettingsController {
  constructor(
    private readonly getCompanySettings: GetCompanySettings,
    private readonly updateCompanySettings: UpdateCompanySettings,
  ) {}

  @Authenticated()
  @Get()
  @ApiOperation({
    operationId: 'getCompanySettings',
    summary: 'Company profile (any signed-in user)',
  })
  @ApiOkResponse({ description: 'The company profile', type: CompanySettingsResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'INTERNAL')
  async get(@CurrentUser() user: CurrentUserModel): Promise<CompanySettingsResponseDto> {
    return toResponse(await this.getCompanySettings.execute(user));
  }

  @RequiresGrant('settings', 'update')
  @Patch()
  @ApiOperation({
    operationId: 'updateCompanySettings',
    summary: 'Replace the company profile (settings grant)',
  })
  @ApiBody({ type: UpdateCompanySettingsDto })
  @ApiOkResponse({ description: 'The saved company profile', type: CompanySettingsResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: UpdateCompanySettingsDto,
  ): Promise<CompanySettingsResponseDto> {
    return toResponse(await this.updateCompanySettings.execute(user, body));
  }
}

function toResponse(profile: CompanySettingsOutput): CompanySettingsResponseDto {
  return {
    name: profile.name,
    legalName: profile.legalName,
    taxId: profile.taxId,
    address: profile.address,
    logoFileId: profile.logoFileId,
  };
}
