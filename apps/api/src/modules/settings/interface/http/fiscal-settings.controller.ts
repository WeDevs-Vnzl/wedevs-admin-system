import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { GetFiscalSettings } from '../../application/use-cases/get-fiscal-settings.use-case';
import { UpdateFiscalSettings } from '../../application/use-cases/update-fiscal-settings.use-case';
import { FiscalSettingsResponseDto, UpdateFiscalSettingsDto } from './dto/fiscal-settings.dto';

type FiscalSettingsOutput = Awaited<ReturnType<UpdateFiscalSettings['execute']>>;

@ApiTags('settings')
@Controller('settings/fiscal')
export class FiscalSettingsController {
  constructor(
    @Inject(GetFiscalSettings) private readonly getFiscalSettings: GetFiscalSettings,
    @Inject(UpdateFiscalSettings) private readonly updateFiscalSettings: UpdateFiscalSettings,
  ) {}

  @Authenticated()
  @Get()
  @ApiOperation({
    operationId: 'getFiscalSettings',
    summary: 'Fiscal parameters: VAT rates, default rate, IGTF, due days (any signed-in user)',
  })
  @ApiOkResponse({ description: 'The fiscal parameters', type: FiscalSettingsResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'INTERNAL')
  async get(@CurrentUser() user: CurrentUserModel): Promise<FiscalSettingsResponseDto> {
    return toResponse(await this.getFiscalSettings.execute(user));
  }

  @RequiresGrant('settings', 'update')
  @Patch()
  @ApiOperation({
    operationId: 'updateFiscalSettings',
    summary: 'Replace the fiscal parameters (settings grant)',
  })
  @ApiBody({ type: UpdateFiscalSettingsDto })
  @ApiOkResponse({ description: 'The saved fiscal parameters', type: FiscalSettingsResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: UpdateFiscalSettingsDto,
  ): Promise<FiscalSettingsResponseDto> {
    return toResponse(await this.updateFiscalSettings.execute(user, body));
  }
}

function toResponse(settings: FiscalSettingsOutput): FiscalSettingsResponseDto {
  return {
    ivaRates: [...settings.ivaRates],
    ivaDefaultRate: settings.ivaDefaultRate,
    igtfRate: settings.igtfRate,
    igtfCurrencies: [...settings.igtfCurrencies],
    invoiceDefaultDueDays: settings.invoiceDefaultDueDays,
  };
}
