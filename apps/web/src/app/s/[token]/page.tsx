import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PortalRateLimited } from "@/features/portal/components/portal-rate-limited";
import { PortalView } from "@/features/portal/components/portal-view";
import { loadPortalPage } from "@/features/portal/queries";

type PageProps = { params: Promise<{ token: string }> };

// Public portal (PRD §8.11, DT-42, C22): no session, never cached. The `X-Robots-Tag`, `Referrer-Policy` and
// `Cache-Control` headers come from `next.config.ts`; the metadata repeats them for the document itself.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WeDevs",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** `/s/[token]`: the portal of a live link; an unknown, revoked or expired token gets the generic 404, a rate-limited probe the
 * "try again" state (Next cannot set a 429 status from a page). */
export default async function PortalPage({ params }: PageProps) {
  const { token } = await params;
  const result = await loadPortalPage(token);
  if (result.kind === "not-found") notFound();
  if (result.kind === "rate-limited") return <PortalRateLimited token={token} />;
  return <PortalView token={token} page={result.page} />;
}
