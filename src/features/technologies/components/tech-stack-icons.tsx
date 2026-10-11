// Server component (no "use client"): Simple Icons are resolved on the server only (`../icons` is
// `server-only`), so the `simple-icons` data never reaches a client bundle. Client components get the
// resolved `ResolvedIcon` as plain props instead.
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Locale } from "@/i18n/config";
import type { TechnologyChipDTO } from "@/lib/validators/technologies";
import { resolveTechnologyIcon } from "../icons";
import { technologyLabel } from "../label";

export type { ResolvedIcon } from "../icons";

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
