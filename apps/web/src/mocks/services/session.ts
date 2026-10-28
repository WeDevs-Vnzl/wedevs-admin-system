// MOCK — "View as role" and "Reset mock data" (DT-32, DT-40). MOCK-only: they exist in Hito 1 and are
// deleted with `src/mocks/` at the close of Hito 2 (C9). `fn(ctx, input)`, framework-free (C11): the
// service validates and acts on the store; the action (`features/session/actions.ts`) writes the role
// cookie, because a service never touches `next/*`.
import type { UserRole } from "@/lib/validators/enums";
import type { MockServiceContext } from "../ctx";
import { resetMockStore } from "../store";

export interface SetMockRoleInput {
  role: UserRole;
}

export interface SetMockRoleResult {
  role: UserRole;
}

export interface ResetMockDataResult {
  /** ISO 8601 UTC instant the store was rebuilt. */
  resetAt: string;
}

/** Accepts the role to view the app as. The override itself lives in the `wd_mock_role` cookie. */
export async function setMockRole(
  _ctx: MockServiceContext,
  input: SetMockRoleInput,
): Promise<SetMockRoleResult> {
  return { role: input.role };
}

/** Rebuilds the store from the fixtures: every mutation made in this server process is discarded. */
export async function resetMockData(ctx: MockServiceContext): Promise<ResetMockDataResult> {
  resetMockStore(ctx.now);
  return { resetAt: ctx.now.toISOString() };
}
