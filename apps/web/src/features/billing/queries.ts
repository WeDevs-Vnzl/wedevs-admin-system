import "server-only";
import { idSchema } from "@/lib/validators/common";
import * as billing from "@/mocks/services/billing";
import { can } from "@/server/auth/permissions";
import { getServiceContext, ServiceError } from "@/server/context";

// Reads for the billing screen of a project (`/projects/[id]/billing`, PRD §8.4). Billing is finance data: the
// `read` grant on `billing` (Owner and Admin) is checked before the service runs; a missing project is a
// `NOT_FOUND` that the page turns into `notFound()`.

async function readContext() {
  const ctx = await getServiceContext();
  if (!can(ctx.user, "read", "billing")) throw new ServiceError("FORBIDDEN");
  return ctx;
}

export async function getBillingPage(projectId: string) {
  return billing.getBillingPage(await readContext(), idSchema.parse(projectId));
}
