import { Module } from '@nestjs/common';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import { AUTHORIZATION, CLOCK } from '../../shared/application/ports/tokens';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import {
  EXCHANGE_RATE,
  type ExchangeRatePort,
} from '../finance/application/ports/exchange-rate.port';
import { RatesModule } from '../finance/rates.module';
import {
  DASHBOARD_PANELS_READ,
  type DashboardPanelsReadPort,
} from './application/ports/dashboard-panels-read.port';
import {
  ENTITY_METRICS_READ,
  type EntityMetricsReadPort,
} from './application/ports/entity-metrics-read.port';
import {
  FINANCE_FACTS_READ,
  type FinanceFactsReadPort,
} from './application/ports/finance-facts-read.port';
import { GetClientSummary } from './application/use-cases/dashboard/get-client-summary.use-case';
import { GetDashboard } from './application/use-cases/dashboard/get-dashboard.use-case';
import { GetProjectSummary } from './application/use-cases/dashboard/get-project-summary.use-case';
import { GetShell } from './application/use-cases/dashboard/get-shell.use-case';
import { ListAlerts } from './application/use-cases/alerts/list-alerts.use-case';
import { AlertsModule } from './alerts.module';
import { FinanceReadModule } from './finance-read.module';
import { PrismaDashboardPanelsRead } from './infrastructure/prisma-dashboard-panels-read';
import { DashboardController } from './interface/http/dashboard.controller';
import { ShellController } from './interface/http/shell.controller';
import { SummariesController } from './interface/http/summaries.controller';

/**
 * `/shell`, `/dashboard` and the client and project summaries (PRD §8.1, §8.2, §8.4.4). Consumes the
 * aggregate read ports from `FinanceReadModule` (their only binding), `ListAlerts` from `AlertsModule` and
 * the exchange-rate port from `RatesModule`; none is bound again here. The only binding of
 * `DASHBOARD_PANELS_READ`. Wired into `AppModule` by package 6.1.
 */
@Module({
  imports: [SharedInterfaceModule, FinanceReadModule, AlertsModule, RatesModule],
  controllers: [ShellController, DashboardController, SummariesController],
  providers: [
    { provide: DASHBOARD_PANELS_READ, useClass: PrismaDashboardPanelsRead },
    {
      provide: GetShell,
      useFactory: (alerts: ListAlerts, rates: ExchangeRatePort, clock: ClockPort) =>
        new GetShell(alerts, rates, clock),
      inject: [ListAlerts, EXCHANGE_RATE, CLOCK],
    },
    {
      provide: GetDashboard,
      useFactory: (
        authorization: AuthorizationPort,
        facts: FinanceFactsReadPort,
        metrics: EntityMetricsReadPort,
        panels: DashboardPanelsReadPort,
        rates: ExchangeRatePort,
        clock: ClockPort,
      ) => new GetDashboard(authorization, facts, metrics, panels, rates, clock),
      inject: [
        AUTHORIZATION,
        FINANCE_FACTS_READ,
        ENTITY_METRICS_READ,
        DASHBOARD_PANELS_READ,
        EXCHANGE_RATE,
        CLOCK,
      ],
    },
    {
      provide: GetClientSummary,
      useFactory: (
        authorization: AuthorizationPort,
        panels: DashboardPanelsReadPort,
        facts: FinanceFactsReadPort,
        clock: ClockPort,
      ) => new GetClientSummary(authorization, panels, facts, clock),
      inject: [AUTHORIZATION, DASHBOARD_PANELS_READ, FINANCE_FACTS_READ, CLOCK],
    },
    {
      provide: GetProjectSummary,
      useFactory: (authorization: AuthorizationPort, panels: DashboardPanelsReadPort) =>
        new GetProjectSummary(authorization, panels),
      inject: [AUTHORIZATION, DASHBOARD_PANELS_READ],
    },
  ],
})
export class DashboardModule {}
