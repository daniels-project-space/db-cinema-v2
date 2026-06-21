"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { RoleIcon } from "@/components/HireProfessionals";
import { IconCheck, IconArrowRight, IconChevronLeft } from "@/components/icons";
import {
  COLLECTIVE_ROLES, GEAR_PROVIDER_TERMS, GEAR_SPLIT,
  PROFESSIONAL_TERMS, PROFESSIONAL_PERKS, RENTAL_TERMS_HREF,
  CLIENT_MARKUP, CREATIVE_COMMISSION, benchmarkFor,
} from "@/lib/collective";

type Path = "gear-provider" | "professional";

export default function JoinPage() {
  const [path, setPath] = useState<Path | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-3xl px-6 py-14">
        {!path && !sent && (
          <div className="page-in">
            <div className="hud-label !text-accent-400/90">Db Cinema</div>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Join the <span className="serif-accent gradient-text text-[1.06em]">Creative Collective</span>
            </h1>
            <p className="serif-accent mt-5 max-w-2xl text-xl leading-relaxed text-white/60">
              Put your gear to work, or get hired on London shoots. Two ways in — pick yours.
            </p>

            <div className="mt-9 grid gap-4 sm:grid-cols-2">
              <ChoiceCard
                onClick={() => setPath("gear-provider")}
                eyebrow="Earn from your kit"
                title="List your gear"
                body={`Put idle equipment on our catalogue. We handle listing, bookings, vetting and insurance — you keep ${GEAR_SPLIT.provider}% of every rental.`}
                bullets={[`${GEAR_SPLIT.provider}% of rental revenue to you`, "You keep full ownership", "We manage renters & insurance"]}
              />
              <ChoiceCard
                onClick={() => setPath("professional")}
                eyebrow="Get hired"
                title="Join as a professional"
                body="Add your profile to our crew roster. Clients book you through Db Cinema for shoots across London — and you unlock crew-only perks."
                bullets={["50% off our gear for your shoots", "We bring you clients directly", "Verified-crew badge clients trust"]}
              />
            </div>

            <p className="mt-8 flex items-center gap-2 text-sm text-white/40">
              <IconCheck className="h-4 w-4 text-accent-400" />
              Every application is reviewed by hand — nothing goes live until we approve it.
            </p>
          </div>
        )}

        {path && !sent && (
          <div className="page-in">
            <button
              onClick={() => setPath(null)}
              className="group inline-flex items-center gap-1.5 text-sm text-white/40 transition-colors hover:text-white"
            >
              <IconChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              Back
            </button>
            {path === "gear-provider" ? (
              <GearProviderForm onSent={() => setSent(true)} />
            ) : (
              <ProfessionalForm onSent={() => setSent(true)} />
            )}
          </div>
        )}

        {sent && (
          <div className="page-in mx-auto max-w-xl text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/10">
              <IconCheck className="h-8 w-8 text-emerald-300" />
            </div>
            <h1 className="mt-6 font-display text-3xl font-bold text-white">Application received</h1>
            <p className="mt-3 leading-relaxed text-white/55">
              Thanks — it&apos;s with our team for review. We look at every application by hand and come back to you by
              email. Nothing is published until we approve it.
            </p>
            <Link href="/gear" className="btn-primary mt-7 px-7 py-3">
              Browse the catalogue
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </main>
    </>
  );
}

function ChoiceCard({
  onClick,
  eyebrow,
  title,
  body,
  bullets,
}: {
  onClick: () => void;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
}) {
  return (
    <button onClick={onClick} className="lift spot gradient-border group block h-full rounded-2xl p-6 text-left">
      <span className="hud-label !text-accent-400/80">{eyebrow}</span>
      <h2 className="mt-3 font-display text-2xl font-semibold text-white/90 transition-colors group-hover:text-white">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/50">{body}</p>
      <ul className="mt-4 space-y-1.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm text-white/65">
            <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-400" />
            {b}
          </li>
        ))}
      </ul>
      <span className="mt-5 inline-flex items-center gap-1.5 text-sm text-accent-400">
        Start <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </span>
    </button>
  );
}

