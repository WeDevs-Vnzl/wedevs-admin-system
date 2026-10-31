import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { GetRateFor } from '../../application/use-cases/rates/get-rate-for.use-case';
import { ImportRatesCsv } from '../../application/use-cases/rates/import-rates-csv.use-case';
import { ListExchangeRates } from '../../application/use-cases/rates/list-exchange-rates.use-case';
import { LoadDailyRates } from '../../application/use-cases/rates/load-daily-rates.use-case';
import { UpsertExchangeRate } from '../../application/use-cases/rates/upsert-exchange-rate.use-case';
import {
  ExchangeRateListResponseDto,
  ImportRatesDto,
  ImportRatesResponseDto,
  ListExchangeRatesQueryDto,
  LoadDailyRatesDto,
  LoadDailyRatesResponseDto,
  RateLookupQueryDto,
  RateLookupResponseDto,
  UpsertExchangeRateDto,
  UpsertExchangeRateResponseDto,
  toExchangeRateResponse,
  toImportResponse,
  toLookupResponse,
  toUpsertResponse,
} from './dto/exchange-rates.dto';

/**
 * Exchange rates (PRD §8.15, §9.2, DT-67). Managing and listing need the `settings` grant (Owner and Admin);
 * the lookup is a reference read for any signed-in user (DT-71). Writing a rate never changes a snapshot.
 */
@ApiTags('exchange-rates')
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(
    private readonly listRates: ListExchangeRates,
    private readonly getRateFor: GetRateFor,
    private readonly upsertRate: UpsertExchangeRate,
    private readonly loadDailyRates: LoadDailyRates,
    private readonly importRates: ImportRatesCsv,
  ) {}

  @Get()
  @RequiresGrant('settings', 'read')
  @ApiOperation({
    operationId: 'listExchangeRates',
    summary: 'Stored rates, newest date first (settings grant)',
  })
  @ApiOkResponse({ type: ExchangeRateListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListExchangeRatesQueryDto,
  ): Promise<ExchangeRateListResponseDto> {
    const page = await this.listRates.execute(user, query);
    return { ...page, items: page.items.map(toExchangeRateResponse) };
  }

  @Get('lookup')
  @Authenticated()
  @ApiOperation({
    operationId: 'getRateFor',
    summary: 'Rate to prefill for a currency on a date, with every source as an option',
  })
  @ApiOkResponse({ type: RateLookupResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async lookup(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: RateLookupQueryDto,
  ): Promise<RateLookupResponseDto> {
    return toLookupResponse(await this.getRateFor.execute(user, query));
  }

  @Post()
  @HttpCode(200)
  @RequiresGrant('settings', 'update')
  @ApiOperation({
    operationId: 'upsertExchangeRate',
    summary: 'Save the rate of a date, currency and source (settings grant)',
  })
  @ApiBody({ type: UpsertExchangeRateDto })
  @ApiOkResponse({ type: UpsertExchangeRateResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async upsert(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: UpsertExchangeRateDto,
  ): Promise<UpsertExchangeRateResponseDto> {
    return toUpsertResponse(await this.upsertRate.execute(user, body));
  }

  @Post('daily')
  @HttpCode(200)
  @RequiresGrant('settings', 'update')
  @ApiOperation({
    operationId: 'loadDailyRates',
    summary: 'Quick daily load: several currencies for one date and source, all or nothing',
  })
  @ApiBody({ type: LoadDailyRatesDto })
  @ApiOkResponse({ type: LoadDailyRatesResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async daily(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: LoadDailyRatesDto,
  ): Promise<LoadDailyRatesResponseDto> {
    return this.loadDailyRates.execute(user, body);
  }

  @Post('import')
  @HttpCode(200)
  @RequiresGrant('settings', 'update')
  @ApiOperation({
    operationId: 'importExchangeRates',
    summary: 'Import rates from parsed CSV rows, with per-row errors',
  })
  @ApiBody({ type: ImportRatesDto })
  @ApiOkResponse({ type: ImportRatesResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async import(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: ImportRatesDto,
  ): Promise<ImportRatesResponseDto> {
    return toImportResponse(await this.importRates.execute(user, body));
  }
}
