"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isLocale, type Locale } from "@/i18n/config";
import { TECH_CATEGORY_VALUES } from "@/lib/validators/enums";
import type { TechnologyChipDTO, TechnologyListRowDTO } from "@/lib/validators/technologies";
import { cn } from "@/lib/utils";
import { technologyLabel } from "../label";

type TechnologyPickerProps = {
  /** Selected technology ids, in the order the user picked them. */
  value: readonly string[];
  onChange: (ids: string[]) => void;
  /** Catalog rows; only the active ones are offered (HU-06 CA1). */
  technologies: readonly TechnologyListRowDTO[];
  /** The record's current stack. Inactive ones are shown as removable chips, never offered for a new selection. */
  selected?: readonly TechnologyChipDTO[];
  id?: string;
  disabled?: boolean;
};

/** Colour dot of a technology: its own colour, or a neutral dot. Client side: no brand icons (server only). */
function ColorDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", !color && "bg-muted-foreground")}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

// Multi-select of the stack (PRD §8.3, HU-06 CA1): active technologies grouped by category, no free values.
export function TechnologyPicker({
  value,
  onChange,
  technologies,
  selected = [],
  id,
  disabled,
}: TechnologyPickerProps) {
  const t = useTranslations("catalogs.technologies.picker");
  const tEnums = useTranslations("enums");
  const localeValue = useLocale();
  const locale: Locale = isLocale(localeValue) ? localeValue : "es";
  const [open, setOpen] = useState(false);

  const active = useMemo(() => technologies.filter((tech) => tech.active), [technologies]);
  const activeIds = new Set(active.map((tech) => tech.id));
  const selectedActive = active.filter((tech) => value.includes(tech.id));
  // A selected technology that is no longer active: kept on the record, shown to be removed, not offered again.
  const inactiveSelected = selected.filter(
    (tech) => value.includes(tech.id) && !activeIds.has(tech.id),
  );

  const toggle = (techId: string) => {
    onChange(value.includes(techId) ? value.filter((item) => item !== techId) : [...value, techId]);
  };

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-auto min-h-9 w-full justify-between font-normal"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {selectedActive.length === 0 && inactiveSelected.length === 0 ? (
                <span className="text-muted-foreground">{t("placeholder")}</span>
              ) : (
                selectedActive.map((tech) => (
                  <span
                    key={tech.id}
                    className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs"
                  >
                    <ColorDot color={tech.color} />
                    {technologyLabel(tech, locale)}
                  </span>
                ))
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder={t("search")} />
            <CommandList>
              <CommandEmpty>{t("empty")}</CommandEmpty>
              {TECH_CATEGORY_VALUES.map((category) => {
                const items = active.filter((tech) => tech.category === category);
                if (items.length === 0) return null;
                return (
                  <CommandGroup key={category} heading={tEnums(`TechCategory.${category}`)}>
                    {items.map((tech) => {
                      const label = technologyLabel(tech, locale);
                      const isSelected = value.includes(tech.id);
                      return (
                        <CommandItem
                          key={tech.id}
                          value={`${label} ${tech.slug}`}
                          aria-checked={isSelected}
                          onSelect={() => toggle(tech.id)}
                        >
                          <Check
                            className={cn("size-4", isSelected ? "opacity-100" : "opacity-0")}
                            aria-hidden
                          />
                          <ColorDot color={tech.color} />
                          <span className="truncate">{label}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {inactiveSelected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {inactiveSelected.map((tech) => (
            <li key={tech.id}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                className="h-auto border-dashed py-0.5 text-xs font-normal text-muted-foreground"
                onClick={() => onChange(value.filter((item) => item !== tech.id))}
              >
                <ColorDot color={tech.color} />
                {technologyLabel(tech, locale)}
                <span>· {t("inactive")}</span>
                <X className="size-3" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
