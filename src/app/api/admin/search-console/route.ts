import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { buildSearchConsoleDateRange, summarizeSearchConsoleRows, type SearchConsoleRow } from "@/lib/searchConsoleInsights";

const GOOGLE_SEARCH_CONSOLE_PROPERTY = "https://dbcinemarentals.com/";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SEARCH_ANALYTICS_URL = "https://www.googleapis.com/webmasters/v3/sites";
const GOOGLE_READ_ONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchConsoleResponse = { rows?: SearchConsoleRow[] };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function isAdmin(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0 || token.length > 500) return false;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return false;
  try {
    const result = await new ConvexHttpClient(convexUrl).query(api.adminAuth.verify, { token });
    return result?.ok === true;
  } catch {
    return false;
  }
}

async function getGoogleAccessToken() {
  const clientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error("google_auth_unavailable");
  }
  if (!response.ok) throw new Error("google_auth_failed");
  const body = await response.json().catch(() => null) as { access_token?: unknown } | null;
  if (typeof body?.access_token !== "string" || !body.access_token) throw new Error("google_auth_failed");
  return body.access_token;
}

async function querySearchConsole(accessToken: string, dimension: string, startDate: string, endDate: string, rowLimit: number) {
  const property = encodeURIComponent(GOOGLE_SEARCH_CONSOLE_PROPERTY);
  let response: Response;
  try {
    response = await fetch(`${GOOGLE_SEARCH_ANALYTICS_URL}/${property}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, dimensions: [dimension], type: "web", rowLimit, dataState: "final" }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error("google_search_unavailable");
  }
  if (response.status === 401) throw new Error("google_auth_failed");
  if (response.status === 403) throw new Error("google_property_forbidden");
  if (response.status === 429) throw new Error("google_rate_limited");
  if (!response.ok) throw new Error("google_search_unavailable");
  const body = await response.json().catch(() => null) as SearchConsoleResponse | null;
  return Array.isArray(body?.rows) ? body.rows : [];
}

function dimensionRows(rows: SearchConsoleRow[]) {
  return rows.flatMap(row => {
    const name = row.keys?.[0];
    if (!name) return [];
    return [{ name, ...summarizeSearchConsoleRows([row]) }];
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  if (!(await isAdmin(body?.token))) return json({ status: "unauthorized" }, 401);

  const accessToken = await getGoogleAccessToken().catch(error => error instanceof Error ? error.message : "google_auth_failed");
  if (accessToken === null) return json({ status: "not_configured", property: GOOGLE_SEARCH_CONSOLE_PROPERTY }, 200);
  if (typeof accessToken !== "string") {
    return json({ status: "error", reason: accessToken }, 502);
  }

  const days = typeof body.days === "number" ? body.days : 30;
  const range = buildSearchConsoleDateRange(days, Date.now());
  try {
    const [dateRows, queryRows, pageRows] = await Promise.all([
      querySearchConsole(accessToken, "date", range.startDate, range.endDate, 100),
      querySearchConsole(accessToken, "query", range.startDate, range.endDate, 50),
      querySearchConsole(accessToken, "page", range.startDate, range.endDate, 50),
    ]);
    const daily = new Map(dateRows.flatMap(row => row.keys?.[0] ? [[row.keys[0], summarizeSearchConsoleRows([row])] as const] : []));
    const series = Array.from({ length: range.days }, (_, index) => {
      const [year, month, day] = range.startDate.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day + index)).toISOString().slice(0, 10);
      return { date, ...(daily.get(date) ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 }) };
    });
    return json({
      status: "connected",
      property: GOOGLE_SEARCH_CONSOLE_PROPERTY,
      range,
      summary: summarizeSearchConsoleRows(dateRows),
      series,
      topQueries: dimensionRows(queryRows),
      topPages: dimensionRows(pageRows),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "google_search_unavailable";
    if (reason === "google_property_forbidden") return json({ status: "error", reason }, 502);
    if (reason === "google_rate_limited") return json({ status: "error", reason }, 503);
    return json({ status: "error", reason: reason.startsWith("google_auth") ? reason : "google_search_unavailable" }, 502);
  }
}
