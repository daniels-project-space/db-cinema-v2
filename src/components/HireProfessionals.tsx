"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { Tilt } from "@/components/Tilt";
import { Calendar } from "@/components/booking/Calendar";
import { IconCheck, IconX, IconArrowRight } from "@/components/icons";
import { clientRate } from "@/lib/collective";

const NEON: Record<string, string> = {
  cyan: "#22d3ee", violet: "#a78bfa", amber: "#fbbf24", green: "#34d399",
  pink: "#f472b6", blue: "#60a5fa", orange: "#fb923c",
};

/** Custom line-art symbol per role (stroke = currentColor, glows via the neon tile). */
export function RoleIcon({ role, className }: { role: string; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const svg = (children: React.ReactNode) => (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>{children}</svg>
  );
  switch (role) {
    case "cinematographer":
      return svg(<><rect x="4" y="12" width="16" height="11" rx="2" {...p} /><circle cx="9" cy="8" r="3.2" {...p} /><circle cx="15" cy="8" r="3.2" {...p} /><path d="M20 16l7-3v9l-7-3z" {...p} /></>);
    case "videographer":
      return svg(<><rect x="4" y="11" width="15" height="12" rx="2.5" {...p} /><path d="M19 15l6-3v10l-6-3z" {...p} /><circle cx="11" cy="17" r="3" {...p} /></>);
    case "dop":
      return svg(<><circle cx="16" cy="16" r="8" {...p} /><path d="M16 8l3.5 6M24 16l-7 0M19.5 22l-3.5-6M12.5 22l3.5-6M8 16l7 0M12.5 10l3.5 6" {...p} /><circle cx="16" cy="16" r="2" {...p} /></>);
    case "editor":
      return svg(<><rect x="4" y="7" width="24" height="18" rx="2" {...p} /><path d="M4 13h24M11 7v18M11 16h7" {...p} /><path d="M20 13l4 3-4 3z" {...p} /></>);
    case "music-composer":
      return svg(<><path d="M12 22V8l12-2.5V18" {...p} /><circle cx="9.5" cy="22" r="2.7" {...p} /><circle cx="21.5" cy="18" r="2.7" {...p} /></>);
    case "drone-operator":
      return svg(<><circle cx="8" cy="9" r="3.4" {...p} /><circle cx="24" cy="9" r="3.4" {...p} /><circle cx="8" cy="9" r="0.6" {...p} /><circle cx="24" cy="9" r="0.6" {...p} /><path d="M8 12.4l5 5M24 12.4l-5 5M11 17h10l1.5 4h-13z" {...p} /></>);
    case "sound-operator":
      return svg(<><rect x="12.5" y="5" width="7" height="13" rx="3.5" {...p} /><path d="M9 15a7 7 0 0014 0M16 22v4M12 26h8" {...p} /><path d="M24 9v6M27 11v2" {...p} /></>);
    default:
      return svg(<circle cx="16" cy="16" r="8" {...p} />);
  }
}

const hr = (n: number | null | undefined) => (n == null ? null : `£${clientRate(n)}`);

type Group = { role: string; roleLabel: string; neon: string; pros: any[] };

export function HireProfessionals() {
  const ops = useQuery(api.operators.list);
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [reqPro, setReqPro] = useState<any | null>(null);
  if (!ops || ops.length === 0) return null;

  // group operators by role, preserving roster order
  const map = new Map<string, Group>();
  const groups: Group[] = [];
  for (const o of ops as any[]) {
    let g = map.get(o.role);
    if (!g) { g = { role: o.role, roleLabel: o.roleLabel, neon: o.neon, pros: [] }; map.set(o.role, g); groups.push(g); }
    g.pros.push(o);
  }
  const openGroup = openRole ? map.get(openRole) ?? null : null;

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="hud-label !text-accent-400/90">Crew, not just kit</div>
          <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
            Hire the <span className="serif-accent gradient-text text-[1.06em]">professionals</span>
          </h2>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-white/50">
            <IconCheck className="h-4 w-4 text-emerald-400" />
            Every operator is vetted &amp; <span className="text-white/75">verified by Db Cinema for reliability</span> — booked, contracted and paid through us.
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {groups.map((g, i) => (
          <RoleTile key={g.role} g={g} index={i} onOpen={() => setOpenRole(g.role)} />
        ))}
      </div>

      {openGroup && (
        <RoleExpand
          g={openGroup}
          onClose={() => setOpenRole(null)}
          onRequest={(pro) => { setOpenRole(null); setReqPro(pro); }}
        />
      )}
      {reqPro && <RequestModal op={reqPro} onClose={() => setReqPro(null)} />}
    </section>
  );
}

