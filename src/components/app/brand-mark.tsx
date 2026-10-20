import { cn } from "@/lib/utils";

// The "w/" monogram of brand manual v1 on its ink tile (same artwork as the favicon and profile image).
// `inverse` drops the tile for surfaces that are already ink, such as the dark sign-in panel.
export function BrandMark({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
        !inverse && "bg-(--brand-ink) dark:ring-1 dark:ring-border",
        className,
      )}
    >
      <svg viewBox="0 0 68 64" className="size-[72%]" fill="none" strokeWidth={7}>
        <polyline
          points="6,16 17,48 28,26 39,48 50,16"
          stroke="var(--brand-paper)"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="62" y1="10" x2="54" y2="54" stroke="var(--brand-cobalt)" strokeLinecap="round" />
      </svg>
    </span>
  );
}
