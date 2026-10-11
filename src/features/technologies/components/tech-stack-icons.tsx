// Server component (no "use client"): Simple Icons are resolved here, on the server only, so the
// `simple-icons` data never reaches a client bundle. Client components get the resolved `ResolvedIcon`
// as plain props instead (see `resolveTechnologyIcon`).
import * as simpleIcons from "simple-icons";
import type { SimpleIcon } from "simple-icons";
import { slugToVariableName } from "simple-icons/sdk";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Locale } from "@/i18n/config";
import type { TechnologyChipDTO } from "@/lib/validators/technologies";
import { technologyLabel } from "../label";

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
 * it reads the `simple-icons` package.
 */
export function resolveTechnologyIcon(slug: string | null): ResolvedIcon | null {
  if (!slug) return null;
  const icon = (simpleIcons as unknown as Record<string, SimpleIcon | undefined>)[
    slugToVariableName(slug)
  ];
  if (!icon || icon.slug !== slug) return null;
  return { path: icon.path, hex: icon.hex, title: icon.title };
}

/** A technology's stack icon: its brand glyph in its colour, or a colour dot without one. */
function StackIcon({ tech, locale }: { tech: TechnologyChipDTO; locale: Locale }) {
  const name = technologyLabel(tech, locale);
  const icon = resolveTechnologyIcon(tech.iconSlug);
  const color = tech.color ?? (icon ? `#${icon.hex}` : undefined);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex size-6 items-center justify-center rounded-md" aria-label={name} role="img">
          {icon ? (
            <svg viewBox="0 0 24 24" className="size-4" fill={color} aria-hidden focusable="false">
              <path d={icon.path} />
            </svg>
          ) : (
            <span
              className="size-2.5 rounded-full bg-muted-foreground"
              style={color ? { backgroundColor: color } : undefined}
              aria-hidden
            />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

type TechStackIconsProps = {
  technologies: readonly TechnologyChipDTO[];
  locale: Locale;
};

/** The stack of a project as icons, each with its name in a tooltip (PRD §8.3 "Stack"). */
export function TechStackIcons({ technologies, locale }: TechStackIconsProps) {
  if (technologies.length === 0) return null;
  return (
    <TooltipProvider>
      <span className="inline-flex flex-wrap items-center gap-1">
        {technologies.map((tech) => (
          <StackIcon key={tech.id} tech={tech} locale={locale} />
        ))}
      </span>
    </TooltipProvider>
  );
}
