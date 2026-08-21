"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * INTERNAL ONLY — Gaffer voice-call log for the admin panel.
 *
 * Nothing here is ever rendered on a public route: it lives behind the admin
 * passcode gate, and the data is fetched through /api/admin/gaffer-calls, which
 * re-checks the token server-side (a stolen bundle gets you nothing).
 *
 * Transcripts are pulled on demand, one call at a time, so opening this tab
 * doesn't drag hundreds of full conversations over the wire.
 */

type Call = {
  id: string;
  startedAt: number;
  durationSecs: number;
  messageCount: number;
  status: string;
  callSuccessful: "success" | "failure" | "unknown";
  title: string | null;
  summary: string | null;
  channel: "web" | "phone" | "unknown";
  source: string;
  terminationReason: string | null;
};

type Metrics = {
  total: number;
  connected: number;
  last24h: number;
  last7d: number;
  last30d: number;
  web: number;
  phone: number;
  totalSecs: number;
  avgSecs: number;
  successful: number;
  failed: number;
  truncated: boolean;
};

type Turn = { role: "gaffer" | "caller"; at: number; message: string };
type Detail = { id: string; summary: string | null; durationSecs: number; turns: Turn[] };

const dur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const when = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="rounded-2xl glass p-4">
      <div className={`font-display text-2xl font-bold ${accent ? "gradient-text" : "text-white/90"}`}>{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-white/40">{label}</div>
    </div>
  );
}

export function AdminGafferCalls({ token }: { token: string }) {
  const [data, setData] = useState<{ calls: Call[]; metrics: Metrics } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/gaffer-calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `Request failed (${r.status})`);
      setData(j);
    } catch (e: any) {
      setError(e?.message ?? "Could not load calls.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function openCall(id: string) {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    setDetailBusy(true);
    try {
      const r = await fetch("/api/admin/gaffer-calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, conversationId: id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Transcript unavailable.");
      setDetail(j);
    } catch (e: any) {
      setError(e?.message ?? "Transcript unavailable.");
    } finally {
      setDetailBusy(false);
    }
  }

  if (loading) return <div className="mt-6 text-sm text-white/35">Loading Gaffer calls…</div>;

  if (error && !data) {
    return (
      <div className="mt-6 rounded-xl border border-rose-400/25 bg-rose-500/[0.06] px-4 py-3 text-sm text-rose-200/90">
        {error}
        <button onClick={() => void load()} className="ml-3 underline underline-offset-2 hover:text-white">
          Retry
        </button>
      </div>
    );
  }

  const m = data!.metrics;
  const calls = data!.calls;

  return (
    <section className="mt-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Gaffer calls · total" value={m.total} accent />
        <Tile label="Calls · 7 days" value={m.last7d} />
        <Tile label="Calls · 24h" value={m.last24h} />
        <Tile label="Avg call length" value={dur(m.avgSecs)} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl glass px-4 py-2 text-xs text-white/50">
        <span><b className="text-white/80">{m.web}</b> from the website</span>
        <span className="text-white/20">·</span>
        <span><b className="text-white/80">{m.phone}</b> by phone</span>
        <span className="text-white/20">·</span>
        <span><b className="text-white/80">{m.last30d}</b> in 30 days</span>
        <span className="text-white/20">·</span>
        <span><b className="text-white/80">{dur(m.totalSecs)}</b> total talk time</span>
        <span className="text-white/20">·</span>
        <span><b className="text-emerald-300">{m.successful}</b> rated successful</span>
        {m.failed > 0 && (
          <>
            <span className="text-white/20">·</span>
            <span><b className="text-rose-300">{m.failed}</b> failed</span>
          </>
        )}
        <button onClick={() => void load()} className="ml-auto text-white/40 underline underline-offset-2 hover:text-white/80">
          Refresh
        </button>
      </div>

      {m.truncated && (
        <p className="mt-2 text-[11px] text-amber-200/70">
          Showing the most recent 1,000 conversations — older calls are in the ElevenLabs dashboard.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-rose-300/80">{error}</p>}

      <h2 className="mt-8 font-display text-lg font-semibold text-white/80">
        Conversations ({calls.length})
      </h2>

      <div className="mt-3 flex flex-col gap-2">
        {calls.length === 0 && <div className="text-sm text-white/30">No calls yet.</div>}

        {calls.map((c) => {
          const open = openId === c.id;
          return (
            <div key={c.id} className="rounded-xl glass">
              <button
                onClick={() => void openCall(c.id)}
                aria-expanded={open}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left"
              >
                <span
                  className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                    c.channel === "phone"
                      ? "bg-sky-500/15 text-sky-300"
                      : "bg-accent-500/15 text-accent-300"
                  }`}
                >
                  {c.channel === "phone" ? "Phone" : c.channel === "web" ? "Web" : c.source}
                </span>
                <span className="font-mono text-xs text-white/45">{when(c.startedAt)}</span>
                <span className="font-mono text-xs text-white/45">{dur(c.durationSecs)}</span>
                <span className="text-xs text-white/30">{c.messageCount} turns</span>
                {c.callSuccessful !== "unknown" && (
                  <span
                    className={`text-[10px] uppercase tracking-wide ${
                      c.callSuccessful === "success" ? "text-emerald-400/80" : "text-rose-400/80"
                    }`}
                  >
                    {c.callSuccessful}
                  </span>
                )}
                <span className="ml-auto text-xs text-white/30">{open ? "Hide" : "Transcript"}</span>

                {/* what the caller actually wanted — the bit worth scanning */}
                <span className="w-full text-sm text-white/70">
                  {c.title ? <b className="text-white/85">{c.title}. </b> : null}
                  {c.summary ?? <span className="text-white/25">No summary — call too short, or still processing.</span>}
                </span>
              </button>

              {open && (
                <div className="border-t border-white/[0.06] px-4 py-3">
                  {detailBusy && <div className="text-xs text-white/35">Fetching transcript…</div>}
                  {detail && detail.turns.length === 0 && (
                    <div className="text-xs text-white/35">No spoken turns recorded on this call.</div>
                  )}
                  {detail && detail.turns.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {detail.turns.map((t, i) => (
                        <div key={i} className="flex gap-3 text-sm">
                          <span className="w-10 shrink-0 pt-0.5 text-right font-mono text-[10px] text-white/25">
                            {dur(t.at)}
                          </span>
                          <span
                            className={`w-14 shrink-0 text-[10px] uppercase tracking-wide ${
                              t.role === "gaffer" ? "text-accent-300/80" : "text-white/40"
                            }`}
                          >
                            {t.role === "gaffer" ? "Gaffer" : "Caller"}
                          </span>
                          <span className={t.role === "gaffer" ? "text-white/75" : "text-white/90"}>
                            {t.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
