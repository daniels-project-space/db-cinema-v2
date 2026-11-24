import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "dbc_gmail_oauth_state";

export async function POST(req: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!clientId || !redirectUri || !convexUrl) return NextResponse.json({ error: "Gmail OAuth is not configured on the server." }, { status: 503 });

  let token = "";
  try {
    const raw = await req.text();
    if (raw.length > 8192) return NextResponse.json({ error: "Admin authentication is required." }, { status: 401 });
    token = String(JSON.parse(raw)?.token ?? "").trim();
  } catch { /* handled below */ }
  if (!token || token.length > 4096) return NextResponse.json({ error: "Admin authentication is required." }, { status: 401 });
  try {
    const auth = await new ConvexHttpClient(convexUrl).query(api.adminAuth.verify, { token });
    if (!auth.ok) return NextResponse.json({ error: "Admin authentication is required." }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Could not verify admin access." }, { status: 503 });
  }

  const state = randomBytes(32).toString("base64url");
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: "openid email https://www.googleapis.com/auth/gmail.modify",
    state,
    login_hint: "info@dbcinemarentals.com",
  }).toString();

  const response = NextResponse.json({ authorizationUrl: authorization.toString() });
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/admin/gmail/callback",
    maxAge: 600,
  });
  return response;
}
