import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { BUSINESS_GMAIL_ADDRESS, encryptGmailRefreshToken } from "../../../../../../shared/gmailOAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "dbc_gmail_oauth_state";

function resultRedirect(req: NextRequest, result: string) {
  const url = new URL("/admin", req.nextUrl.origin);
  url.searchParams.set("gmail", result);
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, "", { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/admin/gmail/callback", maxAge: 0 });
  return response;
}

function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const cookieState = req.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!constantTimeEqual(state, cookieState)) return resultRedirect(req, "state-error");
  const oauthError = req.nextUrl.searchParams.get("error");
  if (oauthError) return resultRedirect(req, "consent-denied");

  const code = req.nextUrl.searchParams.get("code") ?? "";
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  const inboundSecret = process.env.INBOUND_EMAIL_SECRET;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!code || !clientId || !clientSecret || !redirectUri || !encryptionKey || !inboundSecret || !convexUrl) return resultRedirect(req, "setup-error");

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!tokenResponse.ok) return resultRedirect(req, "token-error");
    const tokens = await tokenResponse.json() as { access_token?: unknown; refresh_token?: unknown; token_type?: unknown };
    if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string" || tokens.token_type !== "Bearer") return resultRedirect(req, "refresh-token-missing");

    const identityResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!identityResponse.ok) return resultRedirect(req, "identity-error");
    const identity = await identityResponse.json() as { email?: unknown; verified_email?: unknown };
    const email = typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
    if (email !== BUSINESS_GMAIL_ADDRESS || identity.verified_email !== true) return resultRedirect(req, "wrong-account");

    const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!profileResponse.ok) return resultRedirect(req, "gmail-profile-error");
    const profile = await profileResponse.json() as { historyId?: unknown; emailAddress?: unknown };
    if (typeof profile.historyId !== "string" || String(profile.emailAddress ?? "").toLowerCase() !== BUSINESS_GMAIL_ADDRESS) return resultRedirect(req, "gmail-profile-error");

    const encryptedRefreshToken = encryptGmailRefreshToken(tokens.refresh_token, encryptionKey);
    await new ConvexHttpClient(convexUrl).mutation(api.gmailConnection.completeOAuth, {
      secret: inboundSecret,
      email,
      encryptedRefreshToken,
      historyId: profile.historyId,
    });
    return resultRedirect(req, "connected");
  } catch (error) {
    console.error("[gmail oauth] connection failed", String((error as any)?.message ?? error));
    return resultRedirect(req, "connection-error");
  }
}
