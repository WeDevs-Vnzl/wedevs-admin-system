"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { GraphNodeType } from "@/lib/validators/graph";
import { NODE_COLORS } from "./graph-styles";

// "Filtros" popover of both graphs (PRD §8.12.4, HU-24 CA4): type with its counter, then the groups each graph
// adds (status, tag, technology, client), the date range and the switches (archived, "Solo activos"). Every change
// applies at once, without reloading the page.

export type FilterOption = { value: string; label: string };
export type FilterGroup = {
  id: string;
  title: string;
  options: FilterOption[];
  selected: ReadonlySet<string>;
  onToggle: (value: string, checked: boolean) => void;
};
export type FilterSwitch = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

type GraphFiltersProps = {
  types: { type: GraphNodeType; label: string; count: number; checked: boolean }[];
  onTypeToggle: (type: GraphNodeType, checked: boolean) => void;
  groups: FilterGroup[];
  dateFrom: string;
  dateTo: string;
  onDateChange: (range: { dateFrom: string; dateTo: string }) => void;
  switches: FilterSwitch[];
  activeCount: number;
  onClear: () => void;
};

export function GraphFilters({
  types,
  onTypeToggle,
  groups,
  dateFrom,
  dateTo,
  onDateChange,
  switches,
  activeCount,
  onClear,
}: GraphFiltersProps) {
  const t = useTranslations("graph.filters");
  const id = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal aria-hidden />
          {t("title")}
          {activeCount > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[70vh] w-80 overflow-y-auto overscroll-contain"
        aria-label={t("title")}
      >
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("types")}</legend>
            {types.map((item) => (
              <div key={item.type} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-type-${item.type}`}
                  checked={item.checked}
                  onCheckedChange={(checked) => onTypeToggle(item.type, checked === true)}
                />
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: NODE_COLORS[item.type] }}
                />
                <Label htmlFor={`${id}-type-${item.type}`} className="font-normal">
                  {t("typeOption", { type: item.label, count: item.count })}
                </Label>
              </div>
            ))}
          </fieldset>

          {groups
            .filter((group) => group.options.length > 0)
            .map((group) => (
              <fieldset key={group.id} className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">{group.title}</legend>
                {group.options.map((option) => (
                  <div key={option.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-${group.id}-${option.value}`}
                      checked={group.selected.has(option.value)}
                      onCheckedChange={(checked) => group.onToggle(option.value, checked === true)}
                    />
                    <Label htmlFor={`${id}-${group.id}-${option.value}`} className="font-normal">
                      {option.label}
                    </Label>
                  </div>
                ))}
              </fieldset>
            ))}

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-from`}>{t("dateFrom")}</Label>
              <Input
                id={`${id}-from`}
                type="date"
                value={dateFrom}
                onChange={(event) => onDateChange({ dateFrom: event.target.value, dateTo })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-to`}>{t("dateTo")}</Label>
              <Input
                id={`${id}-to`}
                type="date"
                value={dateTo}
                onChange={(event) => onDateChange({ dateFrom, dateTo: event.target.value })}
              />
            </div>
          </div>

          {switches.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2">
              <Label htmlFor={`${id}-${item.id}`} className="font-normal">
                {item.label}
              </Label>
              <Switch
                id={`${id}-${item.id}`}
                checked={item.checked}
                onCheckedChange={item.onChange}
              />
            </div>
          ))}

          <Button variant="ghost" size="sm" onClick={onClear} disabled={activeCount === 0}>
            {t("clear")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
