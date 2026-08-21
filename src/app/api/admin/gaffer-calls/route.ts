import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";

/**
 * INTERNAL ONLY — admin transcript feed for the Gaffer voice agent.
 *
 * ElevenLabs already stores every conversation (web calls from <GafferCall> and
 * phone calls forwarded from SignalWire both land on the same agent), along with
 * a post-call `transcript_summary`. So this proxies their API rather than
 * duplicating transcripts into Convex — one source of truth, nothing to keep in
 * sync, and no post-call webhook to configure.
 *
 * POST (not GET) so the admin token never lands in a URL, a referrer or an
 * access log. The token is verified against ADMIN_TOKEN inside Convex; the
 * ElevenLabs key is read here and never leaves the server.
 *
 *   { token }                      → { calls, metrics }
 *   { token, conversationId }      → full transcript for one call
 */

const AGENT_ID = "agent_4601kvk2pfznfrws6ah700jnxvfv";
const EL = "https://api.elevenlabs.io/v1/convai";
const MAX_PAGES = 10; // 10 x 100 conversations — bounds a cold admin load

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ElConversation = {
  conversation_id: string;
  start_time_unix_secs: number;
  call_duration_secs: number;
  message_count: number;
  status: string;
  call_successful: "success" | "failure" | "unknown";
  transcript_summary?: string | null;
  call_summary_title?: string | null;
  conversation_initiation_source?: string | null;
  direction?: string | null;
  termination_reason?: string;
};

/** widget / SDK sources are someone on the website; the rest came down the phone line */
const WEB_SOURCES = new Set([
  "widget", "js_sdk", "react_sdk", "node_js_sdk", "python_sdk",
  "react_native_sdk", "android_sdk", "swift_sdk", "flutter_sdk",
]);

async function isAdmin(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0) return false;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return false;
  try {
    const res = await new ConvexHttpClient(url).query(api.adminAuth.verify, { token });
    return res?.ok === true;
  } catch {
    return false;
  }
}

function el(path: string, key: string) {
  return fetch(`${EL}${path}`, {
    headers: { "xi-api-key": key },
    cache: "no-store",
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));

  if (!(await isAdmin(body?.token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set on this deployment." },
      { status: 503 },
    );
  }

  // ── one conversation → full transcript ──
  if (typeof body.conversationId === "string" && body.conversationId) {
    const r = await el(`/conversations/${encodeURIComponent(body.conversationId)}`, key);
    if (!r.ok) {
      return NextResponse.json(
        { error: `ElevenLabs returned ${r.status} for that conversation.` },
        { status: 502 },
      );
    }
    const d: any = await r.json();
    return NextResponse.json({
      id: body.conversationId,
      status: d.status ?? "unknown",
      startedAt: (d.metadata?.start_time_unix_secs ?? 0) * 1000,
      durationSecs: d.metadata?.call_duration_secs ?? 0,
      summary: d.analysis?.transcript_summary ?? null,
      callSuccessful: d.analysis?.call_successful ?? "unknown",
      // tool calls and empty system turns are noise for a human reading a transcript
      turns: (Array.isArray(d.transcript) ? d.transcript : [])
        .filter((t: any) => typeof t?.message === "string" && t.message.trim())
        .map((t: any) => ({
          role: t.role === "agent" ? "gaffer" : "caller",
          at: t.time_in_call_secs ?? 0,
          message: String(t.message),
        })),
    });
  }

  // ── list + metrics ──
  const all: ElConversation[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      agent_id: AGENT_ID,
      page_size: "100",
      summary_mode: "include", // defaults to exclude — without this there are no summaries
    });
    if (cursor) q.set("cursor", cursor);

    const r = await el(`/conversations?${q}`, key);
    if (!r.ok) {
      return NextResponse.json(
        { error: `ElevenLabs returned ${r.status} listing conversations.` },
        { status: 502 },
      );
    }
    const d: any = await r.json();
    all.push(...((d.conversations ?? []) as ElConversation[]));
    cursor = d.has_more ? (d.next_cursor ?? null) : null;
    if (!cursor) break;
  }

  const calls = all
    .map((c) => {
      const src = c.conversation_initiation_source ?? "unknown";
      return {
        id: c.conversation_id,
        startedAt: c.start_time_unix_secs * 1000,
        durationSecs: c.call_duration_secs ?? 0,
        messageCount: c.message_count ?? 0,
        status: c.status,
        callSuccessful: c.call_successful ?? "unknown",
        title: c.call_summary_title ?? null,
        summary: c.transcript_summary ?? null,
        channel: WEB_SOURCES.has(src) ? "web" : src === "unknown" ? "unknown" : "phone",
        source: src,
        terminationReason: c.termination_reason || null,
      };
    })
    .sort((a, b) => b.startedAt - a.startedAt);

  const now = Date.now();
  const since = (days: number) => now - days * 86_400_000;
  // only calls that actually connected count as conversations worth measuring
  const real = calls.filter((c) => c.durationSecs > 0);
  const totalSecs = real.reduce((s, c) => s + c.durationSecs, 0);

  return NextResponse.json({
    calls,
    metrics: {
      total: calls.length,
      connected: real.length,
      last24h: calls.filter((c) => c.startedAt >= since(1)).length,
      last7d: calls.filter((c) => c.startedAt >= since(7)).length,
      last30d: calls.filter((c) => c.startedAt >= since(30)).length,
      web: calls.filter((c) => c.channel === "web").length,
      phone: calls.filter((c) => c.channel === "phone").length,
      totalSecs,
      avgSecs: real.length ? Math.round(totalSecs / real.length) : 0,
      successful: calls.filter((c) => c.callSuccessful === "success").length,
      failed: calls.filter((c) => c.callSuccessful === "failure").length,
      truncated: all.length >= MAX_PAGES * 100,
    },
  });
}