const field = "input w-full";
const labelCls = "mb-1 block text-xs font-medium uppercase tracking-wide text-white/40";

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function PricingCoach({
  role,
  rateDay,
  onUseRecommended,
}: {
  role: string;
  rateDay: string;
  onUseRecommended: (bm: ReturnType<typeof benchmarkFor>) => void;
}) {
  const bm = benchmarkFor(role);
  const v = rateDay.trim() ? Number(rateDay) : null;
  let fb: { cls: string; text: string } | null = null;
  if (v != null && !Number.isNaN(v)) {
    if (v <= bm.recDay) fb = { cls: "text-emerald-300", text: "✓ Competitive — you'll be shown ahead of pricier crew." };
    else if (v <= bm.avgDay) fb = { cls: "text-white/55", text: "Around the going rate — undercut a little to win more." };
    else fb = { cls: "text-amber-300", text: "Above average — consider lowering to get picked first." };
  }
  return (
    <div className="rounded-2xl border border-accent-400/20 bg-accent-500/[0.05] p-4">
      <div className="flex items-center justify-between">
        <span className="hud-label !text-accent-400/90">Pricing coach</span>
        <button type="button" onClick={() => onUseRecommended(bm)} className="rounded-full bg-accent-500/20 px-3 py-1 text-xs text-accent-300 hover:bg-accent-500/30">
          Use £{bm.recDay}/day
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-white/40">Others typically list</div>
          <div className="font-display text-lg font-bold text-white">£{bm.avgDay}<span className="text-xs font-normal text-white/40">/day</span></div>
          <div className="text-[11px] text-white/40">≈ £{bm.avgHr}/hr</div>
        </div>
        <div>
          <div className="text-xs text-white/40">Recommended — wins bookings</div>
          <div className="font-display text-lg font-bold text-accent-300">£{bm.recDay}<span className="text-xs font-normal text-white/40">/day</span></div>
          <div className="text-[11px] text-white/40">≈ £{bm.recHr}/hr</div>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-white/55">
        💡 Undercut the average to rank higher and get picked first. Quotes at or below <b className="text-accent-300">£{bm.recDay}/day</b> win the most work — raise it once you&apos;ve built up reviews.
      </p>
      {fb && <p className={`mt-1.5 text-xs font-medium ${fb.cls}`}>{fb.text}</p>}
    </div>
  );
}

