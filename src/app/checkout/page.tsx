"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "@/components/cart/CartProvider";
import { usePromo } from "@/components/cart/usePromo";
import { useAccount } from "@/components/account/AccountProvider";
import { AGREEMENTS } from "@/lib/legal";
import { depositFor, smallDamageHold, type Protection } from "@/lib/pricing";

const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");
const PC_RE = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i;
const SLOTS = ["10:00", "11:00", "12:00", "19:00", "20:00", "21:00"];

export default function CheckoutPage() {
  const { items, subtotal, eligibleSubtotal } = useCart();
  const account = useAccount();
  const promo = usePromo(eligibleSubtotal);
  const start = useAction(api.checkout.start);
  const getQuote = useAction(api.delivery.quote);

  const replacementSum = items.reduce((n, i) => n + i.deposit, 0);
  const acctPostcode = account.me?.address?.match(PC_RE)?.[1] ?? "";

  const [email, setEmail] = useState(account.me?.email ?? "");
  const [name, setName] = useState(account.me?.name ?? "");
  const [phone, setPhone] = useState(account.me?.phone ?? "");
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">("pickup");
  const [address, setAddress] = useState(account.me?.address ?? "");
  const [postcode, setPostcode] = useState(acctPostcode);
  const [dq, setDq] = useState<any>(null);
  const [quoting, setQuoting] = useState(false);
  const [protection, setProtection] = useState<Protection>("verify");
  const [pickupTime, setPickupTime] = useState("");
  const [returnTime, setReturnTime] = useState("");
  const [deliveryAgreed, setDeliveryAgreed] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const deliveryFee = fulfilment === "delivery" && dq?.ok ? dq.fee : 0;
  const depositAmount = depositFor(protection, replacementSum);
  const total = subtotal + depositAmount + deliveryFee - promo.discount;

  const valid =
    items.length > 0 &&
    /\S+@\S+\.\S+/.test(email) &&
    pickupTime &&
    returnTime &&
    (fulfilment === "pickup" || (dq?.ok && address.trim().length > 5 && deliveryAgreed)) &&
    agreed &&
    signature.trim().length > 2;

  async function quoteDelivery() {
    if (!postcode.trim()) return;
    setQuoting(true);
    setDq(null);
    try {
      const r = await getQuote({ postcode: postcode.trim(), listingIds: items.map((i) => i.listingId as any) });
      setDq(r);
    } catch (e: any) {
      setDq({ ok: false, reason: e?.message ?? "Quote failed" });
    } finally {
      setQuoting(false);
    }
  }

  async function pay() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const docs: { kind: string; version: string }[] = AGREEMENTS.map((d) => ({ kind: d.kind, version: d.version }));
      if (fulfilment === "delivery") docs.push({ kind: "delivery-disclaimer", version: "2026-06-v1" });
      const { url } = await start({
        items: items.map((i) => ({
          listingId: i.listingId as any,
          title: i.title,
          start: ms(i.start),
          end: ms(i.end),
          qty: 1,
          total: i.total,
          deposit: i.deposit,
          offerType: i.offerType,
        })),
        customer: { email, name: name || undefined, phone: phone || undefined },
        fulfilment,
        address: fulfilment === "delivery" ? address : undefined,
        deliveryFee,
        promoCode: promo.applied ?? undefined,
        protection,
        pickupTime,
        returnTime,
        agreement: { name: signature.trim(), documents: docs },
        origin: window.location.origin,
      });
      window.location.href = url;
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong");
      setBusy(false);
    }
  }

  if (items.length === 0)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-4xl px-6 py-20 text-center text-white/40">
          Your kit is empty.{" "}
          <Link href="/gear" className="text-accent-400 hover:underline">Browse gear →</Link>
        </main>
      </>
    );

  const field = "rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30";

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-4xl px-6 py-12">
        <h1 className="font-display text-3xl font-bold text-white/90">Check<span className="gradient-text">out</span></h1>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-5">
            {/* details */}
            <div className="glass gradient-border rounded-2xl p-5">
              <h2 className="mb-3 font-display font-semibold text-white/80">Your details</h2>
              <div className="flex flex-col gap-3">
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email *" type="email" className={field} />
                <div className="flex gap-3">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={`flex-1 ${field}`} />
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className={`flex-1 ${field}`} />
                </div>
              </div>
            </div>

            {/* fulfilment */}
            <div className="glass gradient-border rounded-2xl p-5">
              <h2 className="mb-1 font-display font-semibold text-white/80">Fulfilment</h2>
              <p className="mb-3 text-xs text-white/40">Pickup, return &amp; delivery windows: <span className="text-white/60">10:00–12:00</span> and <span className="text-white/60">19:00–21:00</span>, daily.</p>
              <div className="flex gap-3">
                {(["pickup", "delivery"] as const).map((f) => (
                  <button key={f} onClick={() => setFulfilment(f)} className={`flex-1 rounded-lg px-4 py-2.5 text-sm capitalize transition-colors ${fulfilment === f ? "bg-accent-500 text-white" : "glass text-white/60 hover:text-white"}`}>
                    {f}{f === "delivery" ? " (quote by distance)" : ""}
                  </button>
                ))}
              </div>
              {fulfilment === "delivery" && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input value={postcode} onChange={(e) => { setPostcode(e.target.value); setDq(null); }} placeholder="Delivery postcode *" className={`flex-1 uppercase placeholder:normal-case ${field}`} />
                    <button onClick={quoteDelivery} disabled={quoting || !postcode.trim()} className="rounded-lg bg-accent-500 px-4 text-sm text-white hover:bg-accent-600 disabled:opacity-40">{quoting ? "…" : "Get quote"}</button>
                  </div>
                  {dq && (dq.ok ? (
                    <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                      {dq.vehicleLabel} · ~{dq.km}km · round trip (delivery + collection): 2 × £{dq.oneWay} <span className="font-semibold">= £{dq.fee}</span> <span className="text-emerald-300/60">(incl. margin)</span>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{dq.reason}</div>
                  ))}
                  <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Full delivery address *" rows={2} className={`w-full ${field}`} />
                  <label className="flex items-start gap-2 text-xs text-white/55">
                    <input type="checkbox" checked={deliveryAgreed} onChange={(e) => setDeliveryAgreed(e.target.checked)} className="mt-0.5 accent-accent-500" />
                    <span>I understand delivery uses a third-party courier (Addison Lee). Times are estimates only — no exact time is guaranteed and delivery may be affected by traffic. Estimates are accurate within ~15%; the final price is confirmed by the courier. No refunds for courier delays.</span>
                  </label>
                </div>
              )}

              {/* times (both pickup & delivery) */}
              <div className="mt-4 flex gap-3">
                <label className="flex-1 text-xs text-white/40">
                  {fulfilment === "delivery" ? "Delivery time *" : "Pickup time *"}
                  <select value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} className={`mt-1 w-full [color-scheme:dark] ${field}`}>
                    <option value="">Select…</option>
                    {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="flex-1 text-xs text-white/40">
                  {fulfilment === "delivery" ? "Collection time *" : "Return time *"}
                  <select value={returnTime} onChange={(e) => setReturnTime(e.target.value)} className={`mt-1 w-full [color-scheme:dark] ${field}`}>
                    <option value="">Select…</option>
                    {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {/* protection */}
            <div className="glass gradient-border rounded-2xl p-5">
              <h2 className="mb-1 font-display font-semibold text-white/80">Protection</h2>
              <p className="mb-3 text-xs text-white/40">Choose how you cover the gear.</p>
              <div className="flex flex-col gap-2">
                <button onClick={() => setProtection("verify")} className={`rounded-xl border p-3 text-left transition ${protection === "verify" ? "border-accent-400 bg-accent-400/10" : "border-white/10 hover:border-white/20"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white/85">ID verification + insurance <span className="ml-1 rounded bg-accent-500/20 px-1.5 py-0.5 text-[10px] uppercase text-accent-300">recommended</span></span>
                    <span className="text-sm text-accent-300">£{smallDamageHold(replacementSum)} hold</span>
                  </div>
                  <p className="mt-1 text-xs text-white/40">Small refundable damage hold + a quick ID check before handover. No large deposit.</p>
                </button>
                <button onClick={() => setProtection("deposit")} className={`rounded-xl border p-3 text-left transition ${protection === "deposit" ? "border-accent-400 bg-accent-400/10" : "border-white/10 hover:border-white/20"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white/85">Security deposit</span>
                    <span className="text-sm text-accent-300">£{replacementSum} deposit</span>
                  </div>
                  <p className="mt-1 text-xs text-white/40">Full refundable deposit, released on safe return. No ID check.</p>
                </button>
              </div>
            </div>

            {/* agreements */}
            <div className="glass gradient-border rounded-2xl p-5">
              <h2 className="mb-1 font-display font-semibold text-white/80">Agreements &amp; signature</h2>
              <p className="text-xs text-white/40">Required for your booking, deposit and insurance cover.</p>
              <label className="mt-3 flex items-start gap-2 text-sm text-white/60">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 accent-accent-500" />
                <span>I have read and agree to the{" "}
                  {AGREEMENTS.map((d, i) => (
                    <span key={d.kind}>
                      <a href={`/legal/${d.kind}`} target="_blank" className="text-accent-400 hover:underline">{d.title}</a>
                      {i < AGREEMENTS.length - 1 ? ", " : "."}
                    </span>
                  ))}
                </span>
              </label>
              <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Type your full name to sign" className={`mt-3 w-full italic ${field}`} />
            </div>
          </div>

          {/* summary */}
          <aside className="h-fit rounded-2xl glass gradient-border p-5">
            <h2 className="font-display font-semibold text-white/80">Summary</h2>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              {items.map((i) => (
                <div key={i.key} className="flex justify-between text-white/55">
                  <span className="mr-2 line-clamp-1">{i.title}{i.offerType ? " (offer)" : ""}</span>
                  <span className="shrink-0">£{i.total}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-white/5 pt-3 text-sm">
              <Row label="Rental subtotal" value={subtotal} />
              {promo.discount > 0 && <div className="flex justify-between text-emerald-300"><span>{promo.applied?.toUpperCase()}</span><span>−£{promo.discount}</span></div>}
              {deliveryFee > 0 && <Row label="Delivery (round trip)" value={deliveryFee} />}
              <Row label={protection === "deposit" ? "Refundable deposit" : "Refundable damage hold"} value={depositAmount} muted />
              <div className="mt-2 flex justify-between border-t border-white/5 pt-2 font-display text-lg font-bold text-white/90">
                <span>Total due</span><span>£{total}</span>
              </div>
            </div>
            {err && <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
            <button onClick={pay} disabled={!valid || busy} className="mt-5 w-full rounded-full bg-accent-500 py-3 font-medium text-white transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-30">
              {busy ? "Redirecting…" : "Pay with card"}
            </button>
            <p className="mt-2 text-center text-[11px] text-white/25">Secured by Stripe · test mode</p>
          </aside>
        </div>
      </main>
    </>
  );
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-white/35" : "text-white/60"}`}>
      <span>{label}</span><span>£{value}</span>
    </div>
  );
}
