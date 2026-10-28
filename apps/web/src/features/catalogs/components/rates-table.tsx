"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  useTableUrlState,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import { formatDate } from "@/lib/dates";
import type { ListQuery } from "@/lib/validators/common";
import type { ExchangeRateDTO, ExchangeRateFilters } from "@/lib/validators/catalogs";
import { RATE_SOURCE_VALUES } from "@/lib/validators/enums";
import { listExchangeRatesAction } from "../actions";
import type { QuickLoadCurrency } from "../queries";
import { ImportRatesDialog } from "./import-rates-dialog";
import { QuickRateLoadDialog } from "./quick-rate-load-dialog";

type RatesTableProps = {
  /** First page, read on the server for the query in the URL. */
  rows: ExchangeRateDTO[];
  total: number;
  /** Business date of today (America/Caracas), the quick load default. */
  today: string;
  /** Active non-USD currencies with their latest rate (quick load and the currency facet). */
  currencies: QuickLoadCurrency[];
};

/** The table query as the list filter: the facets live in `filters`, the filter schema takes them top level. */
function toFilter(query: ListQuery): Partial<ExchangeRateFilters> {
  const { filters, ...rest } = query;
  // The facet values are free strings here; the action validates them against the schema.
  return {
    ...rest,
    currency: filters.currency as ExchangeRateFilters["currency"],
    source: filters.source as ExchangeRateFilters["source"],
  };
}

const helper = createDataTableColumnHelper<ExchangeRateDTO>();

// Settings → Tasas (PRD §8.15, DT-67): every stored rate, several per day (one per source), the quick daily load
// and the CSV import.
export function RatesTable({
  rows: initialRows,
  total: initialTotal,
  today,
  currencies,
}: RatesTableProps) {
  const t = useTranslations("catalogs.rates");
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const router = useRouter();
  const { query, setQuery } = useTableUrlState();
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [quickLoadOpen, setQuickLoadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // `useTableUrlState` writes the URL shallowly: the first render shows the server page, later query changes
  // read through the action (like the technologies table).
  const queryKey = JSON.stringify(query);
  const firstQueryKey = useRef(queryKey);
  const load = useCallback(
    async (next: ListQuery) => {
      setLoading(true);
      const result = await listExchangeRatesAction(toFilter(next));
      setLoading(false);
      if (!result.ok) {
        toast.error(tErrors(result.error.code));
        return;
      }
      setRows(result.data.items);
      setTotal(result.data.total);
    },
    [tErrors],
  );

  useEffect(() => {
    if (queryKey === firstQueryKey.current) return;
    void load(query);
  }, [query, queryKey, load]);

  const refresh = useCallback(() => {
    router.refresh();
    void load(query);
  }, [router, load, query]);

  const columns = useMemo<DataTableColumnDef<ExchangeRateDTO>[]>(
    () => [
      helper.accessor("date", {
        header: t("table.columns.date"),
        cell: ({ getValue }) => (
          <span className="tabular-nums">{formatDate(getValue(), locale)}</span>
        ),
        meta: { label: t("table.columns.date"), sortable: true, pinned: true },
      }),
      helper.accessor("currency", {
        header: t("table.columns.currency"),
        cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span>,
        meta: { label: t("table.columns.currency"), sortable: true },
      }),
      helper.accessor("usdRate", {
        header: t("table.columns.usdRate"),
        cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
        meta: { label: t("table.columns.usdRate"), sortable: true },
      }),
      helper.accessor("source", {
        header: t("table.columns.source"),
        cell: ({ getValue }) => tEnums(`RateSource.${getValue()}`),
        meta: { label: t("table.columns.source"), sortable: true },
      }),
      helper.accessor("createdAt", {
        header: t("table.columns.createdAt"),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatDate(getValue().slice(0, 10), locale)}
          </span>
        ),
        meta: { label: t("table.columns.createdAt"), sortable: true },
      }),
    ],
    [locale, t, tEnums],
  );

  const facets = useMemo(
    () => [
      {
        id: "currency",
        kind: "options" as const,
        label: t("table.facets.currency"),
        options: currencies.map((currency) => ({ value: currency.code, label: currency.code })),
      },
      {
        id: "source",
        kind: "options" as const,
        label: t("table.facets.source"),
        options: RATE_SOURCE_VALUES.map((value) => ({
          value,
          label: tEnums(`RateSource.${value}`),
        })),
      },
    ],
    [currencies, t, tEnums],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload data-icon="inline-start" aria-hidden />
          {t("import.open")}
        </Button>
        <Button onClick={() => setQuickLoadOpen(true)}>
          <Plus data-icon="inline-start" aria-hidden />
          {t("quickLoad.open")}
        </Button>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        total={total}
        loading={loading}
        query={query}
        onQueryChange={setQuery}
        facets={facets}
        searchPlaceholder={t("table.search")}
        selectable={false}
        emptyState={{
          title: t("table.empty.title"),
          description: t("table.empty.description"),
          action: <Button onClick={() => setQuickLoadOpen(true)}>{t("quickLoad.open")}</Button>,
        }}
      />

      <QuickRateLoadDialog
        open={quickLoadOpen}
        onOpenChange={setQuickLoadOpen}
        onSaved={() => {
          setQuickLoadOpen(false);
          refresh();
        }}
        today={today}
        currencies={currencies}
      />
      <ImportRatesDialog open={importOpen} onOpenChange={setImportOpen} onImported={refresh} />
    </div>
  );
}
