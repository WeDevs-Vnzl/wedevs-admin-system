import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated } from '../../../../shared/interface/grant.decorator';
import { DismissAlert } from '../../application/use-cases/alerts/dismiss-alert.use-case';
import {
  ListAlerts,
  type AlertsInboxOutput,
} from '../../application/use-cases/alerts/list-alerts.use-case';
import { MarkAlertsRead } from '../../application/use-cases/alerts/mark-alerts-read.use-case';
import { RestoreAlert } from '../../application/use-cases/alerts/restore-alert.use-case';
import type { AlertOutput } from '../../application/use-cases/alerts/alert-support';
import {
  AlertDismissalResponseDto,
  AlertsInboxResponseDto,
  AlertsReadResponseDto,
  DismissAlertBodyDto,
  ListAlertsQueryDto,
  MarkAlertsReadBodyDto,
} from './alerts.dto';

const toAlertDto = (alert: AlertOutput): AlertsInboxResponseDto['items'][number] => ({
  ...alert,
  entity: alert.entity
    ? {
        type: alert.entity.type,
        id: alert.entity.id,
        code: alert.entity.code ?? null,
        label: alert.entity.label,
      }
    : null,
});

const toInboxDto = (inbox: AlertsInboxOutput): AlertsInboxResponseDto => ({
  ...inbox,
  items: inbox.items.map(toAlertDto),
});

/**
 * The caller's alerts (PRD §7.9). Computed live; the caller's read, dismissed and snoozed state is its own
 * row of `AlertState`. Every route is `@Authenticated()` (DT-79): visibility is by data, in the use cases
 * (finance types by `canSeeFinancials`, documents by `read document`, the rate by `read settings`), and a
 * type the caller cannot see answers `NOT_FOUND` on the write routes (A8, C14). Keys are URL-encoded.
 */
@ApiTags('intelligence')
@Controller('alerts')
@Authenticated()
export class AlertsController {
  constructor(
    private readonly listAlerts: ListAlerts,
    private readonly markAlertsRead: MarkAlertsRead,
    private readonly dismissAlert: DismissAlert,
    private readonly restoreAlert: RestoreAlert,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listAlerts',
    summary: 'Own live alerts with the unread counter, most urgent first',
  })
  @ApiOkResponse({ type: AlertsInboxResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListAlertsQueryDto,
  ): Promise<AlertsInboxResponseDto> {
    const types = query.types === undefined ? undefined : [query.types].flat();
    return toInboxDto(await this.listAlerts.execute(user, { types, limit: query.limit }));
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'markAlertsRead',
    summary: 'Mark up to 200 alerts read (idempotent); they stay listed',
  })
  @ApiOkResponse({ type: AlertsReadResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'VALIDATION', 'INTERNAL')
  markManyRead(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: MarkAlertsReadBodyDto,
  ): Promise<AlertsReadResponseDto> {
    return this.markAlertsRead.execute(user, { alertKeys: body.alertKeys });
  }

  @Post(':key/read')
  @HttpCode(200)
  @ApiOperation({ operationId: 'markAlertRead', summary: 'Mark one alert read (idempotent)' })
  @ApiOkResponse({ type: AlertsReadResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'VALIDATION', 'INTERNAL')
  markRead(
    @CurrentUser() user: CurrentUserModel,
    @Param('key') key: string,
  ): Promise<AlertsReadResponseDto> {
    return this.markAlertsRead.execute(user, { alertKeys: [key] });
  }

  @Post(':key/dismiss')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'dismissAlert',
    summary: 'Dismiss for good, or snooze for `days` (1 to 90)',
  })
  @ApiBody({ type: DismissAlertBodyDto, required: false })
  @ApiOkResponse({ type: AlertDismissalResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'VALIDATION', 'INTERNAL')
  dismiss(
    @CurrentUser() user: CurrentUserModel,
    @Param('key') key: string,
    @Body() body: DismissAlertBodyDto,
  ): Promise<AlertDismissalResponseDto> {
    return this.dismissAlert.execute(user, { alertKey: key, days: body.days });
  }

  @Post(':key/restore')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'restoreAlert',
    summary: 'Undo a dismissal or snooze; keeps the read mark',
  })
  @ApiOkResponse({ type: AlertDismissalResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'VALIDATION', 'INTERNAL')
  restore(
    @CurrentUser() user: CurrentUserModel,
    @Param('key') key: string,
  ): Promise<AlertDismissalResponseDto> {
    return this.restoreAlert.execute(user, { alertKey: key });
  }
}
