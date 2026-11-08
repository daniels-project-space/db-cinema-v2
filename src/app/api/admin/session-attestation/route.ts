import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { adminSessionGatewayReady, makeAdminSessionAttestation } from "@/lib/adminSessionGateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (!adminSessionGatewayReady()) return new Response("Admin session unavailable", { status: 503, headers });
  const expectedOrigin = process.env.ADMIN_SESSION_GATEWAY_ORIGIN;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.ADMIN_SESSION_GATEWAY_HMAC_V2;
  const authorization = request.headers.get("authorization") ?? "";
  const ip = request.headers.get("x-vercel-forwarded-for") ?? "";
  if (process.env.VERCEL !== "1" || !expectedOrigin || request.headers.get("origin") !== expectedOrigin ||
      !convexUrl || !secret || !/^Bearer [^\s]{1,8192}$/.test(authorization))
    return new Response("Unauthorized", { status: 401, headers });
  try {
    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(authorization.slice(7));
    const identityDigest = await client.query(api.adminAccountSessionV2.gatewayIdentityDigest, {});
    const attestation = makeAdminSessionAttestation(identityDigest, ip, secret);
    return Response.json(attestation, { headers });
  } catch {
    return new Response("Unauthorized", { status: 401, headers });
  }
}
