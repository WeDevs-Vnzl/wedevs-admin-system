import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// FE auth surface (C24, HU-01 CA3): every route needs a Clerk session except the DT-42 public ones.
// The `/api/webhooks/*` entry of DT-42 is obsolete: webhooks are BE routes.
export const PUBLIC_ROUTE_PATTERNS = ["/sign-in(.*)", "/s/(.*)", "/api/s/(.*)"] as const;

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
