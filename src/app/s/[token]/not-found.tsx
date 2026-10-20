import { LinkIcon } from "lucide-react";
import { BrandMark } from "@/components/app/brand-mark";
import enPortal from "@/i18n/messages/en/portal.json";
import esPortal from "@/i18n/messages/es/portal.json";

/**
 * The generic "Enlace no disponible" page of the portal (PRD §8.11, C22), status 404. Shown alike for unknown,
 * revoked and expired tokens: it never says why. The link's language is unknown here, so it speaks both.
 */
export default function PortalNotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <div className="flex items-center gap-2.5">
        <BrandMark />
        <span className="text-base font-semibold">{esPortal.brand}</span>
      </div>
      <span className="flex size-12 items-center justify-center rounded-full border bg-muted text-muted-foreground">
        <LinkIcon aria-hidden className="size-5" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 lang="es" className="text-2xl font-semibold tracking-tight">
          {esPortal.notFound.title}
        </h1>
        <p lang="es" className="text-sm text-muted-foreground">
          {esPortal.notFound.description}
        </p>
      </div>
      <div className="flex flex-col gap-1 border-t pt-6">
        <p lang="en" className="text-base font-medium">
          {enPortal.notFound.title}
        </p>
        <p lang="en" className="text-sm text-muted-foreground">
          {enPortal.notFound.description}
        </p>
      </div>
    </main>
  );
}
