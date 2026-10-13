"use client";

import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Check, Plus } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { useLocale, useTranslations } from "next-intl";
import { enUS, es } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FacetConfig, FacetOption } from "./types";

/** Facet value in the URL: option values for `options`/`async`, `[from, to]` (YYYY-MM-DD) for `dateRange`. */
export type FacetValue = string[];

export const DATE_FORMAT = "yyyy-MM-dd";

/** Remembers labels of async options already seen, so chips can show a name instead of an id. */
export type FacetLabelCache = Map<string, string>;

interface DataTableFacetedFilterProps {
  facet: FacetConfig;
  value: FacetValue;
  labels: FacetLabelCache;
  onChange: (value: FacetValue) => void;
}

/** "+ Field" trigger and its popover: option list, async search, or date range. */
export function DataTableFacetedFilter({ facet, value, labels, onChange }: DataTableFacetedFilterProps) {
  const t = useTranslations("table");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <Plus data-icon="inline-start" />
          {t("facet.add", { field: facet.label })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {open && facet.kind === "dateRange" ? (
          <DateRangeBody value={value} onChange={onChange} />
        ) : open && facet.kind === "options" ? (
          <OptionsBody facet={facet} options={facet.options} value={value} labels={labels} onChange={onChange} />
        ) : open && facet.kind === "async" ? (
          <AsyncBody facet={facet} value={value} labels={labels} onChange={onChange} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

const ASYNC_DEBOUNCE_MS = 250;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function toggle(value: FacetValue, option: string): FacetValue {
  return value.includes(option) ? value.filter((item) => item !== option) : [...value, option];
}

function OptionsBody({
  facet,
  options,
  value,
  labels,
  onChange,
}: {
  facet: FacetConfig;
  options: FacetOption[];
  value: FacetValue;
  labels: FacetLabelCache;
  onChange: (value: FacetValue) => void;
}) {
  const t = useTranslations("table");
  options.forEach((option) => labels.set(option.value, option.label));
  return (
    <Command label={t("facet.searchLabel", { field: facet.label })}>
      <CommandInput
        placeholder={t("facet.searchPlaceholder", { field: facet.label })}
        aria-label={t("facet.searchLabel", { field: facet.label })}
      />
      <CommandList>
        <CommandEmpty>{t("facet.empty")}</CommandEmpty>
        <CommandGroup>
          {options.map((option) => (
            <OptionItem key={option.value} option={option} value={value} onChange={onChange} />
          ))}
        </CommandGroup>
      </CommandList>
      <FacetFooter value={value} onChange={onChange} />
    </Command>
  );
}

function AsyncBody({
  facet,
  value,
  labels,
  onChange,
}: {
  facet: Extract<FacetConfig, { kind: "async" }>;
  value: FacetValue;
  labels: FacetLabelCache;
  onChange: (value: FacetValue) => void;
}) {
  const t = useTranslations("table");
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, ASYNC_DEBOUNCE_MS);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<
    { search: string; attempt: number; options: FacetOption[]; failed: boolean } | null
  >(null);

  useEffect(() => {
    let active = true;
    facet.loadOptions(debounced).then(
      (loaded) => {
        if (!active) return;
        loaded.forEach((option) => labels.set(option.value, option.label));
        setResult({ search: debounced, attempt, options: loaded, failed: false });
      },
      () => {
        if (active) setResult({ search: debounced, attempt, options: [], failed: true });
      },
    );
    return () => {
      active = false;
    };
    // loadOptions is supplied by the page; re-running on identity change would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, attempt]);

  // Loading until the result belongs to the current (debounced) search string and attempt.
  const loading = debounced !== search || result?.search !== debounced || result.attempt !== attempt;
  const failed = !loading && result?.failed === true;
  const options = result?.options ?? [];
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <Command shouldFilter={false} label={t("facet.searchLabel", { field: facet.label })}>
      <CommandInput
        placeholder={t("facet.searchPlaceholder", { field: facet.label })}
        aria-label={t("facet.searchLabel", { field: facet.label })}
        onValueChange={setSearch}
      />
      <CommandList>
        {loading ? <div className="px-2 py-6 text-center text-sm text-muted-foreground">{t("facet.loading")}</div> : null}
        {failed ? (
          <div role="alert" className="flex flex-col items-center gap-2 px-2 py-6 text-center text-sm text-muted-foreground">
            <span>{t("facet.error")}</span>
            <Button variant="outline" size="sm" onClick={retry}>
              {t("facet.retry")}
            </Button>
          </div>
        ) : null}
        {!loading && !failed && options.length === 0 ? <CommandEmpty>{t("facet.empty")}</CommandEmpty> : null}
        <CommandGroup>
          {options.map((option) => (
            <OptionItem key={option.value} option={option} value={value} onChange={onChange} />
          ))}
        </CommandGroup>
      </CommandList>
      <FacetFooter value={value} onChange={onChange} />
    </Command>
  );
}

function OptionItem({
  option,
  value,
  onChange,
}: {
  option: FacetOption;
  value: FacetValue;
  onChange: (value: FacetValue) => void;
}) {
  const selected = value.includes(option.value);
  return (
    <CommandItem value={option.value} keywords={[option.label]} onSelect={() => onChange(toggle(value, option.value))}>
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded-sm border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
        aria-hidden
      >
        {selected ? <Check className="size-3" /> : null}
      </span>
      <span className="truncate">{option.label}</span>
    </CommandItem>
  );
}

function FacetFooter({ value, onChange }: { value: FacetValue; onChange: (value: FacetValue) => void }) {
  const t = useTranslations("table");
  if (value.length === 0) return null;
  return (
    <div className="border-t p-1">
      <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
        {t("facet.clear")}
      </Button>
    </div>
  );
}

function DateRangeBody({ value, onChange }: { value: FacetValue; onChange: (value: FacetValue) => void }) {
  const t = useTranslations("table");
  const locale = useLocale();
  const selected: DateRange | undefined = value.length === 2
    ? { from: parseISO(value[0] ?? ""), to: parseISO(value[1] ?? "") }
    : undefined;

  return (
    <div>
      <Calendar
        mode="range"
        locale={locale.toLowerCase().startsWith("es") ? es : enUS}
        defaultMonth={selected?.from}
        selected={selected}
        onSelect={(range) => {
          if (!range?.from) return onChange([]);
          const to = range.to ?? range.from;
          onChange([format(range.from, DATE_FORMAT), format(to, DATE_FORMAT)]);
        }}
      />
      {value.length > 0 ? (
        <div className="border-t p-1">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
            {t("facet.clear")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
