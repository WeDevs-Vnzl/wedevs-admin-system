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

/** WCAG 2.1 relative luminance of a validated `#rrggbb` colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * Text colour that reads on a `#rrggbb` background: black or white, whichever contrasts more (WCAG 1.4.3),
 * so a chip stays legible on any colour the user picks.
 */
export function readableTextColor(background: string): "#000000" | "#ffffff" {
  const luminance = relativeLuminance(background);
  const withWhite = 1.05 / (luminance + 0.05);
  const withBlack = (luminance + 0.05) / 0.05;
  return withBlack >= withWhite ? "#000000" : "#ffffff";
}

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