function RoleTile({ g, index, onOpen }: { g: Group; index: number; onOpen: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const neon = NEON[g.neon] || "var(--color-accent-400)";
  const hrs = g.pros.map((p) => p.rateHourly).filter((n): n is number => n != null);
  const fromHr = hrs.length ? Math.min(...hrs) : null;

  // play continuously while the tile is in view (not tied to the mouse), pause off-screen
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); },
      { threshold: 0.2 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  return (
    <Tilt max={7} className="crew-3d">
      <article
        onClick={onOpen}
        style={{ ["--neon" as string]: neon, animationDelay: `${(index % 6) * 0.4}s` }}
        className="crew-card crew-card--sm group"
      >
        <video
          ref={ref}
          className="crew-video"
          src={`/crew/${g.role}.mp4`}
          poster={`/crew/${g.role}.jpg`}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
        />
        <div className="crew-scrim" />

        <div className="crew-body">
          <div className="flex items-center justify-between gap-2">
            <span className="hud-label" style={{ color: neon }}>{g.roleLabel}</span>
            <span className="crew-verified"><IconCheck className="h-3 w-3" /> Verified</span>
          </div>

          <span className="crew-ico mt-2" style={{ color: neon }}>
            <RoleIcon role={g.role} className="h-8 w-8" />
          </span>

          <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
            {g.pros.length} pro{g.pros.length > 1 ? "s" : ""} available
          </div>

          <div className="mt-auto flex items-center justify-between pt-3">
            <span className="font-display text-sm font-semibold text-white/80">
              {fromHr != null ? <>from <span style={{ color: neon }}>£{clientRate(fromHr)}</span>/hr</> : "Rates on request"}
            </span>
            <span className="crew-cta">
              View <IconArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </article>
    </Tilt>
  );
}

