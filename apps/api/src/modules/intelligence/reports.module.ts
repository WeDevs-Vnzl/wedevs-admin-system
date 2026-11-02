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
  FINANCE_FACTS_READ,
  type FinanceFactsReadPort,
} from './application/ports/finance-facts-read.port';
import {
  REPORT_INPUTS_READ,
  type ReportInputsReadPort,
} from './application/ports/report-inputs-read.port';
import { GetKpis } from './application/use-cases/reports/get-kpis.use-case';
import { GetReport } from './application/use-cases/reports/get-report.use-case';
import { FinanceReadModule } from './finance-read.module';
import { PrismaReportInputsRead } from './infrastructure/prisma-report-inputs-read';
import { ReportsController } from './interface/http/reports.controller';

/**
 * Reports and KPIs (PRD §8.13, HU-31): the only place that binds `REPORT_INPUTS_READ`. The facts port comes
 * from `FinanceReadModule` (its one binding, never bound again) and the rate for the accounts balance from
 * `RatesModule`. Wired into `AppModule` by package 6.1; `AUTHORIZATION` and `CLOCK` come from the global
 * modules.
 */
@Module({
  imports: [SharedInterfaceModule, FinanceReadModule, RatesModule],
  controllers: [ReportsController],
  providers: [
    { provide: REPORT_INPUTS_READ, useClass: PrismaReportInputsRead },
    {
      provide: GetReport,
      useFactory: (
        authorization: AuthorizationPort,
        facts: FinanceFactsReadPort,
        inputs: ReportInputsReadPort,
        clock: ClockPort,
      ) => new GetReport(authorization, facts, inputs, clock),
      inject: [AUTHORIZATION, FINANCE_FACTS_READ, REPORT_INPUTS_READ, CLOCK],
    },
    {
      provide: GetKpis,
      useFactory: (
        authorization: AuthorizationPort,
        facts: FinanceFactsReadPort,
        inputs: ReportInputsReadPort,
        rates: ExchangeRatePort,
        clock: ClockPort,
      ) => new GetKpis(authorization, facts, inputs, rates, clock),
      inject: [AUTHORIZATION, FINANCE_FACTS_READ, REPORT_INPUTS_READ, EXCHANGE_RATE, CLOCK],
    },
  ],
})
export class ReportsModule {}
