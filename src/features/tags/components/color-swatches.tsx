"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Preset colours of the tag palette (the swatches of the create/edit dialog). */
export const PRESET_TAG_COLORS = [
  "#dc2626",
  "#d97706",
  "#059669",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#64748b",
] as const;

type ColorSwatchesProps = {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
};

/** Preset swatches (a single-choice toggle group) plus a hex input for any other colour. */
export function ColorSwatches({ value, onChange, disabled }: ColorSwatchesProps) {
  const t = useTranslations("tags");
  const hexId = useId();

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        type="single"
        spacing={2}
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
        aria-label={t("form.presets")}
        disabled={disabled}
        className="flex-wrap"
      >
        {PRESET_TAG_COLORS.map((color) => (
          <ToggleGroupItem
            key={color}
            value={color}
            aria-label={t("form.swatch", { color })}
            className="size-7 min-w-7 rounded-full p-0"
            style={{ backgroundColor: color }}
          />
        ))}
      </ToggleGroup>
      <div className="flex max-w-40 flex-col gap-1.5">
        <label htmlFor={hexId} className="text-sm font-medium">
          {t("form.colorHex")}
        </label>
        <Input
          id={hexId}
          value={value}
          maxLength={7}
          disabled={disabled}
          placeholder="#2563eb"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
