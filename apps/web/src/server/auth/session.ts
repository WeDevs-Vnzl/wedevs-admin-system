import "server-only";
// Hito 1: the session comes from the mock layer. This file is one of the few allowed to import
// `@/mocks/**` (C9); in Hito 2 it resolves the Clerk user and loads the local `User` row instead.
import { getMockSessionUser } from "@/mocks/session";
import type { SessionUser } from "./types";

/** Thrown by `requireSessionUser` when nobody is signed in. Actions map it to `UNAUTHENTICATED`. */
export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED" as const;

  constructor() {
    super("UNAUTHENTICATED");
    this.name = "UnauthenticatedError";
  }
}

/** The signed-in user of the current request, or `null`. */
export async function getSessionUser(): Promise<SessionUser | null> {
  return getMockSessionUser();
}

/** The signed-in user of the current request; throws `UnauthenticatedError` when there is none. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}
