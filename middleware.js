/**
 * Clerk middleware.
 *
 * `getAuth(req)` in the API routes can only verify a Clerk session when the
 * middleware has parsed the request first. Every route stays PUBLIC here
 * (`publicRoutes: () => true`) — the app must keep working exactly as before for
 * wallet-only visitors — while the authenticated Clerk state is attached to the
 * request for the server-side admin checks.
 *
 * Without a Clerk publishable key the middleware is a no-op, so the project can
 * still run wallet-only.
 */
import { NextResponse } from "next/server";
import { authMiddleware } from "@clerk/nextjs/server";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const secretKey = process.env.CLERK_SECRET_KEY;

// Clerk can only verify a session when BOTH keys are present: the publishable key
// identifies the instance and the secret key verifies the token. Running the
// middleware with only the publishable key throws "Missing Clerk Secret Key" and
// would break every route, so the middleware stays a no-op until both are set.
const clerkConfigured =
  typeof publishableKey === "string" &&
  publishableKey.trim().length > 0 &&
  !publishableKey.includes("your_clerk_publishable_key_here") &&
  typeof secretKey === "string" &&
  secretKey.trim().length > 0;

const clerkHandler = clerkConfigured
  ? authMiddleware({
      publicRoutes: () => true,
      ignoredRoutes: ["/api/webhooks/clerk"],
    })
  : null;

export default function middleware(request, event) {
  if (!clerkHandler) return NextResponse.next();

  try {
    return clerkHandler(request, event);
  } catch (error) {
    // Never let an auth middleware problem break the public app.
    console.error("[middleware] Clerk middleware failed:", error?.message);
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next|fonts|examples|favicon.ico|logo.png|manifest.json|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|txt|woff2?)$).*)",
  ],
};
