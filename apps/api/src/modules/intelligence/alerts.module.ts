import { Module } from '@nestjs/common';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import { AUTHORIZATION, CLOCK, ID_GENERATOR } from '../../shared/application/ports/tokens';
import { TransactionHost } from '../../shared/infrastructure/prisma/transaction-host';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import {
  ALERT_SOURCES_READ,
  type AlertSourcesReadPort,
} from './application/ports/alert-sources-read.port';
import {
  ALERT_STATE_REPOSITORY,
  type AlertStateRepository,
} from './application/ports/alert-state.repository.port';
import { DismissAlert } from './application/use-cases/alerts/dismiss-alert.use-case';
import { ListAlerts } from './application/use-cases/alerts/list-alerts.use-case';
import { MarkAlertsRead } from './application/use-cases/alerts/mark-alerts-read.use-case';
import { RestoreAlert } from './application/use-cases/alerts/restore-alert.use-case';
import { PrismaAlertSourcesRead } from './infrastructure/prisma-alert-sources-read';
import { PrismaAlertStateRepository } from './infrastructure/prisma-alert-state.repository';
import { AlertsController } from './interface/http/alerts.controller';

/**
 * The alerts of PRD §7.9 (`/alerts`): the only place that binds `ALERT_SOURCES_READ` and
 * `ALERT_STATE_REPOSITORY`. `ListAlerts` is exported for `/shell` (package 3.1). Wired into `AppModule` by
 * package 6.1; `AUTHORIZATION`, `CLOCK` and `ID_GENERATOR` come from the global modules.
 */
@Module({
  imports: [SharedInterfaceModule],
  controllers: [AlertsController],
  providers: [
    { provide: ALERT_SOURCES_READ, useClass: PrismaAlertSourcesRead },
    {
      provide: ALERT_STATE_REPOSITORY,
      useFactory: (tx: TransactionHost, ids: IdGeneratorPort) =>
        new PrismaAlertStateRepository(tx, ids),
      inject: [TransactionHost, ID_GENERATOR],
    },
    {
      provide: ListAlerts,
      useFactory: (
        authorization: AuthorizationPort,
        sources: AlertSourcesReadPort,
        states: AlertStateRepository,
        clock: ClockPort,
      ) => new ListAlerts(authorization, sources, states, clock),
      inject: [AUTHORIZATION, ALERT_SOURCES_READ, ALERT_STATE_REPOSITORY, CLOCK],
    },
    {
      provide: MarkAlertsRead,
      useFactory: (
        authorization: AuthorizationPort,
        states: AlertStateRepository,
        clock: ClockPort,
      ) => new MarkAlertsRead(authorization, states, clock),
      inject: [AUTHORIZATION, ALERT_STATE_REPOSITORY, CLOCK],
    },
    {
      provide: DismissAlert,
      useFactory: (
        authorization: AuthorizationPort,
        states: AlertStateRepository,
        clock: ClockPort,
      ) => new DismissAlert(authorization, states, clock),
      inject: [AUTHORIZATION, ALERT_STATE_REPOSITORY, CLOCK],
    },
    {
      provide: RestoreAlert,
      useFactory: (
        authorization: AuthorizationPort,
        states: AlertStateRepository,
        clock: ClockPort,
      ) => new RestoreAlert(authorization, states, clock),
      inject: [AUTHORIZATION, ALERT_STATE_REPOSITORY, CLOCK],
    },
  ],
  exports: [ListAlerts],
})
export class AlertsModule {}
