"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { Tilt } from "@/components/Tilt";
import { IconCheck, IconX } from "@/components/icons";

const NEON: Record<string, string> = {
  cyan: "#22d3ee", violet: "#a78bfa", amber: "#fbbf24", green: "#34d399",
  pink: "#f472b6", blue: "#60a5fa", orange: "#fb923c",
};

/** Custom line-art symbol per role (stroke = currentColor, glows via the neon tile). */
function RoleIcon({ role, className }: { role: string; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const svg = (children: React.ReactNode) => (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>{children}</svg>
  );
  switch (role) {
    case "cinematographer": // cine camera with reels
      return svg(<><rect x="4" y="12" width="16" height="11" rx="2" {...p} /><circle cx="9" cy="8" r="3.2" {...p} /><circle cx="15" cy="8" r="3.2" {...p} /><path d="M20 16l7-3v9l-7-3z" {...p} /></>);
    case "videographer": // camcorder
      return svg(<><rect x="4" y="11" width="15" height="12" rx="2.5" {...p} /><path d="M19 15l6-3v10l-6-3z" {...p} /><circle cx="11" cy="17" r="3" {...p} /></>);
    case "dop": // aperture / lens with light rays
      return svg(<><circle cx="16" cy="16" r="8" {...p} /><path d="M16 8l3.5 6M24 16l-7 0M19.5 22l-3.5-6M12.5 22l3.5-6M8 16l7 0M12.5 10l3.5 6" {...p} /><circle cx="16" cy="16" r="2" {...p} /></>);
    case "editor": // timeline + playhead
      return svg(<><rect x="4" y="7" width="24" height="18" rx="2" {...p} /><path d="M4 13h24M11 7v18M11 16h7" {...p} /><path d="M20 13l4 3-4 3z" {...p} /></>);
    case "music-composer": // notes
      return svg(<><path d="M12 22V8l12-2.5V18" {...p} /><circle cx="9.5" cy="22" r="2.7" {...p} /><circle cx="21.5" cy="18" r="2.7" {...p} /></>);
    case "drone-operator": // quadcopter
      return svg(<><circle cx="8" cy="9" r="3.4" {...p} /><circle cx="24" cy="9" r="3.4" {...p} /><circle cx="8" cy="9" r="0.6" {...p} /><circle cx="24" cy="9" r="0.6" {...p} /><path d="M8 12.4l5 5M24 12.4l-5 5M11 17h10l1.5 4h-13z" {...p} /></>);
    case "sound-operator": // mic + waves
      return svg(<><rect x="12.5" y="5" width="7" height="13" rx="3.5" {...p} /><path d="M9 15a7 7 0 0014 0M16 22v4M12 26h8" {...p} /><path d="M24 9v6M27 11v2" {...p} /></>);
    default:
      return svg(<circle cx="16" cy="16" r="8" {...p} />);
  }
}

const money = (n: number | null) => (n == null ? null : `£${n}`);

export function HireProfessionals() {
  const ops = useQuery(api.operators.list);
  const [sel, setSel] = useState<any | null>(null);
  if (!ops || ops.length === 0) return null;

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="hud-label !text-accent-400/90">Crew, not just kit</div>
          <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
            Hire the <span className="serif-accent gradient-text text-[1.06em]">professionals</span>
          </h2>
          <p className="mt-1 max-w-xl text-sm text-white/45">Tap a role to see experience, day rates and a quote — all booked through us.</p>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {ops.map((o: any, i: number) => (
          <Tilt key={o._id} max={12} className="hp-3d">
            <button
              onClick={() => setSel(o)}
              style={{ ["--neon" as any]: NEON[o.neon] || "var(--color-accent-400)", animationDelay: `${(i % 7) * 0.35}s` }}
              className="hp-tile group relative flex w-full flex-col items-center gap-2.5 rounded-2xl px-3 py-6 text-center"
            >
              <span className="hp-ico" style={{ color: NEON[o.neon] || "var(--color-accent-400)" }}>
                <RoleIcon role={o.role} className="h-10 w-10" />
              </span>
              <span className="font-display text-sm font-semibold leading-tight text-white/90">{o.roleLabel}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">{o.firstName} · {o.years}y</span>
            </button>
          </Tilt>
        ))}
      </div>

      {sel && <OperatorModal op={sel} onClose={() => setSel(null)} />}
    </section>
  );
}

function OperatorModal({ op, onClose }: { op: any; onClose: () => void }) {
  const req = useMutation(api.operators.requestQuote);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dates, setDates] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const neon = NEON[op.neon] || "var(--color-accent-400)";
  const valid = name.trim() && /\S+@\S+\.\S+/.test(email);

  async function send() {
    if (!valid || busy) return;
    setBusy(true);
    try { await req({ role: op.roleLabel, firstName: op.firstName, name, email, dates: dates || undefined, message: message || undefined }); setSent(true); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ["--neon" as any]: neon }}
        className="hp-modal toast-in relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-charcoal-900/95 p-6 shadow-2xl"
      >
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-white/40 hover:text-white"><IconX className="h-5 w-5" /></button>

        <div className="flex items-center gap-4">
          <span className="hp-ico-lg" style={{ color: neon }}><RoleIcon role={op.role} className="h-12 w-12" /></span>
          <div>
            <div className="hud-label" style={{ color: neon }}>{op.roleLabel}</div>
            <div className="font-display text-2xl font-bold text-white">{op.firstName} <span className="text-white/35 text-base font-normal">· {op.years} yrs</span></div>
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-white/65">{op.tagline}</p>
        {op.skills?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {op.skills.map((s: string) => <span key={s} className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-[11px] text-white/55">{s}</span>)}
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[["Hourly", op.rateHourly], ["Half day", op.rateHalfDay], ["Day", op.rateDay]].map(([label, val]: any) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-center">
              <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</div>
              <div className="mt-0.5 font-display text-lg font-bold" style={{ color: val != null ? neon : undefined }}>{money(val) ?? "POA"}</div>
            </div>
          ))}
        </div>

        {sent ? (
          <div className="mt-5 flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <IconCheck className="h-5 w-5 shrink-0" /> Request sent — we'll line up {op.firstName} and come back with availability.
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="input w-full" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" type="email" className="input w-full" />
            </div>
            <input value={dates} onChange={(e) => setDates(e.target.value)} placeholder="Dates / shoot (e.g. 12–13 July, music video)" className="input w-full" />
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything else?" rows={2} className="input w-full" />
            <button onClick={send} disabled={!valid || busy} className="btn-primary w-full py-3">
              {busy ? "Sending…" : `Request ${op.firstName} via Db Cinema`}
            </button>
            <p className="text-center text-[11px] text-white/35">Booked and managed through Db Cinema — we handle the contract & payment.</p>
          </div>
        )}
      </div>
    </div>
  );
}
