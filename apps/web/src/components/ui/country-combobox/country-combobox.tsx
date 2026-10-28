"use client";

import { useState } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
import { cn } from "@/lib/utils";
import { isCountryCode, listCountries, type CountryCode } from "./countries";

export interface CountryComboboxProps {
  /** ISO 3166-1 alpha-2 code, `""` when nothing is selected. */
  value: string;
  onChange: (value: CountryCode | "") => void;
  /** `name`: flag + country name. `dial`: flag + "+58", for the phone prefix. */
  variant?: "name" | "dial";
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}

/** Country picker (ISO alpha-2) with flags and `Intl` localized names, composed from popover + command. */
export function CountryCombobox({
  value,
  onChange,
  variant = "name",
  placeholder,
  disabled,
  id,
  className,
  ...aria
}: CountryComboboxProps) {
  const t = useTranslations("forms.countryCombobox");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const countries = listCountries(locale);
  const selected = isCountryCode(value) ? countries.find((country) => country.code === value) : undefined;

  let triggerText: string = placeholder ?? t("placeholder");
  if (selected) triggerText = variant === "dial" ? `+${selected.dialCode}` : selected.name;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={aria["aria-label"] ?? (variant === "dial" ? t("dialLabel") : undefined)}
          aria-invalid={aria["aria-invalid"]}
          disabled={disabled}
          data-slot="country-combobox"
          className={cn(
            "justify-between font-normal",
            variant === "dial" ? "w-28" : "w-full",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? <span aria-hidden="true">{selected.flag}</span> : null}
            <span className="truncate">{triggerText}</span>
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={t("search")} aria-label={t("search")} />
          <CommandList>
            <CommandEmpty>{t("empty")}</CommandEmpty>
            <CommandGroup>
              {countries.map((country) => (
                <CommandItem
                  key={country.code}
                  value={`${country.name} ${country.code} +${country.dialCode}`}
                  onSelect={() => {
                    onChange(country.code);
                    setOpen(false);
                  }}
                >
                  <span aria-hidden="true">{country.flag}</span>
                  <span className="truncate">{country.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">+{country.dialCode}</span>
                  <CheckIcon className={cn(value === country.code ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
