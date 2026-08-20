import type { NextConfig } from "next";

// Content-Security-Policy: deliberately ALLOW-by-https (not a strict nonce policy) so Stripe,
// Convex (ws+https), fonts and images keep working, while still enforcing the high-value,
// non-breaking protections — no framing (clickjacking), no plugins/objects, locked base-uri,
// and auto-upgrade of any http subresource to https. frame-ancestors backs up X-Frame-Options.
const csp = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' https: 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' https: 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' https: data:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https:",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" }, // clickjacking
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): the Gaffer voice call (GafferCall.tsx) needs getUserMedia
  // on our own origin. Everything else stays denied, and mic stays denied to any
  // embedded third-party frame.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: csp },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }, // isolate, but keep Stripe/OAuth popups working
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false, // hide "X-Powered-By: Next.js"
  productionBrowserSourceMaps: false, // don't ship source maps to the browser
  // react-pdf (invoice route) ships its own fonts/wasm — keep it external so Next doesn't bundle it
  serverExternalPackages: ["@react-pdf/renderer"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
