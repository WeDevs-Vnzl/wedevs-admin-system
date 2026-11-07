import type { UserRole } from "@/lib/validators/enums";
import type { SessionUser } from "./types";

/** Test helper: a `SessionUser` with sensible defaults (same shape the BE `/me` mapping produces). */
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
