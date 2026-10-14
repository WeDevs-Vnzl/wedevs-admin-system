"use client";

import { useTranslations } from "next-intl";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import type { LedgerEntryKind, LedgerRow } from "@/lib/validators/accounts";

type AccountLedgerTableProps = {
  rows: LedgerRow[];
  /** Account currency: every amount of the ledger is in it. */
  currency: string;
};

const helper = createDataTableColumnHelper<LedgerRow>();

const MOVEMENT_KINDS = new Set<LedgerEntryKind>(["APORTE_CAPITAL", "RETIRO_SOCIO", "AJUSTE"]);

/**
 * The ledger of one account (HU-15 CA2): every balance-changing entry in date order, its signed effect and the
 * running balance after it. The balances come from the service (`lib/finance`), never from this table.
 */
export function AccountLedgerTable({ rows, currency }: AccountLedgerTableProps) {
  const t = useTranslations("accounts");
  const tEnums = useTranslations("enums");

  const kindLabel = (kind: LedgerEntryKind) =>
    MOVEMENT_KINDS.has(kind)
      ? tEnums(`AccountMovementType.${kind}`)
      : t(`ledger.kinds.${kind}` as never);

  const columns: DataTableColumnDef<LedgerRow>[] = [
    helper.accessor("date", {
      header: t("ledger.columns.date"),
      cell: ({ getValue }) => <DateText value={getValue()} />,
      meta: { label: t("ledger.columns.date"), pinned: true },
      size: 130,
    }),
    helper.accessor("kind", {
      header: t("ledger.columns.kind"),
      cell: ({ getValue }) => kindLabel(getValue()),
      meta: { label: t("ledger.columns.kind") },
      size: 180,
    }),
    helper.display({
      id: "source",
      header: t("ledger.columns.source"),
      cell: ({ row }) => row.original.source?.label ?? "—",
      meta: { label: t("ledger.columns.source") },
      size: 200,
    }),
    helper.accessor("description", {
      header: t("ledger.columns.description"),
      cell: ({ getValue }) => getValue() ?? "—",
      meta: { label: t("ledger.columns.description") },
      size: 240,
    }),
    helper.accessor("amount", {
      header: t("ledger.columns.amount"),
      cell: ({ getValue }) => <MoneyText amount={getValue()} currency={currency} />,
      meta: { label: t("ledger.columns.amount"), align: "end" },
      size: 150,
    }),
    helper.accessor("balance", {
      header: t("ledger.columns.balance"),
      cell: ({ getValue }) => <MoneyText amount={getValue()} currency={currency} />,
      meta: { label: t("ledger.columns.balance"), align: "end" },
      size: 150,
    }),
  ];

  return (
    <DataTable
      variant="compact"
      embedded
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      emptyState={{ title: t("ledger.empty.title"), description: t("ledger.empty.description") }}
    />
  );
}
