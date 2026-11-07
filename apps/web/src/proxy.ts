import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// FE auth surface (C24, HU-01 CA3): every route needs a Clerk session except the DT-42 public ones.
// The `/api/webhooks/*` entry of DT-42 is obsolete: webhooks are BE routes. The portal entries match exactly
// the two portal routes (`/s/[token]`, `/api/s/[token]/files/[documentId]`): any other path falls into the shell's
// catch-all, which needs a session, so it must get the sign-in redirect instead of a 500 (FE-INT-0 F5).
export const PUBLIC_ROUTE_PATTERNS = [
  "/sign-in(.*)",
  "/s/([^/]+)",
  "/api/s/([^/]+)/files/([^/]+)",
] as const;

export const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTE_PATTERNS]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect({ unauthenticatedUrl: new URL("/sign-in", request.url).toString() });
  }
});

export const config = {
  // Skips Next internals and static assets (unless found in search params); always runs for API routes.
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
