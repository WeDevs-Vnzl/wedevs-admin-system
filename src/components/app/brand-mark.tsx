import { cn } from "@/lib/utils";

// The black circular "W" mark of the wireframes (login card, 40 px; DT-51). Drawn in code because the
// wireframe logo is an external image; `inverse` is the white variant for the dark sign-in panel.
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
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        inverse
          ? "bg-white text-neutral-950"
          : "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950",
        className,
      )}
    >
      W
    </span>
  );
}
