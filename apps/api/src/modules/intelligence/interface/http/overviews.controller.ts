import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { GetAccountsOverview } from '../../application/use-cases/overviews/get-accounts-overview.use-case';
import { GetActivityOverview } from '../../application/use-cases/overviews/get-activity-overview.use-case';
import { GetClientsOverview } from '../../application/use-cases/overviews/get-clients-overview.use-case';
import { GetDocumentsOverview } from '../../application/use-cases/overviews/get-documents-overview.use-case';
import { GetExpensesOverview } from '../../application/use-cases/overviews/get-expenses-overview.use-case';
import { GetInvoicesOverview } from '../../application/use-cases/overviews/get-invoices-overview.use-case';
import { GetPaymentsOverview } from '../../application/use-cases/overviews/get-payments-overview.use-case';
import { GetProjectsOverview } from '../../application/use-cases/overviews/get-projects-overview.use-case';
import {
  AccountsOverviewDto,
  ActivityOverviewDto,
  ActivityOverviewQueryDto,
  ClientsOverviewDto,
  DocumentsOverviewDto,
  ExpensesOverviewDto,
  InvoicesOverviewDto,
  PaymentsOverviewDto,
  ProjectsOverviewDto,
  toAccountsOverviewResponse,
  toActivityOverviewResponse,
  toClientsOverviewResponse,
  toDocumentsOverviewResponse,
  toExpensesOverviewResponse,
  toInvoicesOverviewResponse,
  toPaymentsOverviewResponse,
  toProjectsOverviewResponse,
} from './overviews.dto';

/**
 * The `/{module}/overview` routes (PRD §8, DT-113, DT-174, DT-175), one use case each. They sit in
 * `intelligence` and must register before the owners' `/{module}/:id` routes (A1). The route grant is the
 * coarse check; each use case runs `can()` itself and applies the `canSeeFinancials` gate of its lists (C13).
 */
@ApiTags('overviews')
@Controller()
export class OverviewsController {
  constructor(
    private readonly clients: GetClientsOverview,
    private readonly projects: GetProjectsOverview,
    private readonly invoices: GetInvoicesOverview,
    private readonly payments: GetPaymentsOverview,
    private readonly expenses: GetExpensesOverview,
    private readonly accounts: GetAccountsOverview,
    private readonly documents: GetDocumentsOverview,
    private readonly activity: GetActivityOverview,
  ) {}

  @Get('clients/overview')
  @RequiresGrant('client', 'read')
  @ApiOperation({
    operationId: 'getClientsOverview',
    summary: 'Clients overview; lists ranked by money are empty without the financial grant',
  })
  @ApiOkResponse({ type: ClientsOverviewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'INTERNAL')
  async clientsOverview(@CurrentUser() user: CurrentUserModel): Promise<ClientsOverviewDto> {
    return toClientsOverviewResponse(await this.clients.execute(user));
  }

  @Get('projects/overview')
  @RequiresGrant('project', 'read')
  @ApiOperation({
    operationId: 'getProjectsOverview',
    summary: 'Projects overview; highestToInvoice is empty without the financial grant',
  })
  @ApiOkResponse({ type: ProjectsOverviewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'INTERNAL')
  async projectsOverview(@CurrentUser() user: CurrentUserModel): Promise<ProjectsOverviewDto> {
    return toProjectsOverviewResponse(await this.projects.execute(user));
  }

  @Get('invoices/overview')
  @RequiresGrant('invoice', 'read')
  @ApiOperation({
    operationId: 'getInvoicesOverview',
    summary: 'Invoices overview (Owner, Admin)',
  })
  @ApiOkResponse({ type: InvoicesOverviewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'INTERNAL')
  async invoicesOverview(@CurrentUser() user: CurrentUserModel): Promise<InvoicesOverviewDto> {
    return toInvoicesOverviewResponse(await this.invoices.execute(user));
  }

  @Get('payments/overview')
  @RequiresGrant('payment', 'read')
  @ApiOperation({
    operationId: 'getPaymentsOverview',
    summary: 'Payments overview (Owner, Admin)',
  })
  @ApiOkResponse({ type: PaymentsOverviewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'INTERNAL')
  async paymentsOverview(@CurrentUser() user: CurrentUserModel): Promise<PaymentsOverviewDto> {
    return toPaymentsOverviewResponse(await this.payments.execute(user));
  }

  @Get('expenses/overview')
  @RequiresGrant('expense', 'read')
  @ApiOperation({
    operationId: 'getExpensesOverview',
    summary: 'Expenses overview (Owner, Admin)',
  })
  @ApiOkResponse({ type: ExpensesOverviewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'INTERNAL')
  async expensesOverview(@CurrentUser() user: CurrentUserModel): Promise<ExpensesOverviewDto> {
    return toExpensesOverviewResponse(await this.expenses.execute(user));
  }

  @Get('accounts/overview')
  @RequiresGrant('account', 'read')
  @ApiOperation({
    operationId: 'getAccountsOverview',
    summary: 'Accounts overview (Owner, Admin)',
  })
  @ApiOkResponse({ type: AccountsOverviewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'INTERNAL')
  async accountsOverview(@CurrentUser() user: CurrentUserModel): Promise<AccountsOverviewDto> {
    return toAccountsOverviewResponse(await this.accounts.execute(user));
  }

  @Get('documents/overview')
  @RequiresGrant('document', 'read')
  @ApiOperation({
    operationId: 'getDocumentsOverview',
    summary: 'Documents overview; link chips follow read (DT-142)',
  })
  @ApiOkResponse({ type: DocumentsOverviewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'INTERNAL')
  async documentsOverview(@CurrentUser() user: CurrentUserModel): Promise<DocumentsOverviewDto> {
    return toDocumentsOverviewResponse(await this.documents.execute(user));
  }

  @Get('activity/overview')
  @RequiresGrant('activity', 'read')
  @ApiOperation({
    operationId: 'getActivityOverview',
    summary: 'Activity figures { total, today, users } under the GET /activity filter (Owner, Admin)',
  })
  @ApiOkResponse({ type: ActivityOverviewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async activityOverview(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ActivityOverviewQueryDto,
  ): Promise<ActivityOverviewDto> {
    return toActivityOverviewResponse(await this.activity.execute(user, query));
  }
}
