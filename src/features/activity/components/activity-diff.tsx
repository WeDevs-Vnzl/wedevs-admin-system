"use client";

import { useTranslations } from "next-intl";
import {
  ACTIVITY_CHANGED_MARKER,
  type ActivityChanges,
  type ActivityDiffValue,
} from "@/lib/validators/activity";
import type { EntityType, EnumName } from "@/lib/validators/enums";

/** The enum that labels a field of a record type; fields not listed here are shown as typed. */
export function enumNameFor(entityType: EntityType, field: string): EnumName | null {
  if (field === "kind" && entityType === "CLIENT") return "ClientKind";
  if (field === "format" && entityType === "DOCUMENT") return "DocumentFormat";
  if (field === "category" && entityType === "SETTING") return "TechCategory";
  if (field !== "status") return null;
  const byEntity: Partial<Record<EntityType, EnumName>> = {
    CLIENT: "ClientStatus",
    PROJECT: "ProjectStatus",
    INVOICE: "InvoiceStatus",
    PAYMENT: "PaymentStatus",
    EXPENSE: "ExpenseStatus",
    RECURRING_EXPENSE: "RecurringStatus",
    INSTALLMENT: "InstallmentStatus",
    DOCUMENT: "DocumentStatus",
  };
  return byEntity[entityType] ?? null;
}

/**
 * The field diff of one entry: each changed field, its "before" struck through and its "after". Enum values
 * are labelled from `enums`, booleans as yes/no, `null` as a dash, money strings verbatim (decimal strings,
 * C15), and a long text as the `"changed"` marker (text, not a value).
 */
export function ActivityDiff({
  entityType,
  changes,
}: {
  entityType: EntityType;
  changes: ActivityChanges;
}) {
  const t = useTranslations("activity");
  const tEnums = useTranslations("enums");

  const label = (field: string) => (t.has(`fields.${field}`) ? t(`fields.${field}`) : field);

  const value = (field: string, raw: ActivityDiffValue) => {
    if (raw === null) return t("diff.empty");
    if (typeof raw === "boolean") return raw ? t("diff.yes") : t("diff.no");
    const enumName = enumNameFor(entityType, field);
    if (enumName && tEnums.has(`${enumName}.${raw}`)) return tEnums(`${enumName}.${raw}`);
    return raw;
  };

  return (
    <dl className="flex flex-col gap-3">
      {Object.entries(changes).map(([field, change]) => (
        <div key={field} className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{label(field)}</dt>
          <dd className="text-sm break-words">
            {change === ACTIVITY_CHANGED_MARKER ? (
              <span className="italic">{t("diff.changed")}</span>
            ) : (
              <>
                <span className="sr-only">{t("diff.before")}: </span>
                <s className="text-muted-foreground tabular-nums">{value(field, change[0])}</s>{" "}
                <span aria-hidden>{t("diff.arrow")}</span>{" "}
                <span className="sr-only">{t("diff.after")}: </span>
                <span className="font-medium tabular-nums">{value(field, change[1])}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
