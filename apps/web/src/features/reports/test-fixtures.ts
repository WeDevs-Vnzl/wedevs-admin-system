import type { KpisResponseDto } from "@/lib/api/types/intel";
import { KPI_ID_VALUES, KPI_UNITS, type KpiId } from "@/lib/validators/reports";

// TEST FIXTURE: synthetic `GET /api/v1/reports/kpis` bodies for the HTTP-mocked tests (no customer data, no mock
// service). Values are decimal strings, as the contract sends them (C15); one KPI has no data (`null`).

/** The 12 months ending at `lastMonth` (`YYYY-MM`), oldest first. */
function monthsEndingAt(lastMonth: string): string[] {
  const [year, month] = lastMonth.split("-").map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (11 - index), 1));
    return date.toISOString().slice(0, 7);
  });
}

function card(id: KpiId, index: number, lastMonth: string): KpisResponseDto["kpis"][number] {
  const hasChange = index % 2 === 0;
  const card: KpisResponseDto["kpis"][number] = {
    id,
    unit: KPI_UNITS[id],
    value: id === "DSO" ? null : `${1000 + index}.00`,
    previousValue: hasChange ? `${900 + index}.00` : null,
    changePercent: hasChange ? "12.50" : null,
    sparkline: monthsEndingAt(lastMonth).map((period, point) => ({
      period,
      value: `${100 + point + index}.00`,
    })),
  };
  if (id === "STACK_USAGE") {
    card.breakdown = [{ key: "typescript", label: "TypeScript", value: "3" }];
  }
  return card;
}

/** The eighteen KPIs of a range whose last sparkline month is `lastMonth` (default `2026-10`). */
export function makeKpisResponse(lastMonth = "2026-10"): KpisResponseDto {
  return {
    range: { dateFrom: "2025-11-01", dateTo: "2026-10-31" },
    previousRange: { dateFrom: "2024-11-01", dateTo: "2025-10-31" },
    kpis: KPI_ID_VALUES.map((id, index) => card(id, index, lastMonth)),
  };
}
