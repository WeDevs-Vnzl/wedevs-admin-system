import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated } from '../../../../shared/interface/grant.decorator';
import {
  GetDashboard,
  type DashboardOutput,
} from '../../application/use-cases/dashboard/get-dashboard.use-case';
import { DashboardQueryDto, DashboardResponseDto } from './dashboard.dto';

const toDto = (out: DashboardOutput): DashboardResponseDto => ({
  ...out,
  kpis: [...out.kpis],
  incomeVsExpenses: {
    periods: out.incomeVsExpenses.periods,
    series: out.incomeVsExpenses.series.map((s) => ({ id: s.id, values: s.values })),
  },
  invoicesDue: out.invoicesDue.map((row) => ({
    ...row,
    invoice: { ...row.invoice, code: row.invoice.code ?? null },
    client: { ...row.client, code: row.client.code ?? null },
  })),
  installmentsToInvoice: out.installmentsToInvoice.map((row) => ({
    ...row,
    installment: { ...row.installment, code: row.installment.code ?? null },
    project: { ...row.project, code: row.project.code ?? null },
  })),
  documentsExpiring: out.documentsExpiring.map((row) => ({
    ...row,
    document: { ...row.document, code: row.document.code ?? null },
  })),
  upcomingRecurringExpenses: out.upcomingRecurringExpenses.map((row) => ({
    ...row,
    expense: { ...row.expense, code: row.expense.code ?? null },
  })),
  recentActivity: out.recentActivity.map((row) => ({
    id: row.id,
    action: row.action as DashboardResponseDto['recentActivity'][number]['action'],
    entity: row.entity ? { ...row.entity, code: row.entity.code ?? null } : null,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
  })),
});

/**
 * The first screen (PRD §8.1). `@Authenticated()`: every role opens it and the use case decides by data what
 * is in it (`canSeeFinancials`, `read document`, `read activity`).
 */
@ApiTags('intelligence')
@Controller('dashboard')
@Authenticated()
export class DashboardController {
  constructor(private readonly getDashboard: GetDashboard) {}

  @Get()
  @ApiOperation({
    operationId: 'getDashboard',
    summary: 'The eight cards of a month, quarter or year, the twelve-month chart and the panels',
  })
  @ApiOkResponse({ type: DashboardResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async dashboard(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardResponseDto> {
    return toDto(await this.getDashboard.execute(user, query));
  }
}
