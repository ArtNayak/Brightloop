import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Logged-in users only; customers are fenced into /portal (pages) and can't hit staff pages.
// API routes enforce their own roles via requireRole().
export default withAuth(
  function proxy(req) {
    const { pathname } = req.nextUrl;
    const role = req.nextauth.token?.role;
    if (role === "CUSTOMER" && !pathname.startsWith("/portal") && !pathname.startsWith("/api")) {
      return NextResponse.redirect(new URL("/portal", req.url));
    }
    if (role !== "CUSTOMER" && pathname.startsWith("/portal")) {
      return NextResponse.redirect(new URL("/reports", req.url));
    }
  },
  { callbacks: { authorized: ({ token }) => !!token } },
);

export const config = {
  matcher: ["/((?!login|register|forgot-password|reset-password|api/auth|api/health|_next|favicon.ico).*)"],
};
