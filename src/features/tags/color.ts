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
