"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { DateField } from "@/components/ui/date-field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  REPORT_RANGE_PRESET_VALUES,
  reportFilterSchema,
  reportRangePresetSchema,
  type ReportFilter,
} from "@/lib/validators/reports";

export interface ReportRangeFilterProps {
  value: ReportFilter;
  /** Called with every new valid range; a custom range waits until both dates are set and ordered. */
  onChange: (filter: ReportFilter) => void;
}

/** Date range of `/reports` (PRD §8.13): the presets, or a custom range with two dates. */
export function ReportRangeFilter({ value, onChange }: ReportRangeFilterProps) {
  const t = useTranslations("reports.filters");
  const tReports = useTranslations("reports");
  const [preset, setPreset] = useState(value.preset);
  const [custom, setCustom] = useState({ from: value.dateFrom ?? "", to: value.dateTo ?? "" });
  const [error, setError] = useState<string | null>(null);

  const apply = (next: ReportFilter["preset"], range = custom) => {
    setPreset(next);
    if (next === "CUSTOM" && (!range.from || !range.to)) return;
    const parsed = reportFilterSchema.safeParse(
      next === "CUSTOM"
        ? { preset: next, dateFrom: range.from, dateTo: range.to }
        : { preset: next },
    );
    if (!parsed.success) {
      // Contract messages are full keys (`reports.validation.*`); the date pickers only emit valid days.
      const message = parsed.error.issues[0]?.message ?? "";
      setError(
        message.startsWith("reports.")
          ? message.slice("reports.".length)
          : "validation.rangeInverted",
      );
      return;
    }
    setError(null);
    onChange(parsed.data);
  };

  const setDate = (field: "from" | "to", date: string) => {
    const range = { ...custom, [field]: date };
    setCustom(range);
    apply("CUSTOM", range);
  };

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        aria-label={t("label")}
        value={preset}
        onValueChange={(next) => {
          const parsed = reportRangePresetSchema.safeParse(next);
          if (parsed.success) apply(parsed.data);
        }}
        className="flex-wrap"
      >
        {REPORT_RANGE_PRESET_VALUES.map((option) => (
          <ToggleGroupItem key={option} value={option}>
            {t(`presets.${option}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {preset === "CUSTOM" ? (
        <div className="flex flex-wrap items-center gap-3">
          <DateField
            aria-label={t("from")}
            placeholder={t("from")}
            value={custom.from}
            onChange={(date) => setDate("from", date)}
            className="w-44"
          />
          <DateField
            aria-label={t("to")}
            placeholder={t("to")}
            value={custom.to}
            onChange={(date) => setDate("to", date)}
            className="w-44"
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {tReports(error)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
