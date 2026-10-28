import { notFound } from "next/navigation";

// Unmatched URLs under the shell render the in-shell not-found (`(app)/not-found.tsx`), so the sidebar and
// topbar stay available. Without this, App Router sends them to the root not-found, which has no shell (R7).
export default function MissingPage() {
  notFound();
}
