"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const STATUSES = ["confirmed", "active", "returned", "cancelled"] as const;

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    setToken(localStorage.getItem("dbc_admin"));
  }, []);

  const bookings = useQuery(api.bookings.adminList, token ? { token } : "skip");
  const contacts = useQuery(api.contact.adminList, token ? { token } : "skip");
  const setStatus = useMutation(api.bookings.adminSetStatus);
  const setId = useMutation(api.bookings.adminSetIdStatus);
  const refund = useAction(api.checkout.refundDeposit);
  const markHandled = useMutation(api.contact.adminMarkHandled);

  const authed = bookings?.authorized;

  function save() {
    localStorage.setItem("dbc_admin", input);
    setToken(input);
  }

  if (!token || authed === false) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-sm px-6 py-24">
          <h1 className="font-display text-2xl font-bold text-white/90">Admin</h1>
          <p className="mt-2 text-sm text-white/40">Enter the admin passcode.</p>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Passcode"
            className="mt-4 w-full rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none"
          />
          <button
            onClick={save}
            className="mt-3 w-full rounded-full bg-accent-500 py-2.5 font-medium text-white hover:bg-accent-600"
          >
            Enter
          </button>
          {authed === false && (
            <p className="mt-3 text-center text-xs text-red-300">Wrong passcode.</p>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-6xl px-6 py-10">
        <h1 className="font-display text-3xl font-bold text-white/90">
          Admin <span className="gradient-text">dashboard</span>
        </h1>

        <AdminAnalytics token={token} />

        {/* bookings */}
        <h2 className="mt-8 font-display text-lg font-semibold text-white/80">
          Bookings {bookings ? `(${bookings.items.length})` : ""}
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          {bookings?.items.map((b: any) => (
            <div key={b._id} className="rounded-2xl glass p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="text-sm text-white/80">{b.guestEmail}</span>
                  <span
                    className={`ml-2 rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                      b.status === "confirmed"
                        ? "bg-accent-500/20 text-accent-300"
                        : b.status === "active"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : b.status === "returned"
                            ? "bg-white/10 text-white/50"
                            : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    {b.status}
                  </span>
                  <span className="ml-2 text-xs text-white/30">{b.fulfilment}</span>
                </div>
                <div className="text-right">
                  <div className="font-display font-bold text-white/90">£{b.total}</div>
                  <div className="text-[11px] text-white/30">
                    deposit £{b.depositAmount}
                    {b.depositRefunded ? " · refunded" : ""}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-xs text-white/45">
                {b.lineItems.map((li: any, i: number) => (
                  <div key={i}>
                    {li.title} · {day(li.start)}→{day(li.end)} · £{li.lineTotal}
                  </div>
                ))}
              </div>
              {b.address && (
                <div className="mt-1 text-xs text-white/30">📍 {b.address}</div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className={b.agreementName ? "text-emerald-300" : "text-red-300"}>
                  {b.agreementName ? `✍ signed by ${b.agreementName}` : "✗ not signed"}
                </span>
                <span className="text-white/20">·</span>
                <span
                  className={
                    b.idVerifyStatus === "verified" ? "text-emerald-300" : "text-amber-300"
                  }
                >
                  ID: {b.idVerifyStatus}
                </span>
                {b.idVerifyStatus !== "verified" && (
                  <button
                    onClick={() => setId({ token, bookingId: b._id, status: "verified" })}
                    className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/30"
                  >
                    mark ID verified
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus({ token, bookingId: b._id, status: s })}
                    disabled={b.status === s}
                    className="rounded-full glass px-3 py-1 text-xs text-white/60 hover:text-white disabled:opacity-25"
                  >
                    {s}
                  </button>
                ))}
                <button
                  onClick={() =>
                    refund({ token, bookingId: b._id }).catch((e) => alert(e.message))
                  }
                  disabled={b.depositRefunded || b.depositAmount <= 0}
                  className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-25"
                >
                  Refund deposit
                </button>
              </div>
            </div>
          ))}
          {bookings && bookings.items.length === 0 && (
            <div className="text-sm text-white/30">No bookings yet.</div>
          )}
        </div>

        {/* contact inbox */}
        <h2 className="mt-10 font-display text-lg font-semibold text-white/80">
          Contact inbox {contacts ? `(${contacts.items.length})` : ""}
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          {contacts?.items.map((m: any) => (
            <div
              key={m._id}
              className={`rounded-2xl glass p-4 ${m.handled ? "opacity-50" : ""}`}
            >
              <div className="flex justify-between">
                <span className="text-sm text-white/80">
                  {m.name} <span className="text-white/40">({m.email})</span>
                </span>
                {!m.handled && (
                  <button
                    onClick={() => markHandled({ token, id: m._id })}
                    className="text-xs text-accent-400 hover:underline"
                  >
                    mark handled
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-white/50">{m.message}</p>
            </div>
          ))}
          {contacts && contacts.items.length === 0 && (
            <div className="text-sm text-white/30">No messages.</div>
          )}
        </div>

        <AdminCollective token={token} />
        <AdminSettings token={token} />
        <AdminPromos token={token} />
        <AdminMemberOffers token={token} />
      </main>
    </>
  );
}

function AdminSettings({ token }: { token: string }) {
  const res = useQuery(api.settings.adminGet, { token });
  const update = useMutation(api.settings.adminUpdate);
  const [f, setF] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (res && (res as any).authorized) setF((res as any).config);
  }, [res]);
  if (!res || !(res as any).authorized || !f) return null;

  const field = "rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none w-28";
  async function save() {
    await update({
      token,
      deliveryMarginPct: Number(f.deliveryMarginPct),
      deliveryMaxKm: Number(f.deliveryMaxKm),
      openingHours: f.openingHours,
      acceptingOrders: f.acceptingOrders,
      googleReviewUrl: f.googleReviewUrl ?? "",
      businessAddress: f.businessAddress ?? "",
      businessPhone: f.businessPhone ?? "",
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-white/80">Settings</h2>
      <div className="mt-3 rounded-2xl glass gradient-border p-5 flex flex-col gap-3 text-sm">
        <label className="flex items-center justify-between text-white/60">
          Delivery margin %
          <input className={field} type="number" value={f.deliveryMarginPct} onChange={(e) => setF({ ...f, deliveryMarginPct: e.target.value })} />
        </label>
        <label className="flex items-center justify-between text-white/60">
          Max delivery distance (km)
          <input className={field} type="number" value={f.deliveryMaxKm} onChange={(e) => setF({ ...f, deliveryMaxKm: e.target.value })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-white/60">
          Opening hours
          <input className="flex-1 rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none" value={f.openingHours} onChange={(e) => setF({ ...f, openingHours: e.target.value })} />
        </label>
        <label className="flex items-center justify-between text-white/60">
          Accepting orders
          <input type="checkbox" className="accent-accent-500 h-4 w-4" checked={f.acceptingOrders} onChange={(e) => setF({ ...f, acceptingOrders: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-white/60">
          Google review link
          <input className="flex-1 rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none" placeholder="https://g.page/r/…/review" value={f.googleReviewUrl ?? ""} onChange={(e) => setF({ ...f, googleReviewUrl: e.target.value })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-white/60">
          Business address
          <input className="flex-1 rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none" placeholder="123 Example St, London" value={f.businessAddress ?? ""} onChange={(e) => setF({ ...f, businessAddress: e.target.value })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-white/60">
          Business phone
          <input className="flex-1 rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none" placeholder="+44 20 …" value={f.businessPhone ?? ""} onChange={(e) => setF({ ...f, businessPhone: e.target.value })} />
        </label>
        <button onClick={save} className="w-fit rounded-full bg-accent-500 px-5 py-2 text-sm font-medium text-white hover:bg-accent-600">
          {saved ? "Saved ✓" : "Save settings"}
        </button>
      </div>
    </section>
  );
}

function AdminPromos({ token }: { token: string }) {
  const res = useQuery(api.promo.adminList, { token });
  const create = useMutation(api.promo.adminCreate);
  const toggle = useMutation(api.promo.adminToggle);
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("15");
  const [err, setErr] = useState<string | null>(null);
  if (!res || !(res as any).authorized) return null;

  async function add() {
    setErr(null);
    try {
      await create({ token, code, type, value: Number(value) });
      setCode("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    }
  }
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-white/80">Promo codes</h2>
      <div className="mt-3 flex flex-col gap-2">
        {(res as any).items.map((p: any) => (
          <div key={p._id} className="flex items-center justify-between rounded-xl glass px-4 py-2 text-sm">
            <span className="font-mono uppercase text-white/80">{p.code}</span>
            <span className="text-white/50">{p.type === "percent" ? `${p.value}%` : `£${p.value}`} · used {p.usedCount}</span>
            <button onClick={() => toggle({ token, id: p._id })} className={`rounded-full px-3 py-1 text-xs ${p.active ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/40"}`}>
              {p.active ? "active" : "inactive"}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl glass p-4">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm uppercase text-white/80 outline-none" />
        <select value={type} onChange={(e) => setType(e.target.value as any)} className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none [color-scheme:dark]">
          <option value="percent">%</option>
          <option value="fixed">£</option>
        </select>
        <input value={value} onChange={(e) => setValue(e.target.value)} type="number" className="w-20 rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none" />
        <button onClick={add} className="rounded-full bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600">Add code</button>
        {err && <span className="text-xs text-red-300">{err}</span>}
      </div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="rounded-2xl glass p-4">
      <div className={`font-display text-2xl font-bold ${accent ? "gradient-text" : "text-white/90"}`}>{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-white/40">{label}</div>
    </div>
  );
}

function AdminAnalytics({ token }: { token: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const s = useQuery(api.analytics.adminSummary, { token, now });
  if (!s || !(s as any).authorized) return null;
  const a: any = s;
  const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  return (
    <section className="mt-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Live viewers · 15m" value={a.live} accent />
        <Stat label="Views · 24h" value={a.views24} />
        <Stat label="Add to cart · 24h" value={a.carts24} />
        <Stat label="Purchases · 24h" value={a.purchases24} />
      </div>
      <div className="mt-2 rounded-xl glass px-4 py-2 text-xs text-white/50">
        Funnel (24h): <b className="text-white/80">{a.views24}</b> views →{" "}
        <b className="text-white/80">{a.carts24}</b> cart →{" "}
        <b className="text-white/80">{a.checkouts24}</b> checkout →{" "}
        <b className="text-white/80">{a.purchases24}</b> paid · conversion{" "}
        <b className="text-accent-300">{a.conversion}%</b> · views 7d {a.views7}
      </div>

      <h2 className="mt-8 font-display text-lg font-semibold text-white/80">
        Ongoing rentals ({a.ongoing.length})
      </h2>
      <div className="mt-3 flex flex-col gap-2">
        {a.ongoing.length === 0 && <div className="text-sm text-white/30">Nothing out right now.</div>}
        {a.ongoing.map((b: any) => (
          <div key={b._id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl glass px-4 py-2 text-sm">
            <span className="text-white/80">{b.guestEmail}</span>
            <span className="text-white/45">{b.items.slice(0, 50)}</span>
            <span className="text-white/50">{fmtDay(b.start)} → {fmtDay(b.end)} · {b.fulfilment}</span>
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase text-emerald-300">{b.status}</span>
          </div>
        ))}
      </div>

      {a.topMisses.length > 0 && (
        <div className="mt-6">
          <h3 className="font-display text-sm font-semibold text-white/70">Searches with no results (7d)</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {a.topMisses.map(([term, n]: [string, number]) => (
              <span key={term} className="rounded-full glass px-3 py-1 text-xs text-white/60">
                {term} <span className="text-white/30">×{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AdminCollective({ token }: { token: string }) {
  const res = useQuery(api.collective.adminList, { token });
  const review = useMutation(api.collective.review);
  const [busy, setBusy] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>(null);
  if (!res || !(res as any).authorized) return null;
  const items = (res as any).items as any[];
  const pending = items.filter((i) => i.status === "pending").length;

  function startEdit(a: any) {
    setEditId(a._id);
    setEdit({
      roleLabel: a.roleLabel ?? "",
      firstName: a.firstName ?? "",
      years: a.years ?? "",
      tagline: a.tagline ?? "",
      skills: (a.skills ?? []).join(", "),
      rateHourly: a.rateHourly ?? "",
      rateHalfDay: a.rateHalfDay ?? "",
      rateDay: a.rateDay ?? "",
    });
  }
  const numOpt = (v: any) => (String(v).trim() ? Number(v) : undefined);

  async function act(a: any, action: "approve" | "reject", withEdits: boolean) {
    setBusy(a._id + action);
    try {
      const edits =
        withEdits && edit
          ? {
              roleLabel: edit.roleLabel || undefined,
              firstName: edit.firstName || undefined,
              years: numOpt(edit.years),
              tagline: edit.tagline || undefined,
              skills: edit.skills ? edit.skills.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
              rateHourly: numOpt(edit.rateHourly),
              rateHalfDay: numOpt(edit.rateHalfDay),
              rateDay: numOpt(edit.rateDay),
            }
          : undefined;
      await review({ token, id: a._id, action, edits });
      setEditId(null);
      setEdit(null);
    } catch (e: any) {
      alert(e?.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  }

  const ei = "rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/80 outline-none";

  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-white/80">
        Creative Collective <span className="text-white/40">({pending} pending)</span>
      </h2>
      <div className="mt-3 flex flex-col gap-3">
        {items.length === 0 && <div className="text-sm text-white/30">No applications yet.</div>}
        {items.map((a) => (
          <div key={a._id} className={`rounded-2xl glass p-4 ${a.status !== "pending" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                    a.kind === "gear-provider" ? "bg-amber-500/20 text-amber-300" : "bg-accent-500/20 text-accent-300"
                  }`}
                >
                  {a.kind === "gear-provider" ? "Gear provider" : "Professional"}
                </span>
                <span className="ml-2 text-sm text-white/80">{a.fullName}</span>
                <span className="ml-2 text-xs text-white/40">
                  {a.email}
                  {a.phone ? ` · ${a.phone}` : ""}
                </span>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-[10px] uppercase ${
                  a.status === "pending"
                    ? "bg-white/10 text-white/60"
                    : a.status === "approved"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-red-500/20 text-red-300"
                }`}
              >
                {a.status}
              </span>
            </div>

            <div className="mt-2 text-xs leading-relaxed text-white/50">
              {a.kind === "professional" ? (
                <>
                  <div>
                    <b className="text-white/70">{a.roleLabel || a.role}</b> · {a.firstName} · {a.years ?? "?"}y
                  </div>
                  {a.tagline && <div className="mt-1">{a.tagline}</div>}
                  {a.skills?.length > 0 && <div className="mt-1">Skills: {a.skills.join(", ")}</div>}
                  <div className="mt-1">
                    Rates: hr {a.rateHourly ?? "—"} / half {a.rateHalfDay ?? "—"} / day {a.rateDay ?? "—"}
                  </div>
                  {a.portfolio && <div className="mt-1">Portfolio: {a.portfolio}</div>}
                </>
              ) : (
                <>
                  <div>Gear: {a.gearList}</div>
                  {a.gearValue && <div className="mt-1">Approx value: {a.gearValue}</div>}
                  <div className="mt-1">Terms: {a.agreementAccepted ? "✓ 60/40 + custody accepted" : "✗ not accepted"}</div>
                </>
              )}
              {a.notes && <div className="mt-1 text-white/40">Notes: {a.notes}</div>}
            </div>

            {/* inline edit (professionals) */}
            {editId === a._id && a.kind === "professional" && (
              <div className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-2">
                <input className={ei} value={edit.roleLabel} onChange={(e) => setEdit({ ...edit, roleLabel: e.target.value })} placeholder="Role label" />
                <input className={ei} value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} placeholder="Display name" />
                <input className={`${ei} sm:col-span-2`} value={edit.tagline} onChange={(e) => setEdit({ ...edit, tagline: e.target.value })} placeholder="Tagline" />
                <input className={`${ei} sm:col-span-2`} value={edit.skills} onChange={(e) => setEdit({ ...edit, skills: e.target.value })} placeholder="Skills (comma separated)" />
                <input className={ei} type="number" value={edit.years} onChange={(e) => setEdit({ ...edit, years: e.target.value })} placeholder="Years" />
                <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                  <input className={ei} type="number" value={edit.rateHourly} onChange={(e) => setEdit({ ...edit, rateHourly: e.target.value })} placeholder="Hourly" />
                  <input className={ei} type="number" value={edit.rateHalfDay} onChange={(e) => setEdit({ ...edit, rateHalfDay: e.target.value })} placeholder="Half" />
                  <input className={ei} type="number" value={edit.rateDay} onChange={(e) => setEdit({ ...edit, rateDay: e.target.value })} placeholder="Day" />
                </div>
              </div>
            )}

            {a.status === "pending" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {editId === a._id ? (
                  <>
                    <button
                      onClick={() => act(a, "approve", true)}
                      disabled={busy === a._id + "approve"}
                      className="rounded-full bg-emerald-500/20 px-4 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                    >
                      Save edits &amp; publish
                    </button>
                    <button onClick={() => { setEditId(null); setEdit(null); }} className="rounded-full glass px-4 py-1.5 text-xs text-white/60 hover:text-white">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => act(a, "approve", false)}
                      disabled={busy === a._id + "approve"}
                      className="rounded-full bg-emerald-500/20 px-4 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                    >
                      {a.kind === "professional" ? "Approve & publish" : "Approve"}
                    </button>
                    {a.kind === "professional" && (
                      <button onClick={() => startEdit(a)} className="rounded-full glass px-4 py-1.5 text-xs text-white/70 hover:text-white">
                        Edit & publish
                      </button>
                    )}
                    <button
                      onClick={() => act(a, "reject", false)}
                      disabled={busy === a._id + "reject"}
                      className="rounded-full bg-red-500/15 px-4 py-1.5 text-xs text-red-300 hover:bg-red-500/25 disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-white/30">
        Approving a professional publishes a first-name-only crew card on /gear. Gear-provider approvals are marked
        approved — onboard the items into the catalogue separately.
      </p>
    </section>
  );
}

function AdminMemberOffers({ token }: { token: string }) {
  const res = useQuery(api.promo.adminListMemberOffers, { token });
  const create = useMutation(api.promo.adminCreateMemberOffer);
  const toggle = useMutation(api.promo.adminToggleMemberOffer);
  const [f, setF] = useState({ title: "", blurb: "", badge: "", code: "", type: "percent", value: "20", limit: "monthly", expiryDays: "" });
  const [err, setErr] = useState<string | null>(null);
  if (!res || !(res as any).authorized) return null;

  async function add() {
    setErr(null);
    try {
      await create({
        token,
        title: f.title,
        blurb: f.blurb,
        badge: f.badge,
        code: f.code,
        type: f.type as any,
        value: Number(f.value),
        limit: f.limit as any,
        expiryDays: f.expiryDays ? Number(f.expiryDays) : undefined,
      });
      setF({ title: "", blurb: "", badge: "", code: "", type: "percent", value: "20", limit: "monthly", expiryDays: "" });
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    }
  }
  const inp = "rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none";
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-amber-200">Member-only offers</h2>
      <div className="mt-3 flex flex-col gap-2">
        {(res as any).items.map((o: any) => (
          <div key={o._id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/[0.06] px-4 py-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-white/85">{o.title}</span>{" "}
              <span className="font-mono text-amber-300">{String(o.code).toUpperCase()}</span>{" "}
              <span className="text-white/40">· {o.badge}</span>
            </div>
            <button onClick={() => toggle({ token, id: o._id })} className={`shrink-0 rounded-full px-3 py-1 text-xs ${o.active ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/40"}`}>
              {o.active ? "active" : "inactive"}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 rounded-2xl glass p-4 sm:grid-cols-2">
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Title (e.g. Free ND filter)" className={inp} />
        <input value={f.badge} onChange={(e) => setF({ ...f, badge: e.target.value })} placeholder="Badge (e.g. −40% or FREE)" className={inp} />
        <input value={f.blurb} onChange={(e) => setF({ ...f, blurb: e.target.value })} placeholder="Short description" className={`${inp} sm:col-span-2`} />
        <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="CODE" className={`${inp} uppercase`} />
        <div className="flex gap-2">
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={`${inp} [color-scheme:dark]`}>
            <option value="percent">%</option>
            <option value="fixed">£</option>
          </select>
          <input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} type="number" className={`${inp} w-20`} />
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <select value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} className={`${inp} [color-scheme:dark]`}>
            <option value="monthly">once a month</option>
            <option value="once">one-time only</option>
          </select>
          <input value={f.expiryDays} onChange={(e) => setF({ ...f, expiryDays: e.target.value })} type="number" placeholder="expires in N days (optional)" className={`${inp} flex-1`} />
          <button onClick={add} className="rounded-full bg-amber-400 px-4 py-2 text-sm font-medium text-black hover:bg-amber-300">Add offer</button>
        </div>
        <p className="text-[11px] text-white/30 sm:col-span-2">Pro &amp; Studio only · non-stacking · {f.limit === "once" ? "one-time use" : "once a month"}.</p>
        {err && <span className="text-xs text-red-300 sm:col-span-2">{err}</span>}
      </div>
    </section>
  );
}
