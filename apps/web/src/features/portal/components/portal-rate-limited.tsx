import Link from "next/link";
import { ClockIcon } from "lucide-react";
import { BrandMark } from "@/components/app/brand-mark";
import { Button } from "@/components/ui/button";
import enPortal from "@/i18n/messages/en/portal.json";
import esPortal from "@/i18n/messages/es/portal.json";

/**
 * The "try again" state of the portal when its probe is rate limited (DT-212). Like the generic 404 it speaks both
 * languages (the link's own is unknown here) and never says anything about the link.
 */
export function PortalRateLimited({ token }: { token: string }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <div className="flex items-center gap-2.5">
        <BrandMark />
        <span className="text-base font-semibold">{esPortal.brand}</span>
      </div>
      <span className="flex size-12 items-center justify-center rounded-full border bg-muted text-muted-foreground">
        <ClockIcon aria-hidden className="size-5" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 lang="es" className="text-2xl font-semibold tracking-tight">
          {esPortal.rateLimited.title}
        </h1>
        <p lang="es" className="text-sm text-muted-foreground">
          {esPortal.rateLimited.description}
        </p>
      </div>
      <div className="flex flex-col gap-1 border-t pt-6">
        <p lang="en" className="text-base font-medium">
          {enPortal.rateLimited.title}
        </p>
        <p lang="en" className="text-sm text-muted-foreground">
          {enPortal.rateLimited.description}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href={`/s/${encodeURIComponent(token)}`} prefetch={false}>
          <span lang="es">{esPortal.rateLimited.retry}</span>
          <span aria-hidden>/</span>
          <span lang="en">{enPortal.rateLimited.retry}</span>
        </Link>
      </Button>
    </main>
  );
}
