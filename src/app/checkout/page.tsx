"use client";

import { useEffect, useState, useRef } from "react";
import { IconLock, IconShield, IconCheck, IconTruck, IconPin, IconArrowRight } from "@/components/icons";
import { useAction, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { getSessionId } from "@/lib/session";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { CheckoutAccountBenefits } from "@/components/CheckoutAccountBenefits";
import { CheckoutMembership } from "@/components/CheckoutMembership";
import { MEMBERSHIP_TERMS_VERSION } from "@/lib/membership";
import { CheckoutLoopBanner } from "@/components/CheckoutLoopBanner";
import { CheckoutReminder } from "@/components/plans/CartPlanning";
import { useCart } from "@/components/cart/CartProvider";
import { usePromo } from "@/components/cart/usePromo";
import { useAccount } from "@/components/account/AccountProvider";
import { AGREEMENTS } from "@/lib/legal";
import { depositFor, depositChargeFor, smallDamageHold, formatGbp, type Protection } from "@/lib/pricing";

import { dayMs as ms } from "@/lib/dates";
import { PICKUP_SLOTS as SLOTS, HOURS_SENTENCE } from "@/lib/site";

const PC_RE = /\b(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i;

function StepCard({
  n,
  title,
  sub,
  done,
  children,
  delay = 0,
}: {
  n: string;
  title: string;
  sub?: string;
  done?: boolean;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <section
      className="spot gradient-border relative overflow-hidden rounded-2xl p-5 sm:p-6"
      style={{ animation: `card-in 0.55s var(--ease-out-expo) ${delay}ms both` }}
    >
      <span className="font-poster pointer-events-none absolute -right-1 -top-3 text-7xl text-white/[0.04]" aria-hidden>
        {n}
      </span>
      <div className="flex items-center gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs transition-colors ${
            done ? "bg-emerald-500/20 text-emerald-300" : "bg-accent-500/15 text-accent-300"
          }`}
        >
          {done ? <IconCheck className="h-3.5 w-3.5" /> : n}
        </span>
        <div>
          <h2 className="font-display font-semibold text-white/90">{title}</h2>
          {sub && <p className="text-xs text-white/40">{sub}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function CheckoutPage() {
  const { items, subtotal, eligibleSubtotal, membership, setMembership } = useCart();
  const account = useAccount();
  const promo = usePromo(eligibleSubtotal);
  const start = useAction(api.checkout.start);
  const getPriceQuote = useAction(api.checkout.priceQuote);
  const getQuote = useAction(api.delivery.quote);
  const track = useMutation(api.analytics.track);
  const membershipRequest = useRef<string|null>(null);

  useEffect(() => { membershipRequest.current = null; }, [membership?.tier, membership?.intro]);
  const replacementSum = items.reduce((n, i) => n + i.deposit, 0);
  const acctPostcode = account.me?.address?.match(PC_RE)?.[1] ?? "";

  const [email, setEmail] = useState(account.me?.email ?? "");
  const [name, setName] = useState(account.me?.name ?? "");
  const [phone, setPhone] = useState(account.me?.phone ?? "");
  const [billingAddress, setBillingAddress] = useState(account.me?.address ?? "");
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
  const [holdAgreed, setHoldAgreed] = useState(false);
  const [laterChargeAgreed, setLaterChargeAgreed] = useState(false);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoted, setQuoted] = useState<{
    key: string;
    value: Awaited<ReturnType<typeof getPriceQuote>>;
  } | null>(null);

  useEffect(() => {
    const profile = account.me;
    if (!profile) return;
    setEmail(v => v || profile.email);
    setName(v => v || profile.name || "");
    setPhone(v => v || profile.phone || "");
    setBillingAddress(v => v || profile.address || "");
    setAddress(v => v || profile.address || "");
    setPostcode(v => v || profile.address?.match(PC_RE)?.[1] || "");
  }, [account.me?.email]);
  const deliveryFee = fulfilment === "delivery" && dq?.ok ? dq.fee : 0;

  const detailsDone = /\S+@\S+\.\S+/.test(email) && name.trim().length >= 3 && billingAddress.trim().length >= 10;
  const deliveryAddressPostcode = address.match(PC_RE)?.[1]?.replace(/\s/g, "").toUpperCase() ?? "";
  const quotedPostcode = postcode.match(PC_RE)?.[1]?.replace(/\s/g, "").toUpperCase() ?? "";
  const fulfilmentDone =
    !!pickupTime && !!returnTime && (fulfilment === "pickup" ||
      (dq?.ok && address.trim().length >= 10 && deliveryAddressPostcode === quotedPostcode && !!quotedPostcode && deliveryAgreed));
  const priceArgs = {
    items: items.map((i) => ({
      listingId: i.listingId as any, title: i.title, start: ms(i.start), end: ms(i.end),
      qty: 1, total: i.total, deposit: i.deposit, offerType: i.offerType,
    })),
    token: account.token && account.me ? account.token : undefined,
    selectedMembership: membership ? {tier:membership.tier,intro:membership.intro} : undefined,
    customerEmail: email || account.me?.email || "",
    fulfilment,
    address: fulfilment === "delivery" ? address : undefined,
    deliveryPostcode: fulfilment === "delivery" ? postcode : undefined,
    promoCode: promo.applied ?? undefined,
    protection,
  };
  const quoteKey = JSON.stringify({ ...priceArgs, quotedDeliveryFee: dq?.fee ?? null });
  const currentQuote = quoted?.key === quoteKey ? quoted.value : null;
  const holdAmount = currentQuote?.depositHoldAmount ?? depositFor(protection, replacementSum);
  const depositAmount = currentQuote?.depositAmount ?? depositChargeFor(protection, replacementSum);

  useEffect(() => {
    setHoldAgreed(false);
    setLaterChargeAgreed(false);
    setQuoteError(null);
    if (!priceArgs.items.length || (fulfilment === "delivery" && (!dq?.ok || !quotedPostcode))) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getPriceQuote(priceArgs).then((value) => {
        if (!cancelled) {
          // A refreshed provider-side price needs a fresh, amount-specific consent.
          setHoldAgreed(false);
          setLaterChargeAgreed(false);
          setQuoted({ key: quoteKey, value });
        }
      }).catch((e: any) => {
        if (!cancelled) setQuoteError(e?.message ?? "Could not calculate this rental total.");
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [quoteKey, getPriceQuote]);

  const signDone = agreed && holdAgreed && laterChargeAgreed && signature.trim().length > 2;

  const valid = (!account.token || !!account.me) && (!membership || membership.termsAccepted) && items.length > 0 && detailsDone && fulfilmentDone && signDone && !!currentQuote && !quoteError;

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
    track({ type: "checkout_start", sessionId: getSessionId() }).catch(() => {});
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
        token: account.token ?? undefined, // Server verifies account ownership and current member benefits.
        customer: { email, name: name || undefined, phone: phone || undefined, billingAddress },
        fulfilment,
        address: fulfilment === "delivery" ? address : undefined,
        deliveryPostcode: fulfilment === "delivery" ? postcode : undefined,
        deliveryFee: currentQuote!.quotedDeliveryFee,
        expectedTotalDue: currentQuote!.combinedTotalDue,
        selectedMembership: membership ? {tier:membership.tier,intro:membership.intro,termsVersion:MEMBERSHIP_TERMS_VERSION,requestId:membershipRequest.current ?? (membershipRequest.current = crypto.randomUUID())} : undefined,
        promoCode: promo.applied ?? undefined,
        protection,
        pickupTime,
        returnTime,
        agreement: { name: signature.trim(), securityHoldConsent: holdAgreed, laterChargeConsent: laterChargeAgreed, documents: docs },
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
        <main className="mx-auto max-w-4xl px-6 py-24 text-center">
          <div className="hud-label">Nothing to check out</div>
          <p className="mt-3 text-white/40">Your kit is empty.</p>
          <Link href="/gear" className="btn-primary mt-6 px-7 py-3">
            Browse gear
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </main>
      </>
    );

  const label = "hud-label mb-1.5 block";

  return (
    <>
      <SiteHeader />
      <CheckoutLoopBanner />
      <main className="section-window mx-auto max-w-5xl px-6 pb-12 pt-8">
        <CheckoutMembership appliedSavings={currentQuote ? {rentalSaving:currentQuote.rentalSaving,weekendSaving:currentQuote.weekendSaving,deliveryReduction:currentQuote.deliveryReduction,securityWaiverReason:currentQuote.securityWaiverReason} : undefined} suggestions={currentQuote?.recommendations} selected={membership} onChange={value=>{setMembership(value); membershipRequest.current=null;}} />
        <div className="mb-5 rounded-2xl border border-white/10 p-4"><CheckoutReminder /></div>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
          <span className="inline-flex items-center gap-1.5">
            <IconLock className="h-3.5 w-3.5 text-accent-400" />
            Encrypted checkout by Stripe
          </span>
          <span className="text-white/20">·</span>
          <span>Any upfront refundable security payment is returned after safe return; the card hold is released separately</span>
          <span className="text-white/20">·</span>
          <span>Need a hand? Message us any time</span>
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_330px]">
          <div className="flex flex-col gap-5">
            {/* 01 — details */}
            <StepCard n="01" title="Your details" done={detailsDone} delay={0}>
              <div className="flex flex-col gap-3">
                <div>
                  <label className={label} htmlFor="co-email">Email *</label>
                  <input id="co-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" type="email" className="input w-full" />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex-1">
                    <label className={label} htmlFor="co-name">Full billing name *</label>
                    <input id="co-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="input w-full" />
                  </div>
                  <div className="flex-1">
                    <label className={label} htmlFor="co-phone">Phone</label>
                    <input id="co-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="For pickup coordination" className="input w-full" />
                  </div>
                </div>
                <div>
                  <label className={label} htmlFor="co-billing-address">Billing address *</label>
                  <textarea id="co-billing-address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} rows={2} placeholder="Street, town or city, postcode" className="input w-full" />
                  <p className="mt-1 text-[11px] text-white/40">Used on your rental statement. You will separately submit proof of address through the verification provider.</p>
                </div>
              </div>
            </StepCard>

            <CheckoutAccountBenefits />

            {/* 02 — fulfilment */}
            <StepCard
              n="02"
              title="Fulfilment"
              sub={`Pickup, return & delivery windows: ${HOURS_SENTENCE}.`}
              done={fulfilmentDone}
              delay={70}
            >
              <div className="flex gap-3">
                {(
                  [
                    ["pickup", IconPin, "Pickup", "central London"],
                    ["delivery", IconTruck, "Delivery", "quoted by distance"],
                  ] as const
                ).map(([f, Icon, t, d]) => (
                  <button
                    key={f}
                    onClick={() => setFulfilment(f)}
                    className={`flex flex-1 items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${
                      fulfilment === f
                        ? "border-accent-400 bg-accent-400/10 accent-glow"
                        : "border-white/10 hover:border-white/25"
                    }`}
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${fulfilment === f ? "text-accent-400" : "text-white/40"}`} />
                    <span>
                      <span className="block text-sm font-medium text-white/85">{t}</span>
                      <span className="block text-xs text-white/40">{d}</span>
                    </span>
                  </button>
                ))}
              </div>
              {fulfilment === "delivery" && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input
                      value={postcode}
                      onChange={(e) => { setPostcode(e.target.value); setDq(null); }}
                      placeholder="Delivery postcode *"
                      className="input min-w-0 flex-1 font-mono uppercase placeholder:normal-case placeholder:font-sans"
                    />
                    <button onClick={quoteDelivery} disabled={quoting || !postcode.trim()} className="btn-primary px-4 text-sm">
                      {quoting ? "…" : "Get quote"}
                    </button>
                  </div>
                  {dq && (dq.ok ? (
                    <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                      {dq.vehicleLabel} · ~{dq.km}km · round trip (delivery + collection): 2 × £{dq.oneWay}{" "}
                      <span className="font-semibold">= £{dq.fee}</span>{" "}
                      <span className="text-emerald-300/60">(incl. margin)</span>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">{dq.reason}</div>
                  ))}
                  <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Full delivery address, including postcode *" rows={2} className="input w-full" />
                  {address.trim().length > 0 && deliveryAddressPostcode !== quotedPostcode &&
                    <p className="text-xs text-amber-200">Include the same postcode in your delivery address as the quote above.</p>}
                  <label className="flex items-start gap-2 text-xs leading-relaxed text-white/55">
                    <input type="checkbox" checked={deliveryAgreed} onChange={(e) => setDeliveryAgreed(e.target.checked)} className="mt-0.5 accent-accent-500" />
                    <span>I understand delivery uses a third-party courier (Addison Lee). Times are estimates only — no exact time is guaranteed and delivery may be affected by traffic. Estimates are accurate within ~15%; the final price is confirmed by the courier. No refunds for courier delays.</span>
                  </label>
                </div>
              )}

              {/* times (both pickup & delivery) */}
              <div className="mt-4 flex gap-3">
                <div className="flex-1">
                  <label className={label} htmlFor="co-time-out">
                    {fulfilment === "delivery" ? "Delivery time *" : "Pickup time *"}
                  </label>
                  <select id="co-time-out" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} className="input w-full [color-scheme:dark]">
                    <option value="">Select…</option>
                    {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className={label} htmlFor="co-time-back">
                    {fulfilment === "delivery" ? "Collection time *" : "Return time *"}
                  </label>
                  <select id="co-time-back" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} className="input w-full [color-scheme:dark]">
                    <option value="">Select…</option>
                    {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </StepCard>

            {/* 03 — protection */}


            <StepCard n="03" title="Protection" sub="Choose how you cover the gear." done delay={140}>
              <div className="flex flex-col gap-2.5">
                <button
                  onClick={() => setProtection("verify")}
                  className={`group rounded-xl border p-4 text-left transition-all ${
                    protection === "verify"
                      ? "border-accent-400 bg-accent-400/10 accent-glow"
                      : "border-white/10 hover:border-white/25"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-2.5 text-sm font-medium text-white/85">
                      <IconShield className={`h-4.5 w-4.5 shrink-0 ${protection === "verify" ? "text-accent-400" : "text-white/40"}`} />
                      ID verification + insurance
                      <span className="rounded bg-accent-500/20 px-1.5 py-0.5 font-mono text-[10px] uppercase text-accent-300">
                        recommended
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-sm text-accent-300">{formatGbp(smallDamageHold(replacementSum))} hold</span>
                  </div>
                  <p className="mt-1.5 text-xs text-white/40">
                    {formatGbp(currentQuote?.securityWaiverReason ? 0 : depositChargeFor("verify", replacementSum))} refundable security payment at checkout, plus a separate {formatGbp(smallDamageHold(replacementSum))} card hold. Automatic ID, selfie and address check before handover.
                  </p>
                </button>
                <button
                  onClick={() => setProtection("deposit")}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    protection === "deposit"
                      ? "border-accent-400 bg-accent-400/10 accent-glow"
                      : "border-white/10 hover:border-white/25"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-2.5 text-sm font-medium text-white/85">
                      <IconLock className={`h-4.5 w-4.5 shrink-0 ${protection === "deposit" ? "text-accent-400" : "text-white/40"}`} />
                      Full-value card hold
                    </span>
                    <span className="shrink-0 font-mono text-sm text-accent-300">{formatGbp(replacementSum)} hold</span>
                  </div>
                  <p className="mt-1.5 text-xs text-white/40">{formatGbp(currentQuote?.securityWaiverReason ? 0 : depositChargeFor("deposit", replacementSum))} refundable security payment at checkout, plus a separate {formatGbp(replacementSum)} card hold. Automatic ID, selfie and address check before handover.</p>
                </button>
              </div>
            </StepCard>

            {/* 04 — agreements */}
            <StepCard n="04" title="Agreements & signature" sub="Required for your booking, deposit and insurance cover." done={signDone} delay={210}>
              <label className="flex items-start gap-2.5 text-sm leading-relaxed text-white/60">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 accent-accent-500" />
                <span>
                  I have read and agree to the{" "}
                  {AGREEMENTS.map((d, i) => (
                    <span key={d.kind}>
                      <a href={`/legal/${d.kind}`} target="_blank" className="text-accent-400 underline-offset-2 hover:underline">{d.title}</a>
                      {i < AGREEMENTS.length - 1 ? ", " : "."}
                    </span>
                  ))}
                </span>
              </label>
              <label className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-white/60">
                <input type="checkbox" checked={holdAgreed} disabled={!currentQuote} onChange={(e) => setHoldAgreed(e.target.checked)} className="mt-0.5 accent-accent-500 disabled:opacity-40" />
                <span>I authorise a separate {formatGbp(holdAmount)} card hold for equipment security, in addition to the {formatGbp(depositAmount)} refundable payment charged now. I understand the hold may expire and my bank may require a new authorisation.</span>
              </label>
              <label className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-white/60">
                <input type="checkbox" checked={laterChargeAgreed} disabled={!currentQuote} onChange={(e) => setLaterChargeAgreed(e.target.checked)} className="mt-0.5 accent-accent-500 disabled:opacity-40" />
                <span>I separately agree to itemised late rental time at each booked item’s daily rate, and documented loss, damage or insurance excess. After notice, an unused active hold may cover a late fee if no damage is due; any balance may be attempted on this saved card. No amount will be collected twice. A new charge may require bank authentication.</span>
              </label>
              <div className="mt-4">
                <label className={label} htmlFor="co-sig">Sign by typing your full name *</label>
                <input
                  id="co-sig"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Your signature"
                  className="input serif-accent w-full border-b-2 border-b-accent-400/30 !text-xl text-white/90 placeholder:font-sans placeholder:text-sm"
                />
              </div>
            </StepCard>
          </div>

          {/* summary */}
          <aside className="ticket spot gradient-border h-fit rounded-2xl p-5 lg:sticky! lg:top-24">
            <div className="hud-label !text-accent-400/90">Order summary</div>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              {items.map((i, index) => (
                <div key={i.key} className="flex justify-between text-white/55">
                  <span className="mr-2 line-clamp-1">
                    {currentQuote?.items[index]?.title ?? i.title}
                    {i.offerType ? " (offer)" : ""}
                  </span>
                  <span className="shrink-0 font-mono">{formatGbp(currentQuote?.items[index]?.total ?? i.total)}</span>
                </div>
              ))}
            </div>
            <hr className="receipt-sep" />
            <div className="text-sm">
              <Row label="Rental subtotal" value={currentQuote?.subtotal ?? subtotal} />
              {!!currentQuote && currentQuote.totalReduction > 0 && (
                <div className="flex justify-between text-emerald-300">
                  <span>{currentQuote.reductionLabel ?? "Rental discount"}</span>
                  <span className="font-mono">−{formatGbp(currentQuote.totalReduction)}</span>
                </div>
              )}
              {(currentQuote?.deliveryFee ?? deliveryFee) > 0 && <Row label="Delivery (round trip)" value={currentQuote?.deliveryFee ?? deliveryFee} />}
              <Row label={currentQuote?.securityWaiverReason ? "Upfront security payment waived · full hold remains" : "Refundable security payment (50%)"} value={depositAmount} muted />
              {!!membership && <Row label={membership.intro === "trial" ? "Membership · 7 days free" : "First membership month"} value={currentQuote?.membershipFee ?? 0} />}
              <Row label="Separate card hold (not charged)" value={holdAmount} muted />
              {!!currentQuote && currentQuote.creditApplied > 0 && (
                <div className="flex justify-between text-emerald-300">
                  <span>Account credit</span>
                  <span className="font-mono">−{formatGbp(currentQuote.creditApplied)}</span>
                </div>
              )}
              <hr className="receipt-sep" />
              <div className="flex justify-between font-display text-xl font-bold text-white">
                <span>Total due</span>
                <span className="font-mono">{currentQuote ? formatGbp(currentQuote.combinedTotalDue) : "Calculating…"}</span>
              </div>
            </div>
            {quoteError && <div className="mt-3 rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">{quoteError}</div>}
            {err && <div className="mt-3 rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
            <button onClick={pay} disabled={!valid || busy} className="btn-primary mt-5 w-full py-3">
              {busy ? "Redirecting…" : "Pay with card"}
              {!busy && <IconLock className="h-4 w-4" />}
            </button>
            <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.15em] text-white/25">
              Secured by Stripe
            </p>
          </aside>
        </div>
      </main>
    </>
  );
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-white/35" : "text-white/60"}`}>
      <span>{label}</span>
      <span className="font-mono">{formatGbp(value)}</span>
    </div>
  );
}
