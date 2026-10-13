// MOCK — helpers shared by the tests of the mock layer and of the features that read it. Not imported by
// application code. Deleted with `src/mocks/` at the close of Hito 2 (C9).
import type { UserRole } from "@/lib/validators/enums";
import type { SessionUser } from "@/server/auth/types";
import { createMockContext, createMockPublicContext } from "./ctx";
import { buildMockStore, type MockStore } from "./store";

/** Friday 9 Oct 2026, 15:00 UTC (11:00 in Caracas): a business day, so rate fixtures are predictable. */
export const FIXED_NOW = new Date("2026-10-09T15:00:00.000Z");

/** Business "today" (Caracas) of `FIXED_NOW`. */
export const FIXED_TODAY = "2026-10-09";

export function makeSessionUser(role: UserRole = "OWNER", overrides: Partial<SessionUser> = {}) {
  const user: SessionUser = {
    id: "usr_test",
    name: "Test User",
    email: "test.user@example.com",
    imageUrl: null,
    role,
    locale: "es",
    theme: "system",
    ...overrides,
  };
  return user;
}

/** A fresh, isolated store plus a context over it. */
export function makeTestContext(role: UserRole = "OWNER", overrides: Partial<SessionUser> = {}) {
  const db: MockStore = buildMockStore(FIXED_NOW);
  const user = makeSessionUser(role, overrides);
  return { db, user, ctx: createMockContext({ user, now: FIXED_NOW, db }) };
}

export function makeTestPublicContext() {
  const db: MockStore = buildMockStore(FIXED_NOW);
  return { db, ctx: createMockPublicContext({ now: FIXED_NOW, db }) };
}
