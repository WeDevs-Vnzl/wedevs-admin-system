"use client";

import { ArrowDown, ArrowUp, Columns3, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  moveColumn,
  setColumnVisible,
  setColumnWidth,
} from "./column-config";
import type { ColumnConfig } from "./types";

export interface ViewColumn {
  id: string;
  label: string;
  hideable: boolean;
}

interface DataTableViewOptionsProps {
  columns: ViewColumn[];
  config: ColumnConfig[];
  defaults: ColumnConfig[];
  onChange: (config: ColumnConfig[]) => void;
}

/**
 * Column visibility, order and width. Every change is reported as a whole config through `onChange`,
 * which the table forwards to `onColumnsChange` (the caller persists it, e.g. `table:<tableId>:columns`).
 */
export function DataTableViewOptions({ columns, config, defaults, onChange }: DataTableViewOptionsProps) {
  const t = useTranslations("table");
  const labelOf = (id: string) => columns.find((column) => column.id === id)?.label ?? id;
  const hideableOf = (id: string) => columns.find((column) => column.id === id)?.hideable ?? false;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 data-icon="inline-start" />
          {t("columns.label")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <ul className="flex flex-col gap-1">
          {config.map((column, index) => {
            const label = labelOf(column.id);
            const hideable = hideableOf(column.id);
            return (
              <li key={column.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted">
                <Checkbox
                  id={`table-col-${column.id}`}
                  checked={column.visible}
                  disabled={!hideable}
                  onCheckedChange={(checked) => onChange(setColumnVisible(config, column.id, checked === true))}
                />
                <Label htmlFor={`table-col-${column.id}`} className="flex-1 truncate font-normal">
                  {label}
                </Label>
                <Input
                  type="number"
                  min={MIN_COLUMN_WIDTH}
                  step={10}
                  className="h-7 w-20"
                  aria-label={t("columns.width", { column: label })}
                  value={column.width ?? DEFAULT_COLUMN_WIDTH}
                  onChange={(event) => {
                    const width = Number(event.target.value);
                    if (Number.isFinite(width) && width >= MIN_COLUMN_WIDTH) {
                      onChange(setColumnWidth(config, column.id, width));
                    }
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={index === 0}
                  onClick={() => onChange(moveColumn(config, column.id, -1))}
                  aria-label={t("columns.moveUp", { column: label })}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={index === config.length - 1}
                  onClick={() => onChange(moveColumn(config, column.id, 1))}
                  aria-label={t("columns.moveDown", { column: label })}
                >
                  <ArrowDown />
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex justify-end border-t pt-2">
          <Button variant="ghost" size="sm" onClick={() => onChange(defaults)}>
            <RotateCcw data-icon="inline-start" />
            {t("columns.reset")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
