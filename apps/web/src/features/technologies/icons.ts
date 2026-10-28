import "server-only";
import * as simpleIcons from "simple-icons";
import type { SimpleIcon } from "simple-icons";
import { slugToVariableName } from "simple-icons/sdk";

/** Plain data of a resolved brand icon: safe to pass from a server component to a client one. */
export interface ResolvedIcon {
  /** SVG path data (24×24 viewBox). */
  path: string;
  /** Brand colour, `RRGGBB` without `#`. */
  hex: string;
  title: string;
}

/**
 * The Simple Icons entry of `slug` (`nextdotjs`, `postgresql`), or `null` when there is none. Server only:
 * it reads the `simple-icons` package, which must never reach a client bundle.
 */
export function resolveTechnologyIcon(slug: string | null): ResolvedIcon | null {
  if (!slug) return null;
  const icon = (simpleIcons as unknown as Record<string, SimpleIcon | undefined>)[
    slugToVariableName(slug)
  ];
  if (!icon || icon.slug !== slug) return null;
  return { path: icon.path, hex: icon.hex, title: icon.title };
}
