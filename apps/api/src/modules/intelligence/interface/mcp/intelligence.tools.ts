import type { Type } from '@nestjs/common';
import type { z, ZodType } from 'zod';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { McpToolDefinition } from '../../../../shared/interface/mcp-tool-registry';
import { ListAlerts } from '../../application/use-cases/alerts/list-alerts.use-case';
import { GetDashboard } from '../../application/use-cases/dashboard/get-dashboard.use-case';
import { GetKpis } from '../../application/use-cases/reports/get-kpis.use-case';
import { SearchGlobal } from '../../application/use-cases/search/search-global.use-case';
import { ListAlertsQueryDto, toInboxResponse } from '../http/alerts.dto';
import { DashboardQueryDto, toDashboardResponse } from '../http/dashboard.dto';
import { ReportFilterQueryDto } from '../http/reports.dto';
import { SearchQueryDto, toSearchResponse } from '../http/search.dto';

/** Resolves an application use case of the booted app (the feature modules do not export them). */
export type ResolveUseCase = <T>(token: Type<T>) => T;

/**
 * Grant of an `@Authenticated()` route (search, dashboard, alerts): there is no route grant, the use case
 * decides by data what the caller sees (DT-79, DT-195). The MCP server skips its grant check for it.
 * `McpToolDefinition['grant']` has no member for this yet, so the marker is cast here, in one place.
 */
const AUTHENTICATED = 'authenticated' as const;

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
      run: async (actor, input) =>
        toSearchResponse(await resolve(SearchGlobal).execute(actor, input)),
    }),
    tool({
      name: 'get_dashboard',
      description: 'The dashboard of a month, quarter or year: cards, chart and panels.',
      input: DashboardQueryDto.schema,
      grant: AUTHENTICATED,
      run: async (actor, input) =>
        toDashboardResponse(await resolve(GetDashboard).execute(actor, input)),
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
        return toInboxResponse(
          await resolve(ListAlerts).execute(actor, { types, limit: input.limit }),
        );
      },
    }),
  ];
}
