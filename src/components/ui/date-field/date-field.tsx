"use client";

import { useState, type Ref } from "react";
import { CalendarIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { enUS, es } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BUSINESS_TIME_ZONE, formatDate, toDateOnly, type DateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";

export interface DateFieldProps {
  /** Business date 'YYYY-MM-DD', `""` when empty. */
  value: DateOnly;
  onChange: (value: DateOnly) => void;
  onBlur?: () => void;
  /** Zone that decides which day is "today" in the calendar (default America/Caracas, DT-43). */
  timeZone?: string;
  /** Earliest / latest selectable day, 'YYYY-MM-DD'. */
  min?: DateOnly;
  max?: DateOnly;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  /** Ids of the field's hint and error; set on the trigger. */
  "aria-describedby"?: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** 'YYYY-MM-DD' → Date at local midnight with the same calendar day (what DayPicker works with). */
function toLocalDate(value: DateOnly): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Local calendar day of a DayPicker date → 'YYYY-MM-DD' (never through UTC). */
function fromLocalDate(date: Date): DateOnly {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Date picker (calendar in a popover) that emits `YYYY-MM-DD`; the calendar's "today" follows `timeZone`. */
export function DateField({
  value,
  onChange,
  onBlur,
  timeZone = BUSINESS_TIME_ZONE,
  min,
  max,
  placeholder,
  disabled,
  id,
  name,
  className,
  ref,
  ...aria
}: DateFieldProps) {
  const t = useTranslations("forms.dateField");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [now] = useState(() => new Date());

  const selected = toLocalDate(value);
  const today = toLocalDate(toDateOnly(now, timeZone));
  const minDate = min ? toLocalDate(min) : undefined;
  const maxDate = max ? toLocalDate(max) : undefined;

  // Default name when the caller gave neither `aria-label` nor an `id` (a `<label for>` target).
  const accessibleName =
    aria["aria-label"] ??
    (id ? undefined : selected ? t("valueLabel", { value: formatDate(value, locale, "medium") }) : t("label"));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={accessibleName}
          aria-invalid={aria["aria-invalid"]}
          aria-describedby={aria["aria-describedby"]}
          aria-haspopup="dialog"
          data-slot="date-field"
          data-empty={selected ? undefined : "true"}
          className={cn(
            "w-full justify-between font-normal data-[empty=true]:text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {selected ? formatDate(value, locale, "medium") : (placeholder ?? t("placeholder"))}
          </span>
          <CalendarIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={locale.toLowerCase().startsWith("es") ? es : enUS}
          selected={selected}
          defaultMonth={selected ?? today}
          today={today}
          disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
          onSelect={(date) => {
            if (!date) return;
            onChange(fromLocalDate(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </Popover>
  );
}
