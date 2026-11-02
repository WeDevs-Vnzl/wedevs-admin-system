import { Module } from '@nestjs/common';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import { ExportSourceRegistry } from '../../shared/application/ports/export-source.port';
import { ACTIVITY_LOG, CLOCK, UNIT_OF_WORK } from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { ExportCsv } from './application/use-cases/exports/export-csv.use-case';
import { ExportsController } from './interface/http/exports.controller';

/**
 * Server CSV export (PRD §7.3, DT-171). Owns no table: each context registers its `ExportSource` in
 * `ExportSourceRegistry` from its own `onModuleInit`. Not imported by `AppModule` before package 6.1.
 */
@Module({
  imports: [SharedInterfaceModule],
  controllers: [ExportsController],
  providers: [
    {
      provide: ExportCsv,
      useFactory: (
        registry: ExportSourceRegistry,
        uow: UnitOfWorkPort,
        activity: ActivityLogPort,
        clock: ClockPort,
      ) => new ExportCsv(registry, uow, activity, clock),
      inject: [ExportSourceRegistry, UNIT_OF_WORK, ACTIVITY_LOG, CLOCK],
    },
  ],
  exports: [ExportCsv],
})
export class ExportsModule {}
