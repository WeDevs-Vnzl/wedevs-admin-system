import "server-only";
import { auth } from "@clerk/nextjs/server";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { UserDetailDto } from "@/lib/api/dto";
import { getServerApi } from "@/lib/api/server";
import type { SessionLocale, SessionTheme, SessionUser } from "./types";

// The session user comes from the BE: `GET /api/v1/me` (BE-1, Q-BE1-2). The role is the BE's DB role
// (C13); nothing here reads Clerk metadata.

/** The fields of `GET /api/v1/me` the session reads, picked from the generated DTO (C8). */
export type MeProfile = Pick<
  UserDetailDto,
  "id" | "name" | "email" | "imageUrl" | "role" | "locale" | "theme"
>;

/** Thrown by `requireSessionUser` when nobody is signed in. Actions map it to `UNAUTHENTICATED`. */
export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED" as const;

  constructor() {
    super("UNAUTHENTICATED");
    this.name = "UnauthenticatedError";
  }
}

const LOCALES: readonly SessionLocale[] = ["es", "en"];
const THEMES: readonly SessionTheme[] = ["light", "dark", "system"];

/**
 * Maps the BE profile to the session user. `locale` and `theme` are plain strings in the contract, so
 * unknown values fall back to the defaults (`es`, `system`) instead of failing the page.
 */
export function toSessionUser(dto: MeProfile): SessionUser {
  const locale = LOCALES.find((value) => value === dto.locale) ?? "es";
  const theme = THEMES.find((value) => value === dto.theme) ?? "system";
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    imageUrl: dto.imageUrl,
    role: dto.role,
    locale,
    theme,
  };
}

/** Where a Clerk user the BE does not know (`401` on `/api/v1/me`) is sent (Q-BE1-2). */
export const NO_ACCESS_PATH = "/sign-in?reason=no-access";

/** The three outcomes of one `GET /api/v1/me` lookup, kept apart so each helper maps them its own way. */
type SessionState =
  { kind: "signed-out" } | { kind: "no-access" } | { kind: "signed-in"; user: SessionUser };

/** One Clerk and one BE lookup per request (React `cache`); both public helpers read this. */
const resolveSession: () => Promise<SessionState> = cache(async () => {
  const { userId } = await auth();
  if (!userId) return { kind: "signed-out" };
  const api = await getServerApi();
  const { data, response } = await api.GET("/api/v1/me");
  if (response.status === 401) return { kind: "no-access" };
  if (!data) throw new Error(`GET /api/v1/me failed with ${response.status}`);
  return { kind: "signed-in", user: toSessionUser(data) };
});

/**
 * The signed-in user of the current request, or `null`: signed out, or a Clerk session the BE does not
 * know (`401`). Any other failure throws. Memoized per request.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const state = await resolveSession();
  return state.kind === "signed-in" ? state.user : null;
}

/**
 * The signed-in user of the current request, or `null` when signed out. A Clerk session without a local user
 * redirects to `/sign-in?reason=no-access`. Read by the mock service context, so the `(app)` shell and every
 * service call send an unknown Clerk user to the no-access state instead of failing.
 */
export async function getSessionUserOrRedirect(): Promise<SessionUser | null> {
  const state = await resolveSession();
  if (state.kind === "no-access") redirect(NO_ACCESS_PATH);
  return state.kind === "signed-in" ? state.user : null;
}

/**
 * The signed-in user of the current request. Signed out throws `UnauthenticatedError` (the proxy already
 * sends signed-out users to `/sign-in`). A Clerk session without a local user redirects to
 * `/sign-in?reason=no-access`, which shows the no-access state and a sign-out action, so it cannot loop.
 */
export async function requireSessionUser(): Promise<SessionUser> {
  const state = await resolveSession();
  if (state.kind === "signed-in") return state.user;
  if (state.kind === "no-access") redirect(NO_ACCESS_PATH);
  throw new UnauthenticatedError();
}
