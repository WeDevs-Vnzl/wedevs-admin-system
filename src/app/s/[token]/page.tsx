import type { Metadata } from "next";
import { notFound } from "next/navigation";
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

/** `/s/[token]`: the portal of a live link; an unknown, revoked or expired token gets the generic 404. */
export default async function PortalPage({ params }: PageProps) {
  const { token } = await params;
  const page = await loadPortalPage(token);
  if (!page) notFound();
  return <PortalView token={token} page={page} />;
}
