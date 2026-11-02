import { Global, Module } from '@nestjs/common';
import {
  ACTIVITY_LOG,
  AUTHENTICATOR,
  AUTHORIZATION,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { APP_LOGGER, type AppLogger } from '../../shared/interface/logger';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import { MatrixAuthorization } from '../identity/infrastructure/matrix-authorization';
import { DocumentRecordsModule } from '../documents/document-records.module';
import { ShareLinksModule } from '../documents/share-links.module';
import { MarkExpiredDocuments } from '../documents/application/use-cases/records/mark-expired-documents.use-case';
import { MarkExpiredShareLinks } from '../documents/application/use-cases/shares/mark-expired-share-links.use-case';
import { PurgeShareAccessLog } from '../documents/application/use-cases/shares/purge-share-access-log.use-case';
import { BillingModule } from '../finance/billing.module';
import { ExpensesModule } from '../finance/expenses.module';
import { InvoicesModule } from '../finance/invoices.module';
import { GenerateRecurringInstallments } from '../finance/application/use-cases/billing/generate-recurring-installments.use-case';
import { GenerateRecurringExpenses } from '../finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import { MarkOverdueInvoices } from '../finance/application/use-cases/invoices/mark-overdue-invoices.use-case';
import { CleanupFiles } from '../platform/application/use-cases/cleanup-files.use-case';
import { PlatformModule } from '../platform/platform.module';
import { DailyMaintenance } from './application/daily-maintenance';
import { JobRunner, type JobFailureLogger } from './application/job-runner';
import { RunCleanupFiles } from './application/run-cleanup-files';
import { RunRetention } from './application/run-retention';
import { JobsRuntime } from './interface/jobs/jobs-runtime';

/**
 * The global `AuthGuard` that `SharedInterfaceModule` provides resolves `AUTHENTICATOR` and `AUTHORIZATION`;
 * the worker serves no request, so it binds the pure permission matrix and an authenticator that accepts no
 * token, instead of importing the Clerk adapters of `IdentityModule`. The steps authorize by actor type.
 */
@Global()
@Module({
  providers: [
    { provide: AUTHORIZATION, useClass: MatrixAuthorization },
    { provide: AUTHENTICATOR, useValue: { authenticate: () => Promise.resolve(null) } },
  ],
  exports: [AUTHORIZATION, AUTHENTICATOR],
})
class WorkerIdentityModule {}

const failureLogger = (logger: AppLogger): JobFailureLogger => ({
  stepFailed: ({ job, step, error }) =>
    logger.error({ job, step, err: error }, 'Scheduled job step failed; the job will be retried'),
});

/**
 * The scheduled jobs (DT-152): composes the exported `SYSTEM` steps of the contexts. Imported only by the
 * worker (`WorkerModule`), never by `AppModule` (DT-169).
 */
@Module({
  imports: [
    WorkerIdentityModule,
    SharedInterfaceModule,
    PlatformModule,
    InvoicesModule,
    BillingModule,
    ExpensesModule,
    DocumentRecordsModule,
    ShareLinksModule,
  ],
  providers: [
    {
      provide: JobRunner,
      useFactory: (uow: UnitOfWorkPort, activity: ActivityLogPort, logger: AppLogger) =>
        new JobRunner(uow, activity, failureLogger(logger)),
      inject: [UNIT_OF_WORK, ACTIVITY_LOG, APP_LOGGER],
    },
    {
      provide: DailyMaintenance,
      useFactory: (
        runner: JobRunner,
        markOverdueInvoices: MarkOverdueInvoices,
        markExpiredDocuments: MarkExpiredDocuments,
        generateRecurringInstallments: GenerateRecurringInstallments,
        generateRecurringExpenses: GenerateRecurringExpenses,
        markExpiredShareLinks: MarkExpiredShareLinks,
      ) =>
        new DailyMaintenance(runner, {
          markOverdueInvoices,
          markExpiredDocuments,
          generateRecurringInstallments,
          generateRecurringExpenses,
          markExpiredShareLinks,
        }),
      inject: [
        JobRunner,
        MarkOverdueInvoices,
        MarkExpiredDocuments,
        GenerateRecurringInstallments,
        GenerateRecurringExpenses,
        MarkExpiredShareLinks,
      ],
    },
    {
      provide: RunRetention,
      useFactory: (runner: JobRunner, purge: PurgeShareAccessLog) =>
        new RunRetention(runner, purge),
      inject: [JobRunner, PurgeShareAccessLog],
    },
    {
      provide: RunCleanupFiles,
      useFactory: (runner: JobRunner, cleanup: CleanupFiles) =>
        new RunCleanupFiles(runner, cleanup),
      inject: [JobRunner, CleanupFiles],
    },
    JobsRuntime,
  ],
  exports: [JobsRuntime, DailyMaintenance, RunRetention, RunCleanupFiles],
})
export class JobsModule {}
