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
type GafferTelemetry = {
  counts: {
    connected: number;
    conversationMetadata: number;
    interruption: number;
    agentCorrection: number;
    agentResponseStart: number;
    agentResponseStop: number;
    agentSpeakingStart: number;
    agentSpeakingStop: number;
    disconnected: number;
  };
  events: { sequence: number; kind: string; at: number; providerEventId?: number; agentWasSpeaking?: boolean; originalResponseChars?: number; correctedResponseChars?: number }[];
  eventCount: number;
  timelineTruncated: boolean;
  expiresAt: number;
};
type Detail = { id: string; summary: string | null; durationSecs: number; turns: Turn[]; telemetry: GafferTelemetry | null };
type ProviderAgentSettings = {
  role: string;
  agentId: string;
  name: string | null;
  available: boolean;
  providerStatus: number | null;
  turnEagerness?: string | null;
  turnTimeoutSeconds?: number | null;
  turnModel?: string | null;
  speculativeTurn?: boolean | null;
  interruptionsEnabled?: boolean | null;
  noisyEnvironmentDetection?: boolean | null;
  noisyEnvironmentMessageConfigured?: boolean | null;
  backgroundVoiceDetection?: boolean | null;
  firstMessageInterruptionsDisabled?: boolean | null;
  updatedAt?: number | null;
};

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
  const [voiceSettings, setVoiceSettings] = useState<ProviderAgentSettings[] | null>(null);
  const [voiceSettingsBusy, setVoiceSettingsBusy] = useState(false);
  const [voiceSettingsError, setVoiceSettingsError] = useState<string | null>(null);

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

  async function loadVoiceSettings() {
    setVoiceSettingsBusy(true);
    setVoiceSettingsError(null);
    try {
      const r = await fetch("/api/admin/gaffer-calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, action: "settings" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `Request failed (${r.status})`);
      setVoiceSettings(Array.isArray(j?.agents) ? j.agents : []);
    } catch (e: any) {
      setVoiceSettingsError(e?.message ?? "Could not read provider settings.");
    } finally {
      setVoiceSettingsBusy(false);
    }
  }

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
        <button onClick={() => void loadVoiceSettings()} aria-expanded={voiceSettings !== null} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/65 transition hover:border-accent-300/30 hover:text-white">
          {voiceSettingsBusy ? "Reading…" : "Voice settings"}
        </button>
      </div>

      {voiceSettingsError && <p role="alert" className="mt-2 text-xs text-rose-300/80">{voiceSettingsError}</p>}
      {voiceSettings && <section className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3" aria-label="Read-only voice provider settings">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><strong className="text-xs text-white/80">Voice setup</strong><span className="text-[10px] text-white/35">Provider readback · not an audio test</span></div>
        <div className="mt-2 grid gap-2 md:grid-cols-2">{voiceSettings.map(agent => <article key={agent.agentId} className="rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2">
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs"><strong className="text-white/80">{agent.role}</strong><span className="text-white/40">{agent.name ?? agent.agentId}</span></div>
          {!agent.available ? <p className="mt-2 text-[11px] text-amber-200/80">Provider settings unavailable{agent.providerStatus ? ` · ${agent.providerStatus}` : ""}</p> : <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/45">
            <span>Turn <b className="text-white/75">{agent.turnEagerness ?? "unknown"}</b></span>
            <span>Interruptions <b className="text-white/75">{agent.interruptionsEnabled === null || agent.interruptionsEnabled === undefined ? "unknown" : agent.interruptionsEnabled ? "on" : "off"}</b></span>
            <span>Silence <b className="text-white/75">{agent.turnTimeoutSeconds === null || agent.turnTimeoutSeconds === undefined ? "unknown" : `${agent.turnTimeoutSeconds}s`}</b></span>
            <span>ASR speech filter <b className="text-white/75">{agent.backgroundVoiceDetection === null || agent.backgroundVoiceDetection === undefined ? "unknown" : agent.backgroundVoiceDetection ? "on" : "off"}</b></span>
            <span>Other-voice trigger <b className="text-white/75">{agent.noisyEnvironmentDetection === null || agent.noisyEnvironmentDetection === undefined ? "unknown" : agent.noisyEnvironmentDetection ? "on" : "off"}</b></span>
            <span>Trigger prompt <b className="text-white/75">{agent.noisyEnvironmentMessageConfigured === null || agent.noisyEnvironmentMessageConfigured === undefined ? "unknown" : agent.noisyEnvironmentMessageConfigured ? "set" : "missing"}</b></span>
            {agent.speculativeTurn !== null && agent.speculativeTurn !== undefined && <span>Speculative <b className="text-white/75">{agent.speculativeTurn ? "on" : "off"}</b></span>}
          </div>}
        </article>)}</div>
      </section>}

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
            <div key={c.id} className="rounded-2xl border border-white/[0.06] bg-[#141414]">
              <button
                onClick={() => void openCall(c.id)}
                aria-expanded={open}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-4 text-left"
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
                <span className={`w-full text-sm leading-relaxed text-white/60 ${open?"":"line-clamp-2"}`}>
                  {c.title ? <b className="text-white/85">{c.title}. </b> : null}
                  {c.summary ?? <span className="text-white/25">No summary — call too short, or still processing.</span>}
                </span>
              </button>

              {open && (
                <div className="border-t border-white/[0.06] px-4 py-3">
                  {detailBusy && <div className="text-xs text-white/35">Fetching transcript…</div>}
                  {detail && (
                    <section className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-white/40">Voice timing · metadata only</div>
                      {detail.telemetry ? (
                        <>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/70">
                            <span>{detail.telemetry.counts.interruption} interruptions</span>
                            <span>{detail.telemetry.counts.agentCorrection} corrections</span>
                            <span>{detail.telemetry.counts.agentResponseStart}/{detail.telemetry.counts.agentResponseStop} response starts/stops</span>
                            <span>{detail.telemetry.counts.agentSpeakingStart}/{detail.telemetry.counts.agentSpeakingStop} speech starts/stops</span>
                          </div>
                          <div className="mt-2 flex flex-col gap-1">
                            {detail.telemetry.events.slice(-24).map((event) => (
                              <div key={event.sequence} className="flex items-center gap-2 font-mono text-[10px] text-white/40">
                                <span>{new Date(event.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                                <span>{event.kind.replaceAll("_", " ")}</span>
                                {event.agentWasSpeaking !== undefined && <span>{event.agentWasSpeaking ? "Gaffer speaking" : "Gaffer quiet"}</span>}
                                {event.originalResponseChars !== undefined && event.correctedResponseChars !== undefined && <span>{event.originalResponseChars} → {event.correctedResponseChars} chars</span>}
                                {event.providerEventId !== undefined && <span>provider event {event.providerEventId}</span>}
                              </div>
                            ))}
                          </div>
                          {(detail.telemetry.timelineTruncated || detail.telemetry.events.length > 24) && (
                            <div className="mt-2 text-[10px] text-white/35">Showing the latest {Math.min(24, detail.telemetry.eventCount)} of {detail.telemetry.eventCount} metadata events.</div>
                          )}
                          <div className="mt-2 text-[10px] text-white/30">No audio or transcript content is stored in this diagnostic trace.</div>
                        </>
                      ) : (
                        <div className="mt-2 text-xs text-white/40">No client event trace was recorded for this call.</div>
                      )}
                    </section>
                  )}
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
