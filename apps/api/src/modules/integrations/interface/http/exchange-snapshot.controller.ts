import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { FEATURES } from '../../../../config/config.module';
import type { FeaturesView } from '../../../../config/env.schema';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { GetExchangeSnapshot } from '../../application/use-cases/exchange/get-exchange-snapshot.use-case';
import {
  ExchangeSnapshotAccountParamsDto,
  ExchangeSnapshotResponseDto,
} from './exchange-snapshot.dto';

/**
 * The last Binance snapshot beside the system balance of the mapped wallet account (DT-184). Owner and Admin
 * (`account` `read`, PRD §4.3). The body is the JSON `null` when the account is not the one the Binance wallet
 * is mapped to, or when Binance is off (choice 3, DT-227: no stale stored snapshot is served).
 */
@ApiTags('integrations')
@Controller('accounts')
export class ExchangeSnapshotController {
  constructor(
    private readonly getSnapshot: GetExchangeSnapshot,
    @Inject(FEATURES) private readonly features: FeaturesView,
  ) {}

  @Get(':id/exchange-snapshot')
  @RequiresGrant('account', 'read')
  @ApiOperation({
    operationId: 'getExchangeSnapshot',
    summary:
      'Last Binance snapshot beside the system balance (null when the account is not the mapped wallet)',
  })
  @ApiOkResponse({ type: ExchangeSnapshotResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ExchangeSnapshotAccountParamsDto,
    @Res() response: Response,
  ): Promise<void> {
    const snapshot = this.features.binance ? await this.getSnapshot.execute(user, params.id) : null;
    response.status(200).json(snapshot);
  }
}
