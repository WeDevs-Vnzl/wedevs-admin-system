import "server-only";
// The only place that builds the service context (C11, DT-37). Hito 1: `db` is the mock store and the user
// comes from the mock session; this file is one of the few allowed to import `@/mocks/**` (C9). Hito 2
// swaps the body for the Prisma client and the Clerk-backed session; the signatures stay.
import {
  ServiceError,
  createMockContext,
  createMockPublicContext,
  type MockPublicServiceContext,
  type MockServiceContext,
} from "@/mocks/ctx";
import { requireSessionUser } from "@/server/auth/session";

/** `ctx = { db, user, now }`: what every service receives (C11). `now` is the only clock a service may read. */
export type ServiceContext = MockServiceContext;

/** Context of the public portal services: `user` is `null`, the share link travels in the service input. */
export type PublicServiceContext = MockPublicServiceContext;

/** Thrown by services for domain failures (`CONFLICT`, `NOT_FOUND`, …); the action adapters map it. */
export { ServiceError };

/**
 * Context of the current request's signed-in user. Throws `UnauthenticatedError` when nobody is signed in
 * (actions map it to `UNAUTHENTICATED`).
 */
export async function getServiceContext(): Promise<ServiceContext> {
  const user = await requireSessionUser();
  return createMockContext({ user, now: new Date() });
}

/** Context of a public portal call: never reads the session (C10 exception). */
export function getPublicServiceContext(): PublicServiceContext {
  return createMockPublicContext({ now: new Date() });
}
