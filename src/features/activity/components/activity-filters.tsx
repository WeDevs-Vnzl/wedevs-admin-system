"use client";

import { Download, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCsvExport } from "@/features/export/use-csv-export";
import { ACTIVITY_ACTION_VALUES, ENTITY_TYPE_VALUES } from "@/lib/validators/enums";
import type { ActivityFilter } from "@/lib/validators/activity";
import { exportActivityCsvAction } from "../actions";
import { ACTIVITY_EXPORT_COLUMNS, activityExportQuery } from "../columns";

// Filters live in the URL (nuqs). `shallow: false` makes Next re-render the page with the new search params, so
// the server reads the same filter the list shows. Each filter is a single value; "all" is no value.
const ALL = "__all__";

const filterParsers = {
  actorId: parseAsString,
  actorType: parseAsString,
  action: parseAsString,
  entityType: parseAsString,
  from: parseAsString,
  to: parseAsString,
};

export function ActivityFilters({ actors }: { actors: { id: string; name: string }[] }) {
  const t = useTranslations("activity.filters");
  const tEnums = useTranslations("enums");
  const [filters, setFilters] = useQueryStates(filterParsers, {
    history: "replace",
    shallow: false,
  });
  const active = Object.values(filters).some((value) => value !== null);

  return (
    <form
      role="search"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <Select
        value={filters.actorId ?? ALL}
        onValueChange={(value) => void setFilters({ actorId: value === ALL ? null : value })}
      >
        <SelectTrigger aria-label={t("actor")} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("allActors")}</SelectItem>
          {actors.map((actor) => (
            <SelectItem key={actor.id} value={actor.id}>
              {actor.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.action ?? ALL}
        onValueChange={(value) => void setFilters({ action: value === ALL ? null : value })}
      >
        <SelectTrigger aria-label={t("action")} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("all")}</SelectItem>
          {ACTIVITY_ACTION_VALUES.map((action) => (
            <SelectItem key={action} value={action}>
              {tEnums(`ActivityAction.${action}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.entityType ?? ALL}
        onValueChange={(value) => void setFilters({ entityType: value === ALL ? null : value })}
      >
        <SelectTrigger aria-label={t("entityType")} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("all")}</SelectItem>
          {ENTITY_TYPE_VALUES.map((type) => (
            <SelectItem key={type} value={type}>
              {tEnums(`EntityType.${type}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DateField
        aria-label={t("from")}
        value={filters.from ?? ""}
        max={filters.to ?? undefined}
        placeholder={t("pickDate")}
        onChange={(value) => void setFilters({ from: value || null })}
      />
      <DateField
        aria-label={t("to")}
        value={filters.to ?? ""}
        min={filters.from ?? undefined}
        placeholder={t("pickDate")}
        onChange={(value) => void setFilters({ to: value || null })}
      />

      {active ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            void setFilters({
              actorId: null,
              actorType: null,
              action: null,
              entityType: null,
              from: null,
              to: null,
            })
          }
        >
          <X aria-hidden />
          {t("clear")}
        </Button>
      ) : null}
    </form>
  );
}

/** "Exportar CSV": the filtered set of the log (≤ 10,000 rows), every column, through the export action. */
export function ActivityExportButton({ filter }: { filter: ActivityFilter }) {
  const t = useTranslations("activity.page");
  const onExport = useCsvExport(exportActivityCsvAction, "ACTIVITY");
  return (
    <Button
      variant="outline"
      onClick={() =>
        void onExport(activityExportQuery(filter), Object.keys(ACTIVITY_EXPORT_COLUMNS))
      }
    >
      <Download aria-hidden />
      {t("export")}
    </Button>
  );
}
