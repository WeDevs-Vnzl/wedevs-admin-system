import { cn } from "@/lib/utils";

// Record code such as CLI-0007, monospaced in a pill.
export function EntityCodeChip({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground",
        className,
      )}
    >
      {code}
    </span>
  );
}
