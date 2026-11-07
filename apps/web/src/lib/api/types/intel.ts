import type { components } from "../schema";

// Generated response DTOs of the dashboard, the reports and the KPIs, re-exported for the INTEL screens (C8).
// Code outside `src/lib/api/**` may not import the schema (ESLint), so the screens read these names.

/** `GET /api/v1/dashboard`: the eight cards of the period, the twelve-month chart and the panels. */
export type DashboardResponseDto = components["schemas"]["DashboardResponseDto"];

/** One card of `DashboardResponseDto.kpis`. */
export type DashboardKpiCardDto = DashboardResponseDto["kpis"][number];

/** `GET /api/v1/reports/kpis`: the eighteen KPIs of the range, with the previous range. */
export type KpisResponseDto = components["schemas"]["KpisResponseDto"];

/** One KPI of `KpisResponseDto.kpis`: value, previous value, change and the 12-month sparkline. */
export type KpiResultDto = KpisResponseDto["kpis"][number];

/** An entity reference as the BE sends it (`code` is `null` when the entity has none). */
export type EntityRefDto = components["schemas"]["EntityRefDto"];
