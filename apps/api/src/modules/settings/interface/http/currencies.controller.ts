import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { CreateCurrency } from '../../application/use-cases/create-currency.use-case';
import { ListCurrencies } from '../../application/use-cases/list-currencies.use-case';
import { UpdateCurrency } from '../../application/use-cases/update-currency.use-case';
import {
  CreateCurrencyDto,
  CurrencyResponseDto,
  IncludeInactiveQueryDto,
  UpdateCurrencyDto,
} from './dto/currencies.dto';

type CurrencyOutput = Awaited<ReturnType<CreateCurrency['execute']>>;

@ApiTags('settings')
@Controller('currencies')
export class CurrenciesController {
  constructor(
    @Inject(ListCurrencies) private readonly listCurrencies: ListCurrencies,
    @Inject(CreateCurrency) private readonly createCurrency: CreateCurrency,
    @Inject(UpdateCurrency) private readonly updateCurrency: UpdateCurrency,
  ) {}

  @Authenticated()
  @Get()
  @ApiOperation({
    operationId: 'listCurrencies',
    summary: 'Currencies (active by default; every row with includeInactive)',
  })
  @ApiOkResponse({ description: 'The currencies, USD first', type: [CurrencyResponseDto] })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: IncludeInactiveQueryDto,
  ): Promise<CurrencyResponseDto[]> {
    const rows = await this.listCurrencies.execute(user, query);
    return rows.map(toResponse);
  }

  @RequiresGrant('settings', 'create')
  @Post()
  @ApiOperation({ operationId: 'createCurrency', summary: 'Add a currency (settings grant)' })
  @ApiBody({ type: CreateCurrencyDto })
  @ApiCreatedResponse({ description: 'The created currency', type: CurrencyResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreateCurrencyDto,
  ): Promise<CurrencyResponseDto> {
    return toResponse(await this.createCurrency.execute(user, body));
  }

  @RequiresGrant('settings', 'update')
  @Patch(':code')
  @ApiOperation({
    operationId: 'updateCurrency',
    summary: 'Edit a currency, incl. its active flag (settings grant)',
  })
  @ApiBody({ type: UpdateCurrencyDto })
  @ApiOkResponse({ description: 'The saved currency', type: CurrencyResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'INTERNAL')
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Param('code') code: string,
    @Body() body: UpdateCurrencyDto,
  ): Promise<CurrencyResponseDto> {
    return toResponse(await this.updateCurrency.execute(user, code, body));
  }
}

function toResponse(currency: CurrencyOutput): CurrencyResponseDto {
  return {
    code: currency.code,
    name: currency.name,
    symbol: currency.symbol,
    decimals: currency.decimals,
    active: currency.active,
  };
}
