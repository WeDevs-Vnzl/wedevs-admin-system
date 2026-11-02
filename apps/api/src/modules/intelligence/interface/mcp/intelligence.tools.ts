import type { Type } from '@nestjs/common';
import type { z, ZodType } from 'zod';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { McpToolDefinition } from '../../../../shared/interface/mcp-tool-registry';
import type { AlertOutput } from '../../application/use-cases/alerts/alert-support';
import {
  ListAlerts,
  type AlertsInboxOutput,
} from '../../application/use-cases/alerts/list-alerts.use-case';
import {
  GetDashboard,
  type DashboardOutput,
} from '../../application/use-cases/dashboard/get-dashboard.use-case';
import { GetKpis } from '../../application/use-cases/reports/get-kpis.use-case';
import { SearchGlobal } from '../../application/use-cases/search/search-global.use-case';
import { ListAlertsQueryDto, type AlertsInboxResponseDto } from '../http/alerts.dto';
import { DashboardQueryDto, type DashboardResponseDto } from '../http/dashboard.dto';
import { ReportFilterQueryDto } from '../http/reports.dto';
import { SearchQueryDto } from '../http/search.dto';

/** Resolves an application use case of the booted app (the feature modules do not export them). */
export type ResolveUseCase = <T>(token: Type<T>) => T;

/**
 * Grant of an `@Authenticated()` route (search, dashboard, alerts): there is no route grant, the use case
 * decides by data what the caller sees (DT-79, DT-195). The MCP server skips its grant check for it.
 * `McpToolDefinition['grant']` has no member for this yet, so the marker is cast here, in one place.
 */
const AUTHENTICATED = 'authenticated' as unknown as McpToolDefinition['grant'];

interface ToolSpec<S extends ZodType> {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  readonly grant: McpToolDefinition['grant'];
  readonly run: (actor: CurrentUser, input: z.output<S>) => Promise<unknown>;
}

/** The server validates `input` before the handler runs, so the cast only restores the parsed type. */
function tool<S extends ZodType>(spec: ToolSpec<S>): McpToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    grant: spec.grant,
    handler: (actor, input) => spec.run(actor, input as z.output<S>),
  };
}

// ───────────────────── Output mapping (the same shapes as the HTTP routes) ─────────────────────

const code = <T extends { code?: string | null }>(ref: T) => ({ ...ref, code: ref.code ?? null });

const toDashboard = (out: DashboardOutput): DashboardResponseDto => ({
  ...out,
  kpis: [...out.kpis],
  incomeVsExpenses: {
    periods: out.incomeVsExpenses.periods,
    series: out.incomeVsExpenses.series.map((s) => ({ id: s.id, values: s.values })),
  },
  invoicesDue: out.invoicesDue.map((row) => ({
    ...row,
    invoice: code(row.invoice),
    client: code(row.client),
  })),
  installmentsToInvoice: out.installmentsToInvoice.map((row) => ({
    ...row,
    installment: code(row.installment),
    project: code(row.project),
  })),
  documentsExpiring: out.documentsExpiring.map((row) => ({ ...row, document: code(row.document) })),
  upcomingRecurringExpenses: out.upcomingRecurringExpenses.map((row) => ({
    ...row,
    expense: code(row.expense),
  })),
  recentActivity: out.recentActivity.map((row) => ({
    id: row.id,
    action: row.action as DashboardResponseDto['recentActivity'][number]['action'],
    entity: row.entity ? code(row.entity) : null,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
  })),
});

const toAlert = (alert: AlertOutput): AlertsInboxResponseDto['items'][number] => ({
  ...alert,
  entity: alert.entity
    ? {
        type: alert.entity.type,
        id: alert.entity.id,
        code: alert.entity.code ?? null,
        label: alert.entity.label,
      }
    : null,
});

const toInbox = (inbox: AlertsInboxOutput): AlertsInboxResponseDto => ({
  ...inbox,
  items: inbox.items.map(toAlert),
});

/**
 * MCP tools of the `intelligence` context (DT-188): global search, the dashboard, the KPIs and the alerts
 * inbox, each over the use case of its HTTP route. Search, dashboard and alerts are `@Authenticated()` routes:
 * the use case limits what each role sees. The KPIs are Owner and Admin only (`report` `read`).
 */
export function intelligenceTools(resolve: ResolveUseCase): McpToolDefinition[] {
  return [
    tool({
      name: 'search',
      description:
        'Global search over every record type the caller may read (prefixes c: p: f: d: n:).',
      input: SearchQueryDto.schema,
      grant: AUTHENTICATED,
      run: async (actor, input) => {
        const result = await resolve(SearchGlobal).execute(actor, input);
        return {
          query: result.query,
          entityType: result.entityType,
          groups: result.groups.map((group) => ({
            entityType: group.entityType,
            total: group.total,
            items: group.items.map((item) => ({ ...item })),
          })),
        };
      },
    }),
    tool({
      name: 'get_dashboard',
      description: 'The dashboard of a month, quarter or year: cards, chart and panels.',
      input: DashboardQueryDto.schema,
      grant: AUTHENTICATED,
      run: async (actor, input) => toDashboard(await resolve(GetDashboard).execute(actor, input)),
    }),
    tool({
      name: 'get_kpis',
      description: 'The 18 KPIs: value, previous period, change and a 12-month sparkline.',
      input: ReportFilterQueryDto.schema,
      grant: { resource: 'report', action: 'read' },
      run: (actor, input) => resolve(GetKpis).execute(actor, input),
    }),
    tool({
      name: 'list_alerts',
      description: 'The alerts inbox of the token user.',
      input: ListAlertsQueryDto.schema,
      grant: AUTHENTICATED,
      run: async (actor, input) => {
        const types = input.types === undefined ? undefined : [input.types].flat();
        return toInbox(await resolve(ListAlerts).execute(actor, { types, limit: input.limit }));
      },
    }),
  ];
}
