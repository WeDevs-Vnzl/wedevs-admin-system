import { Module } from '@nestjs/common';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import { AUTHORIZATION, CLOCK } from '../../shared/application/ports/tokens';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import { ClientsModule } from '../commercial/clients.module';
import { ListClients } from '../commercial/application/use-cases/list-clients.use-case';
import { ListProjects } from '../commercial/application/use-cases/list-projects.use-case';
import { ProjectsModule } from '../commercial/projects.module';
import { DocumentViews } from '../documents/application/document-support';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from '../documents/application/ports/document.repository.port';
import { ListDocuments } from '../documents/application/use-cases/records/list-documents.use-case';
import { DocumentRecordsModule } from '../documents/document-records.module';
import { ListAccounts } from '../finance/application/use-cases/accounts/list-accounts.use-case';
import { ListExpenses } from '../finance/application/use-cases/expenses/list-expenses.use-case';
import { AccountsModule } from '../finance/accounts.module';
import { ExpensesModule } from '../finance/expenses.module';
import {
  ENTITY_METRICS_READ,
  type EntityMetricsReadPort,
} from './application/ports/entity-metrics-read.port';
import {
  FINANCE_FACTS_READ,
  type FinanceFactsReadPort,
} from './application/ports/finance-facts-read.port';
import { OVERVIEW_READ, type OverviewReadPort } from './application/ports/overview-read.port';
import { GetAccountsOverview } from './application/use-cases/overviews/get-accounts-overview.use-case';
import { GetActivityOverview } from './application/use-cases/overviews/get-activity-overview.use-case';
import { GetClientsOverview } from './application/use-cases/overviews/get-clients-overview.use-case';
import { GetDocumentsOverview } from './application/use-cases/overviews/get-documents-overview.use-case';
import { GetExpensesOverview } from './application/use-cases/overviews/get-expenses-overview.use-case';
import { GetInvoicesOverview } from './application/use-cases/overviews/get-invoices-overview.use-case';
import { GetPaymentsOverview } from './application/use-cases/overviews/get-payments-overview.use-case';
import { GetProjectsOverview } from './application/use-cases/overviews/get-projects-overview.use-case';
import { FinanceReadModule } from './finance-read.module';
import { PrismaOverviewRead } from './infrastructure/prisma-overview-read';
import { OverviewsController } from './interface/http/overviews.controller';

/** The rows of the documents list, built once with the owner's repository and views. */
const DOCUMENT_ROWS = Symbol('DOCUMENT_ROWS');

/**
 * The `/{module}/overview` routes. Aggregates come from `FinanceReadModule` (the only binding of the facts
 * and metrics ports) and `OVERVIEW_READ`; list rows come from the owners' own list use cases, so chips and
 * money gates are decided once. `ListDocuments` is not exported by `DocumentRecordsModule`, so it is built
 * here from the repository and `DocumentViews` that module does export. Not imported by `AppModule` before
 * package 6.1, which must list the intelligence module before the contexts so `/x/overview` registers ahead
 * of `/x/:id` (A1).
 */
@Module({
  imports: [
    SharedInterfaceModule,
    FinanceReadModule,
    ClientsModule,
    ProjectsModule,
    ExpensesModule,
    AccountsModule,
    DocumentRecordsModule,
  ],
  controllers: [OverviewsController],
  providers: [
    { provide: OVERVIEW_READ, useClass: PrismaOverviewRead },
    {
      provide: DOCUMENT_ROWS,
      useFactory: (
        authorization: AuthorizationPort,
        documents: DocumentRepository,
        views: DocumentViews,
        clock: ClockPort,
      ) => new ListDocuments(authorization, documents, views, clock),
      inject: [AUTHORIZATION, DOCUMENT_REPOSITORY, DocumentViews, CLOCK],
    },
    {
      provide: GetClientsOverview,
      useFactory: (
        authorization: AuthorizationPort,
        clients: ListClients,
        metrics: EntityMetricsReadPort,
        facts: FinanceFactsReadPort,
        clock: ClockPort,
      ) => new GetClientsOverview(authorization, clients, metrics, facts, clock),
      inject: [AUTHORIZATION, ListClients, ENTITY_METRICS_READ, FINANCE_FACTS_READ, CLOCK],
    },
    {
      provide: GetProjectsOverview,
      useFactory: (
        authorization: AuthorizationPort,
        projects: ListProjects,
        metrics: EntityMetricsReadPort,
        overview: OverviewReadPort,
        clock: ClockPort,
      ) => new GetProjectsOverview(authorization, projects, metrics, overview, clock),
      inject: [AUTHORIZATION, ListProjects, ENTITY_METRICS_READ, OVERVIEW_READ, CLOCK],
    },
    {
      provide: GetInvoicesOverview,
      useFactory: (
        authorization: AuthorizationPort,
        facts: FinanceFactsReadPort,
        overview: OverviewReadPort,
        clock: ClockPort,
      ) => new GetInvoicesOverview(authorization, facts, overview, clock),
      inject: [AUTHORIZATION, FINANCE_FACTS_READ, OVERVIEW_READ, CLOCK],
    },
    {
      provide: GetPaymentsOverview,
      useFactory: (
        authorization: AuthorizationPort,
        facts: FinanceFactsReadPort,
        overview: OverviewReadPort,
        clock: ClockPort,
      ) => new GetPaymentsOverview(authorization, facts, overview, clock),
      inject: [AUTHORIZATION, FINANCE_FACTS_READ, OVERVIEW_READ, CLOCK],
    },
    {
      provide: GetExpensesOverview,
      useFactory: (
        authorization: AuthorizationPort,
        facts: FinanceFactsReadPort,
        overview: OverviewReadPort,
        expenses: ListExpenses,
        clock: ClockPort,
      ) => new GetExpensesOverview(authorization, facts, overview, expenses, clock),
      inject: [AUTHORIZATION, FINANCE_FACTS_READ, OVERVIEW_READ, ListExpenses, CLOCK],
    },
    {
      provide: GetAccountsOverview,
      useFactory: (authorization: AuthorizationPort, accounts: ListAccounts) =>
        new GetAccountsOverview(authorization, accounts),
      inject: [AUTHORIZATION, ListAccounts],
    },
    {
      provide: GetDocumentsOverview,
      useFactory: (
        authorization: AuthorizationPort,
        documents: ListDocuments,
        overview: OverviewReadPort,
        clock: ClockPort,
      ) => new GetDocumentsOverview(authorization, documents, overview, clock),
      inject: [AUTHORIZATION, DOCUMENT_ROWS, OVERVIEW_READ, CLOCK],
    },
    {
      provide: GetActivityOverview,
      useFactory: (
        authorization: AuthorizationPort,
        overview: OverviewReadPort,
        clock: ClockPort,
      ) => new GetActivityOverview(authorization, overview, clock),
      inject: [AUTHORIZATION, OVERVIEW_READ, CLOCK],
    },
  ],
})
export class OverviewsModule {}
