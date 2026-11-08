import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";

// FE auth surface (C24, HU-01 CA3): every route needs a Clerk session except the DT-42 public ones.
// The `/api/webhooks/*` entry of DT-42 is obsolete: webhooks are BE routes. The portal entry matches exactly
// the one portal page (`/s/[token]`; its files are served by the BE, so the FE `/api/s/*` route is gone): any
// other path falls into the shell's catch-all, which needs a session, so it must get the sign-in redirect instead
// of a 500 (FE-INT-0 F5). Never widen it to `/s/(.*)`.
export const PUBLIC_ROUTE_PATTERNS = ["/sign-in(.*)", "/s/([^/]+)"] as const;

export const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTE_PATTERNS]);

// The portal page itself (one segment, the same set as its `PUBLIC_ROUTE_PATTERNS` entry; a trailing slash allowed).
const PORTAL_PAGE = /^\/s\/[^/]+\/?$/;

const clerk = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect({ unauthenticatedUrl: new URL("/sign-in", request.url).toString() });
  }
});

// The public portal reaches no Clerk at all (PRD: "portal público (sin Clerk)"): `clerkMiddleware` authenticates
// public routes too, and sends a visitor without Clerk cookies through the Clerk handshake redirect. Deeper `/s/`
// paths still go through Clerk (they fall into the shell's catch-all, F5).
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (PORTAL_PAGE.test(request.nextUrl.pathname)) return NextResponse.next();
  return clerk(request, event);
}

export const config = {
  // Skips Next internals and static assets (unless found in search params); always runs for API routes.
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
