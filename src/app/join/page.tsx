"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { IconCheck, IconArrowRight, IconChevronLeft } from "@/components/icons";
import { COLLECTIVE_ROLES, GEAR_PROVIDER_TERMS, GEAR_SPLIT } from "@/lib/collective";

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
                body="Add your profile to our crew roster. Clients book you through Db Cinema for shoots across London — we handle the contract and payment."
                bullets={["Your card on the crew roster", "Set your own rates", "Booked & paid through us"]}
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
    <button
      onClick={onClick}
      className="lift spot gradient-border group block h-full rounded-2xl p-6 text-left"
    >
      <span className="hud-label !text-accent-400/80">{eyebrow}</span>
      <h2 className="mt-3 font-display text-2xl font-semibold text-white/90 transition-colors group-hover:text-white">
        {title}
      </h2>
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

function GearProviderForm({ onSent }: { onSent: () => void }) {
  const apply = useMutation(api.collective.apply);
  const [f, setF] = useState({ fullName: "", email: "", phone: "", gearList: "", gearValue: "", notes: "" });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = f.fullName.trim() && /\S+@\S+\.\S+/.test(f.email) && f.gearList.trim() && agree;
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
        phone: f.phone.trim() || undefined,
        gearList: f.gearList.trim(),
        gearValue: f.gearValue.trim() || undefined,
        notes: f.notes.trim() || undefined,
        agreementAccepted: true,
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

      {/* agreement */}
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

      {/* form */}
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
            <label className={labelCls}>Phone (optional)</label>
            <input className={field} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+44 …" />
          </div>
          <div>
            <label className={labelCls}>Approx. total value (optional)</label>
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
            I&apos;ve read and accept the {GEAR_SPLIT.provider}/{GEAR_SPLIT.dbc} revenue share and custody terms above, and
            understand a formal agreement is signed before listing.
          </span>
        </label>

        {err && <p className="text-sm text-red-300">{err}</p>}
        <button onClick={submit} disabled={!valid || busy} className="btn-primary w-full py-3.5">
          {busy ? "Submitting…" : "Submit for review"}
        </button>
        <p className="text-center text-xs text-white/35">Reviewed by hand — nothing is listed until we approve it.</p>
      </div>
    </div>
  );
}

function ProfessionalForm({ onSent }: { onSent: () => void }) {
  const apply = useMutation(api.collective.apply);
  const [f, setF] = useState({
    fullName: "",
    email: "",
    phone: "",
    firstName: "",
    role: COLLECTIVE_ROLES[0].value,
    years: "",
    tagline: "",
    skills: "",
    rateHourly: "",
    rateHalfDay: "",
    rateDay: "",
    portfolio: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = f.fullName.trim() && /\S+@\S+\.\S+/.test(f.email) && f.tagline.trim();
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const num = (v: string) => (v.trim() ? Number(v) : undefined);

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
        phone: f.phone.trim() || undefined,
        firstName: (f.firstName.trim() || f.fullName.trim().split(" ")[0]) || undefined,
        role: f.role,
        roleLabel,
        years: num(f.years),
        tagline: f.tagline.trim(),
        skills: f.skills.split(",").map((s) => s.trim()).filter(Boolean),
        rateHourly: num(f.rateHourly),
        rateHalfDay: num(f.rateHalfDay),
        rateDay: num(f.rateDay),
        portfolio: f.portfolio.trim() || undefined,
        notes: f.notes.trim() || undefined,
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
      <p className="mt-2 text-white/55">
        Fill in your card and we&apos;ll review it. Approved profiles show your{" "}
        <span className="text-white/80">first name only</span> — clients book you through us.
      </p>

      <div className="mt-7 space-y-4">
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
        <Row>
          <div>
            <label className={labelCls}>Display name (shown publicly)</label>
            <input className={field} value={f.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="First name only" />
          </div>
          <div>
            <label className={labelCls}>Phone (optional)</label>
            <input className={field} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+44 …" />
          </div>
        </Row>
        <Row>
          <div>
            <label className={labelCls}>Role</label>
            <select
              className={`${field} [color-scheme:dark]`}
              value={f.role}
              onChange={(e) => set("role", e.target.value)}
            >
              {COLLECTIVE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Years of experience</label>
            <input className={field} type="number" value={f.years} onChange={(e) => set("years", e.target.value)} placeholder="e.g. 6" />
          </div>
        </Row>
        <div>
          <label className={labelCls}>One-line bio / tagline</label>
          <input className={field} value={f.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="e.g. Fast run-and-gun for events, brand films & socials." />
        </div>
        <div>
          <label className={labelCls}>Skills (comma separated)</label>
          <input className={field} value={f.skills} onChange={(e) => set("skills", e.target.value)} placeholder="Lighting, Camera op, Colour" />
        </div>
        <div>
          <label className={labelCls}>Rates in £ (optional — leave blank for POA)</label>
          <div className="grid grid-cols-3 gap-3">
            <input className={field} type="number" value={f.rateHourly} onChange={(e) => set("rateHourly", e.target.value)} placeholder="Hourly" />
            <input className={field} type="number" value={f.rateHalfDay} onChange={(e) => set("rateHalfDay", e.target.value)} placeholder="Half day" />
            <input className={field} type="number" value={f.rateDay} onChange={(e) => set("rateDay", e.target.value)} placeholder="Day" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Portfolio links</label>
          <input className={field} value={f.portfolio} onChange={(e) => set("portfolio", e.target.value)} placeholder="Website, Vimeo, Instagram, IMDb…" />
        </div>
        <div>
          <label className={labelCls}>Anything else? (optional)</label>
          <textarea className={field} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Availability, kit you bring, references." />
        </div>

        {err && <p className="text-sm text-red-300">{err}</p>}
        <button onClick={submit} disabled={!valid || busy} className="btn-primary w-full py-3.5">
          {busy ? "Submitting…" : "Submit for review"}
        </button>
        <p className="text-center text-xs text-white/35">
          Reviewed by hand. Approved profiles are first-name-only and booked through Db Cinema.
        </p>
      </div>
    </div>
  );
}
