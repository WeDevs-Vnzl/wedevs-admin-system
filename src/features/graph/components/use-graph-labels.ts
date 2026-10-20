"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { GraphEdge, GraphNode, GraphNodeType } from "@/lib/validators/graph";

// Translations of what the graph service returns as stable keys: node types, relation keys (contacto, participa,
// …; L5), statuses (the module enums) and the card `meta` fields.

const STATUS_ENUM: Partial<Record<GraphNodeType, string>> = {
  CLIENT: "ClientStatus",
  PROJECT: "ProjectStatus",
  INVOICE: "InvoiceStatus",
  PAYMENT: "PaymentStatus",
  EXPENSE: "ExpenseStatus",
  DOCUMENT: "DocumentStatus",
};

/** `meta` fields shown in the hover card and the side panel, in this order. */
const META_FIELDS = [
  "kind",
  "country",
  "receivableUsd",
  "position",
  "email",
  "stack",
  "startDate",
  "targetEndDate",
  "currency",
  "total",
  "balance",
  "dueDate",
  "amount",
  "date",
  "method",
  "accountType",
  "documentType",
  "version",
  "author",
  "excerpt",
  "category",
] as const;

export type GraphLabels = ReturnType<typeof useGraphLabels>;

export function useGraphLabels() {
  const t = useTranslations("graph");
  const tEnums = useTranslations("enums");

  const typeLabel = useCallback((type: GraphNodeType) => t(`types.${type}`), [t]);
  const typePlural = useCallback((type: GraphNodeType) => t(`typesPlural.${type}`), [t]);

  const statusLabel = useCallback(
    (type: GraphNodeType, status: string | undefined) => {
      if (!status) return null;
      const enumName = STATUS_ENUM[type];
      const key = `${enumName}.${status}`;
      return enumName && tEnums.has(key as never) ? tEnums(key as never) : status;
    },
    [tEnums],
  );

  const relationLabel = useCallback(
    (edge: GraphEdge) => {
      const key = `relations.${edge.relation}`;
      const base = t.has(key as never) ? t(key as never) : edge.relation;
      return edge.label ? `${base} · ${edge.label}` : base;
    },
    [t],
  );

  const metaLines = useCallback(
    (node: GraphNode) =>
      META_FIELDS.flatMap((field) => {
        const value = node.meta[field];
        if (value === null || value === undefined || value === "") return [];
        return [{ field, label: t(`meta.${field}`), value: String(value) }];
      }),
    [t],
  );

  return useMemo(
    () => ({ typeLabel, typePlural, statusLabel, relationLabel, metaLines }),
    [typeLabel, typePlural, statusLabel, relationLabel, metaLines],
  );
}
