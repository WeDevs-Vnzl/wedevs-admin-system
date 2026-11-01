import { Module } from '@nestjs/common';
import { ENTITY_METRICS_READ } from './application/ports/entity-metrics-read.port';
import { FINANCE_FACTS_READ } from './application/ports/finance-facts-read.port';
import { PrismaEntityMetricsRead } from './infrastructure/prisma-entity-metrics-read';
import { PrismaFinanceFactsRead } from './infrastructure/prisma-finance-facts-read';

/** The one binding of the aggregate read ports; the shell, overview and report modules import it. */
@Module({
  providers: [
    { provide: FINANCE_FACTS_READ, useClass: PrismaFinanceFactsRead },
    { provide: ENTITY_METRICS_READ, useClass: PrismaEntityMetricsRead },
  ],
  exports: [FINANCE_FACTS_READ, ENTITY_METRICS_READ],
})
export class FinanceReadModule {}
