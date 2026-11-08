import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FEATURES } from '../../../../config/config.module';
import type { FeaturesView } from '../../../../config/env.schema';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { NotFoundError, ValidationFailedError } from '../../../../shared/domain';
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

/** Field error for a mapping of a provider whose feature flag is off (DT-227). */
export const INTEGRATION_DISABLED_MESSAGE = 'integrations.mapping.disabled';

/**
 * Where provider money lands (DT-183, DT-184): `settings` `read` to see it, `settings` `update` to change it.
 * With Stripe and Binance both off (DT-227) both routes answer 404 `NOT_FOUND`; with one off, a mapping for it is
 * refused with `VALIDATION`.
 */
@ApiTags('settings')
@Controller('settings/integrations')
export class SettingsIntegrationsController {
  constructor(
    private readonly getMapping: GetIntegrationMapping,
    private readonly updateMapping: UpdateIntegrationMapping,
    @Inject(FEATURES) private readonly features: FeaturesView,
  ) {}

  private assertAnyEnabled(): void {
    if (!this.features.stripe && !this.features.binance) throw new NotFoundError();
  }

  @Get()
  @RequiresGrant('settings', 'read')
  @ApiOperation({
    operationId: 'getIntegrationMapping',
    summary: 'Stripe target account and method, Binance wallet account',
  })
  @ApiOkResponse({ type: IntegrationMappingResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async get(@CurrentUser() user: CurrentUserModel): Promise<IntegrationMappingResponseDto> {
    this.assertAnyEnabled();
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
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'INTERNAL')
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: UpdateIntegrationMappingDto,
  ): Promise<IntegrationMappingResponseDto> {
    this.assertAnyEnabled();
    const fieldErrors: Record<string, string[]> = {};
    if (body.stripe && !this.features.stripe) fieldErrors.stripe = [INTEGRATION_DISABLED_MESSAGE];
    if (body.binance && !this.features.binance) fieldErrors.binance = [INTEGRATION_DISABLED_MESSAGE];
    if (Object.keys(fieldErrors).length > 0) throw new ValidationFailedError({ fieldErrors });
    return toMappingResponse(await this.updateMapping.execute(user, body));
  }
}