function RoleExpand({ g, onClose, onRequest }: { g: Group; onClose: () => void; onRequest: (pro: any) => void }) {
  const neon = NEON[g.neon] || "var(--color-accent-400)";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ["--neon" as string]: neon }}
        className="hp-modal toast-in relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-charcoal-900/95 p-6 shadow-2xl"
      >
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-white/40 hover:text-white"><IconX className="h-5 w-5" /></button>

        <div className="flex items-center gap-4">
          <span className="hp-ico-lg" style={{ color: neon }}><RoleIcon role={g.role} className="h-11 w-11" /></span>
          <div>
            <div className="hud-label" style={{ color: neon }}>{g.roleLabel}</div>
            <div className="font-display text-2xl font-bold text-white">{g.pros.length} available</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-300"><IconCheck className="h-3.5 w-3.5" /> All vetted &amp; verified by Db Cinema</div>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {g.pros.map((p) => (
            <div key={p._id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
              <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex" style={{ color: neon, background: `color-mix(in srgb, ${neon} 12%, transparent)` }}>
                <RoleIcon role={p.role} className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-base font-bold text-white">
                  {p.firstName} <span className="text-xs font-normal text-white/40">· {p.age ? `${p.age} · ` : ""}{p.years}y</span>
                </div>
                <p className="line-clamp-1 text-xs text-white/50">{p.tagline}</p>
                {p.skills?.length > 0 && (
                  <div className="mt-1.5 hidden flex-wrap gap-1 sm:flex">
                    {p.skills.slice(0, 3).map((s: string) => (
                      <span key={s} className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/55">{s}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="font-display text-lg font-bold" style={{ color: p.rateHourly != null ? neon : undefined }}>
                  {hr(p.rateHourly) ?? "POA"}{p.rateHourly != null && <span className="text-[11px] font-normal text-white/40">/hr</span>}
                </div>
                <button onClick={() => onRequest(p)} className="btn-primary mt-1.5 px-4 py-1.5 text-xs">Request</button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[11px] text-white/35">Hourly shown. Half-day &amp; day rates appear when you request. Booked &amp; paid through Db Cinema.</p>
      </div>
    </div>
  );
}

function RequestModal({ op, onClose }: { op: any; onClose: () => void }) {
  const req = useMutation(api.operators.requestQuote);
  const cats = useQuery(api.catalog.categories) ?? [];
  const neon = NEON[op.neon] || "var(--color-accent-400)";

  const [month, setMonth] = useState(() => new Date());
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [callTime, setCallTime] = useState("");
  const [wrapTime, setWrapTime] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [bringGear, setBringGear] = useState(false);
  const [gear, setGear] = useState<Set<string>>(new Set());
  const [special, setSpecial] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const valid = name.trim() && /\S+@\S+\.\S+/.test(email) && !!start;

  function pick(d: string) {
    if (!start || (start && end)) { setStart(d); setEnd(null); }
    else if (d < start) { setStart(d); }
    else { setEnd(d); }
  }
  function toggleGear(name: string) {
    setGear((g) => {
      const n = new Set(g);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }

  async function send() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await req({
        role: op.roleLabel,
        firstName: op.firstName,
        name,
        email,
        start: start || undefined,
        end: end || undefined,
        callTime: callTime || undefined,
        wrapTime: wrapTime || undefined,
        location: location || undefined,
        gear: bringGear && gear.size > 0 ? Array.from(gear) : undefined,
        specialRequests: special || undefined,
      });
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ["--neon" as string]: neon }}
        className="hp-modal toast-in relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-charcoal-900/95 p-6 shadow-2xl"
      >
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-white/40 hover:text-white"><IconX className="h-5 w-5" /></button>

        <div className="flex items-center gap-4">
          <span className="hp-ico-lg" style={{ color: neon }}><RoleIcon role={op.role} className="h-11 w-11" /></span>
          <div>
            <div className="hud-label" style={{ color: neon }}>{op.roleLabel}</div>
            <div className="font-display text-2xl font-bold text-white">
              {op.firstName} <span className="text-base font-normal text-white/35">· {op.age ? `${op.age} · ` : ""}{op.years} yrs</span>
            </div>
          </div>
        </div>

        {sent ? (
          <div className="mt-6 flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <IconCheck className="h-5 w-5 shrink-0" /> Request sent — we&apos;ll line up {op.firstName} and come back with availability and a quote.
          </div>
        ) : (
          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <div>
              <div className="hud-label mb-2 !text-white/45">Shoot dates</div>
              <Calendar month={month} onMonthChange={setMonth} start={start} end={end} unavailable={new Set()} onPick={pick} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-white/40">Call time</span>
                  <input type="time" value={callTime} onChange={(e) => setCallTime(e.target.value)} className="input w-full [color-scheme:dark]" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-white/40">Wrap time</span>
                  <input type="time" value={wrapTime} onChange={(e) => setWrapTime(e.target.value)} className="input w-full [color-scheme:dark]" />
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="input w-full" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" type="email" className="input w-full" />
              </div>
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wide text-white/40">Location</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where's the shoot? (area / address)" className="input w-full" />
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-white/70">
                  <input type="checkbox" checked={bringGear} onChange={(e) => setBringGear(e.target.checked)} className="h-4 w-4 accent-accent-500" />
                  Ask {op.firstName} to bring gear for the shoot
                </label>
                {bringGear && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {cats.map((c: any) => {
                      const on = gear.has(c.name);
                      return (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() => toggleGear(c.name)}
                          className={`rounded-full px-3 py-1 text-xs transition ${on ? "bg-accent-500 text-white" : "glass text-white/55 hover:text-white"}`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                    {cats.length === 0 && <span className="text-xs text-white/30">Loading gear…</span>}
                  </div>
                )}
              </div>

              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wide text-white/40">Special requests</span>
                <textarea value={special} onChange={(e) => setSpecial(e.target.value)} rows={3} placeholder="Brief, style references, specific gear, anything else." className="input w-full" />
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="grid grid-cols-3 gap-2">
                {[["Hourly", op.rateHourly], ["Half day", op.rateHalfDay], ["Day", op.rateDay]].map(([label, val]: any) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-center">
                    <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</div>
                    <div className="mt-0.5 font-display text-base font-bold" style={{ color: val != null ? neon : undefined }}>{val != null ? `£${clientRate(val)}` : "POA"}</div>
                  </div>
                ))}
              </div>
              <button onClick={send} disabled={!valid || busy} className="btn-primary mt-3 w-full py-3.5">
                {busy ? "Sending…" : `Request ${op.firstName} via Db Cinema`}
              </button>
              <p className="mt-2 text-center text-[11px] text-white/35">
                {!start ? "Pick at least a start date. " : ""}Vetted &amp; verified crew · booked, contracted &amp; paid through Db Cinema.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
