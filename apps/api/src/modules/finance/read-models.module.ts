import { Module } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import {
  ACTIVITY_LOG,
  CLOCK,
  ROW_LOCKS,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { FinanceProjector } from './application/finance-projector';
import { FINANCE_SOURCES, type FinanceSourcesPort } from './application/ports/finance-sources.port';
import {
  READ_MODEL_WRITER,
  type ReadModelWriterPort,
} from './application/ports/read-model-writer.port';
import { RecomputeAll } from './application/recompute-all';
import { PrismaFinanceSources } from './infrastructure/prisma-finance-sources';
import { PrismaReadModelWriter } from './infrastructure/prisma-read-model-writer';

/**
 * Finance read models: the projector every money slice calls inside its unit of work, and the
 * `RecomputeAll` use case behind `scripts/recompute-all.ts`. Shared infrastructure is global.
 */
@Module({
  providers: [
    { provide: FINANCE_SOURCES, useClass: PrismaFinanceSources },
    { provide: READ_MODEL_WRITER, useClass: PrismaReadModelWriter },
    {
      provide: FinanceProjector,
      useFactory: (sources: FinanceSourcesPort, writer: ReadModelWriterPort, clock: ClockPort) =>
        new FinanceProjector(sources, writer, clock),
      inject: [FINANCE_SOURCES, READ_MODEL_WRITER, CLOCK],
    },
    {
      provide: RecomputeAll,
      useFactory: (
        uow: UnitOfWorkPort,
        locks: RowLocksPort,
        sources: FinanceSourcesPort,
        writer: ReadModelWriterPort,
        projector: FinanceProjector,
        activity: ActivityLogPort,
        clock: ClockPort,
      ) => new RecomputeAll(uow, locks, sources, writer, projector, activity, clock),
      inject: [
        UNIT_OF_WORK,
        ROW_LOCKS,
        FINANCE_SOURCES,
        READ_MODEL_WRITER,
        FinanceProjector,
        ACTIVITY_LOG,
        CLOCK,
      ],
    },
  ],
  exports: [FinanceProjector, RecomputeAll],
})
export class ReadModelsModule {}
