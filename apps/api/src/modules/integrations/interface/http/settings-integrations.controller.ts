import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import {
  GetIntegrationMapping,
  UpdateIntegrationMapping,
} from '../../../settings/application/integration-mapping.use-cases';
import {
  IntegrationMappingResponseDto,
  UpdateIntegrationMappingDto,
  toMappingResponse,
} from './settings-integrations.dto';

/** Where provider money lands (DT-183, DT-184): `settings` `read` to see it, `settings` `update` to change it. */
@ApiTags('settings')
@Controller('settings/integrations')
export class SettingsIntegrationsController {
  constructor(
    private readonly getMapping: GetIntegrationMapping,
    private readonly updateMapping: UpdateIntegrationMapping,
  ) {}

  @Get()
  @RequiresGrant('settings', 'read')
  @ApiOperation({
    operationId: 'getIntegrationMapping',
    summary: 'Stripe target account and method, Binance wallet account',
  })
  @ApiOkResponse({ type: IntegrationMappingResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'INTERNAL')
  async get(@CurrentUser() user: CurrentUserModel): Promise<IntegrationMappingResponseDto> {
    return toMappingResponse(await this.getMapping.execute(user));
  }

  @Put()
  @RequiresGrant('settings', 'update')
  @ApiOperation({
    operationId: 'updateIntegrationMapping',
    summary: 'Replace the integration mapping (settings grant)',
  })
  @ApiBody({ type: UpdateIntegrationMappingDto })
  @ApiOkResponse({ type: IntegrationMappingResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: UpdateIntegrationMappingDto,
  ): Promise<IntegrationMappingResponseDto> {
    return toMappingResponse(await this.updateMapping.execute(user, body));
  }
}