// ─────────────────────────── Gear provider ───────────────────────────
function GearProviderForm({ onSent }: { onSent: () => void }) {
  const apply = useMutation(api.collective.apply);
  const [f, setF] = useState({ fullName: "", email: "", phone: "", gearList: "", gearValue: "", notes: "" });
  const [agree, setAgree] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = f.fullName.trim() && /\S+@\S+\.\S+/.test(f.email) && f.phone.trim() && f.gearList.trim() && f.gearValue.trim() && agree && agreeTerms;
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await apply({
        kind: "gear-provider",
        fullName: f.fullName.trim(),
        email: f.email.trim(),
        phone: f.phone.trim(),
        gearList: f.gearList.trim(),
        gearValue: f.gearValue.trim(),
        notes: f.notes.trim() || undefined,
        agreementAccepted: true,
        termsAgreed: true,
      });
      onSent();
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="hud-label !text-accent-400/90">Gear provider</div>
      <h1 className="mt-2 font-display text-3xl font-bold text-white">List your gear with us</h1>
      <p className="mt-2 text-white/55">
        Tell us what you&apos;ve got. Read the terms, and if it&apos;s a fit we&apos;ll send the formal agreement and get you
        onboarded.
      </p>

      <Reveal className="mt-7">
        <div className="rounded-2xl border border-accent-400/20 bg-accent-500/[0.04] p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold text-white/90">The arrangement</h2>
            <span className="font-mono text-sm text-accent-300">
              {GEAR_SPLIT.provider}% you / {GEAR_SPLIT.dbc}% us
            </span>
          </div>
          <dl className="mt-4 space-y-4">
            {GEAR_PROVIDER_TERMS.map((t) => (
              <div key={t.h} className="border-l border-white/[0.08] pl-4">
                <dt className="font-display text-sm font-semibold text-white/85">{t.h}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-white/55">{t.p}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-white/35">
            This is a plain-English summary. A formal agreement is issued and signed before any item is listed.
          </p>
        </div>
      </Reveal>

      <div className="mt-6 space-y-4">
        <Row>
          <div>
            <label className={labelCls}>Your name</label>
            <input className={field} value={f.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input className={field} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="you@email.com" />
          </div>
        </Row>
        <Row>
          <div>
            <label className={labelCls}>Phone</label>
            <input className={field} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+44 …" />
          </div>
          <div>
            <label className={labelCls}>Approx. total value (required)</label>
            <input className={field} value={f.gearValue} onChange={(e) => set("gearValue", e.target.value)} placeholder="e.g. £8,000" />
          </div>
        </Row>
        <div>
          <label className={labelCls}>What gear do you want to list?</label>
          <textarea
            className={field}
            rows={4}
            value={f.gearList}
            onChange={(e) => set("gearList", e.target.value)}
            placeholder="List your items — e.g. Sony FX3 body, 24-70mm GM, DJI RS3 gimbal, Aputure 600d…"
          />
        </div>
        <div>
          <label className={labelCls}>Anything else? (optional)</label>
          <textarea className={field} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Availability, condition, anything we should know." />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500" />
          <span className="text-sm leading-relaxed text-white/60">
            I accept the {GEAR_SPLIT.provider}/{GEAR_SPLIT.dbc} revenue share and custody terms above, authorise Db Cinema to
            act on my behalf and take temporary custody of my items, and confirm I can provide a purchase or booking receipt
            as proof of ownership. (A formal agreement is signed before listing.)
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500" />
          <span className="text-sm leading-relaxed text-white/60">
            I&apos;ve read and agree to the{" "}
            <a href={RENTAL_TERMS_HREF} target="_blank" rel="noopener noreferrer" className="text-accent-300 underline-offset-2 hover:underline">terms of renting</a>.
          </span>
        </label>
        <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-xs leading-relaxed text-white/40">
          After approval, finish setup in your account — add your payout bank details and pass a quick ID check to activate your listings. You&apos;re paid out monthly.
        </p>

        {err && <p className="text-sm text-red-300">{err}</p>}
        <button onClick={submit} disabled={!valid || busy} className="btn-primary w-full py-3.5">
          {busy ? "Submitting…" : "Submit for review"}
        </button>
        <p className="text-center text-xs text-white/35">Reviewed by hand — nothing is listed until we approve it.</p>
      </div>
    </div>
  );
}

// ─────────────────────────── Professional (multi-step) ───────────────────────────
const SKILL_POOL = [
  "Lighting", "Camera op", "Colour / Grading", "Editing", "Sound", "Interviews",
  "Run & gun", "Drone / Aerials", "Gimbal", "Directing", "Motion graphics", "Live / Multicam",
];
const EXPERIENCE = [
  { label: "1–2 yrs", v: 2 },
  { label: "3–5 yrs", v: 4 },
  { label: "6–9 yrs", v: 7 },
  { label: "10+ yrs", v: 12 },
];
const STEPS = ["Your craft", "About you", "Rates & reel", "The deal"];

function ProfessionalForm({ onSent }: { onSent: () => void }) {
  const apply = useMutation(api.collective.apply);
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    fullName: "", email: "", phone: "", firstName: "",
    role: COLLECTIVE_ROLES[0].value, years: 0, age: "",
    tagline: "", rateHourly: "", rateHalfDay: "", rateDay: "", portfolio: "", notes: "",
  });
  const [skills, setSkills] = useState<Set<string>>(new Set());
  const [customSkill, setCustomSkill] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const num = (v: string) => (String(v).trim() ? Number(v) : undefined);
  const valid = f.fullName.trim() && /\S+@\S+\.\S+/.test(f.email) && f.phone.trim() && agreeTerms;

  function toggleSkill(s: string) {
    setSkills((prev) => {
      const n = new Set(prev);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
  }
  function addCustomSkill() {
    const s = customSkill.trim();
    if (s) setSkills((prev) => new Set(prev).add(s));
    setCustomSkill("");
  }

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const roleLabel = COLLECTIVE_ROLES.find((r) => r.value === f.role)?.label ?? f.role;
      await apply({
        kind: "professional",
        fullName: f.fullName.trim(),
        email: f.email.trim(),
        phone: f.phone.trim(),
        firstName: (f.firstName.trim() || f.fullName.trim().split(" ")[0]) || undefined,
        role: f.role,
        roleLabel,
        years: f.years || undefined,
        age: num(f.age),
        tagline: f.tagline.trim() || undefined,
        skills: Array.from(skills),
        rateHourly: num(f.rateHourly),
        rateHalfDay: num(f.rateHalfDay),
        rateDay: num(f.rateDay),
        portfolio: f.portfolio.trim() || undefined,
        notes: f.notes.trim() || undefined,
        termsAgreed: true,
      });
      onSent();
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="hud-label !text-accent-400/90">Professional</div>
      <h1 className="mt-2 font-display text-3xl font-bold text-white">Join the crew roster</h1>

      {/* stepper */}
      <div className="mt-5 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ${
                i < step ? "bg-accent-500 text-white" : i === step ? "bg-accent-500/20 text-accent-300 ring-1 ring-accent-400/50" : "bg-white/[0.05] text-white/35"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            <span className={`hidden text-xs sm:block ${i === step ? "text-white/80" : "text-white/35"}`}>{s}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-white/10" aria-hidden />}
          </div>
        ))}
      </div>

      {/* step 0: role */}
      {step === 0 && (
        <div className="mt-7">
          <label className={labelCls}>What do you do?</label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {COLLECTIVE_ROLES.map((r) => {
              const on = f.role === r.value;
              return (
                <button
                  key={r.value}
                  onClick={() => set("role", r.value)}
                  className={`group flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition ${
                    on ? "border-accent-400/70 bg-accent-500/10 shadow-[0_0_22px_-6px_rgba(251,146,60,0.7)]" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  }`}
                >
                  <span className={on ? "text-accent-300" : "text-white/45"}>
                    <RoleIcon role={r.value} className="h-8 w-8" />
                  </span>
                  <span className={`text-sm font-medium ${on ? "text-white" : "text-white/70"}`}>{r.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* step 1: about */}
      {step === 1 && (
        <div className="mt-7 space-y-5">
          <Row>
            <div>
              <label className={labelCls}>Display name (shown publicly)</label>
              <input className={field} value={f.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="First name only" />
            </div>
            <div>
              <label className={labelCls}>Age (optional)</label>
              <input className={field} type="number" value={f.age} onChange={(e) => set("age", e.target.value)} placeholder="e.g. 29" />
            </div>
          </Row>
          <div>
            <label className={labelCls}>Experience</label>
            <div className="flex flex-wrap gap-2">
              {EXPERIENCE.map((e) => (
                <button
                  key={e.v}
                  onClick={() => set("years", e.v)}
                  className={`rounded-full px-4 py-1.5 text-sm transition ${f.years === e.v ? "bg-accent-500 text-white" : "glass text-white/55 hover:text-white"}`}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>Skills — tap all that apply</label>
            <div className="flex flex-wrap gap-2">
              {SKILL_POOL.map((s) => (
                <button
                  key={s}
                  onClick={() => toggleSkill(s)}
                  className={`rounded-full px-3.5 py-1.5 text-sm transition ${skills.has(s) ? "bg-accent-500 text-white" : "glass text-white/55 hover:text-white"}`}
                >
                  {s}
                </button>
              ))}
              {Array.from(skills).filter((s) => !SKILL_POOL.includes(s)).map((s) => (
                <button key={s} onClick={() => toggleSkill(s)} className="rounded-full bg-accent-500 px-3.5 py-1.5 text-sm text-white">{s} ✕</button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className={`${field} flex-1`}
                value={customSkill}
                onChange={(e) => setCustomSkill(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomSkill(); } }}
                placeholder="Add another skill…"
              />
              <button onClick={addCustomSkill} className="btn-ghost px-4 text-sm">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* step 2: rates & reel */}
      {step === 2 && (
        <div className="mt-7 space-y-5">
          <div>
            <label className={labelCls}>One-line bio / tagline</label>
            <input className={field} value={f.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="e.g. Fast run-and-gun for events, brand films & socials." />
          </div>
          <PricingCoach role={f.role} rateDay={f.rateDay} onUseRecommended={(bm) => setF((s) => ({ ...s, rateHourly: String(bm.recHr), rateHalfDay: String(Math.round(bm.recDay * 0.55)), rateDay: String(bm.recDay) }))} />
          <div>
            <label className={labelCls}>Your rates in £ (what you keep is 85% of this)</label>
            <div className="grid grid-cols-3 gap-3">
              <input className={field} type="number" value={f.rateHourly} onChange={(e) => set("rateHourly", e.target.value)} placeholder="Hourly" />
              <input className={field} type="number" value={f.rateHalfDay} onChange={(e) => set("rateHalfDay", e.target.value)} placeholder="Half day" />
              <input className={field} type="number" value={f.rateDay} onChange={(e) => set("rateDay", e.target.value)} placeholder="Day" />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-white/40">
              You set your rate. Clients pay +{Math.round(CLIENT_MARKUP * 100)}% (our booking fee); we take {Math.round(CREATIVE_COMMISSION * 100)}% from your side, so you keep {Math.round((1 - CREATIVE_COMMISSION) * 100)}%
              {f.rateDay ? ` — about £${Math.round(Number(f.rateDay) * (1 - CREATIVE_COMMISSION))}/day on a £${f.rateDay} quote` : ""}. Paid out monthly.
            </p>
          </div>
          <div>
            <label className={labelCls}>Portfolio / showreel links</label>
            <input className={field} value={f.portfolio} onChange={(e) => set("portfolio", e.target.value)} placeholder="Website, Vimeo, Instagram, IMDb…" />
          </div>
          <div>
            <label className={labelCls}>Anything else? (optional)</label>
            <textarea className={field} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Availability, kit you bring, references." />
          </div>
        </div>
      )}

      {/* step 3: the deal + contact */}
      {step === 3 && (
        <div className="mt-7 space-y-5">
          <div className="rounded-2xl border border-accent-400/20 bg-accent-500/[0.04] p-5">
            <h2 className="font-display text-lg font-semibold text-white/90">What you get as crew</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {PROFESSIONAL_PERKS.map((p) => (
                <div key={p.h} className="flex gap-3">
                  <span className="text-lg leading-none">{p.icon}</span>
                  <div>
                    <div className="text-sm font-semibold text-white/85">{p.h}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-white/50">{p.p}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* terms to read & agree */}
          <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <summary className="cursor-pointer font-display text-sm font-semibold text-white/85">Membership terms (read before you agree)</summary>
            <dl className="mt-4 space-y-3">
              {PROFESSIONAL_TERMS.map((t) => (
                <div key={t.h} className="border-l border-white/[0.08] pl-4">
                  <dt className="text-sm font-semibold text-white/85">{t.h}</dt>
                  <dd className="mt-1 text-xs leading-relaxed text-white/55">{t.p}</dd>
                </div>
              ))}
            </dl>
          </details>
          <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-xs leading-relaxed text-white/40">
            After approval, finish setup in your account — add your payout bank details and pass a quick ID check to activate your profile.
          </p>

          <Row>
            <div>
              <label className={labelCls}>Your name (private)</label>
              <input className={field} value={f.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <label className={labelCls}>Email (private)</label>
              <input className={field} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="you@email.com" />
            </div>
          </Row>
          <div>
            <label className={labelCls}>Phone</label>
            <input className={field} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+44 …" />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500" />
            <span className="text-sm leading-relaxed text-white/60">
              I&apos;ve read and agree to the membership terms above and the{" "}
              <a href={RENTAL_TERMS_HREF} target="_blank" rel="noopener noreferrer" className="text-accent-300 underline-offset-2 hover:underline">terms of renting</a>.
            </span>
          </label>
          {!agreeTerms && <p className="text-xs text-white/35">Tick the box above to submit.</p>}
          {err && <p className="text-sm text-red-300">{err}</p>}
        </div>
      )}

      {/* nav */}
      <div className="mt-7 flex items-center justify-between gap-3">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="btn-ghost px-5 py-2.5 text-sm disabled:opacity-30"
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep((s) => s + 1)} className="btn-primary px-6 py-2.5">
            Next <IconArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button onClick={submit} disabled={!valid || busy} className="btn-primary px-6 py-2.5">
            {busy ? "Submitting…" : "Submit for review"}
          </button>
        )}
      </div>
      {step === STEPS.length - 1 && (
        <p className="mt-3 text-center text-xs text-white/35">
          Reviewed by hand. Approved profiles are first-name-only and booked through Db Cinema.
        </p>
      )}
    </div>
  );
}
