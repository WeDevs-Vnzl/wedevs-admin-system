"use client";

import { useState, type Ref } from "react";
import { parsePhoneNumberFromString, getCountryCallingCode } from "libphonenumber-js";
import { useTranslations } from "next-intl";
import { CountryCombobox, isCountryCode, type CountryCode } from "@/components/ui/country-combobox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PhoneInputProps {
  /** E.164 number ("+584121234567"), `""` when empty. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Country preselected when `value` is empty or carries no recognizable country. */
  defaultCountry?: CountryCode;
  disabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  /** Ids of the field's hint and error; set on the number input. */
  "aria-describedby"?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

const DEFAULT_COUNTRY: CountryCode = "VE";

interface Draft {
  country: CountryCode;
  national: string;
}

/** E.164 for what is typed: libphonenumber when it can read it, else prefix + digits. */
function toE164({ country, national }: Draft): string {
  const digits = national.replace(/\D/g, "");
  if (digits === "") return "";
  const parsed = parsePhoneNumberFromString(national, country);
  return parsed?.number ?? `+${getCountryCallingCode(country)}${digits}`;
}

function fromE164(value: string, fallback: CountryCode): Draft {
  const parsed = value === "" ? undefined : parsePhoneNumberFromString(value);
  if (!parsed) return { country: fallback, national: value.replace(/^\+\d*/, "") };
  return { country: parsed.country ?? fallback, national: parsed.formatNational() };
}

/** Phone number as E.164: country prefix picker + national number. */
export function PhoneInput({
  value,
  onChange,
  onBlur,
  defaultCountry = DEFAULT_COUNTRY,
  disabled,
  id,
  name,
  className,
  ref,
  ...aria
}: PhoneInputProps) {
  const t = useTranslations("forms.phoneInput");
  const [draft, setDraft] = useState<Draft>(() => fromE164(value, defaultCountry));
  const [seenValue, setSeenValue] = useState(value);

  if (value !== seenValue) {
    setSeenValue(value);
    if (toE164(draft) !== value) setDraft(fromE164(value, draft.country));
  }

  function update(next: Draft) {
    setDraft(next);
    const e164 = toE164(next);
    setSeenValue(e164);
    onChange(e164);
  }

  return (
    <div data-slot="phone-input" className={cn("flex items-center gap-2", className)}>
      <CountryCombobox
        variant="dial"
        value={draft.country}
        disabled={disabled}
        aria-invalid={aria["aria-invalid"]}
        onChange={(country) => {
          if (isCountryCode(country)) update({ country, national: draft.national });
        }}
      />
      <Input
        ref={ref}
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={draft.national}
        disabled={disabled}
        placeholder={t("placeholder")}
        aria-label={aria["aria-label"] ?? (id ? undefined : t("numberLabel"))}
        aria-invalid={aria["aria-invalid"]}
        aria-describedby={aria["aria-describedby"]}
        onChange={(event) => {
          const text = event.target.value;
          if (text.trim().startsWith("+")) {
            const parsed = parsePhoneNumberFromString(text);
            if (parsed?.country) {
              update({ country: parsed.country, national: parsed.formatNational() });
              return;
            }
          }
          update({ country: draft.country, national: text });
        }}
        onBlur={() => {
          const parsed = parsePhoneNumberFromString(draft.national, draft.country);
          if (parsed?.isValid()) setDraft({ country: draft.country, national: parsed.formatNational() });
          onBlur?.();
        }}
      />
    </div>
  );
}
