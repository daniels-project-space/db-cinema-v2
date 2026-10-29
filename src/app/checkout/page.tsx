"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { IconLock, IconCheck, IconTruck, IconPin, IconArrowRight } from "@/components/icons";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { getSessionId } from "@/lib/session";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { CheckoutMembership } from "@/components/CheckoutMembership";
import { MEMBERSHIP_TERMS_VERSION } from "@/lib/membership";
import { accountPricingContext, shouldResetMembershipPreference, membershipOfferContext, membershipRecommendationPreview } from "../../../shared/membershipSelection";
import { CheckoutLoopBanner } from "@/components/CheckoutLoopBanner";
import { BasketRecoveryStatus } from "@/components/plans/CartPlanning";
import { useCart } from "@/components/cart/CartProvider";
import { useCheckoutStatus, CheckoutPauseNotice, CHECKOUT_PAUSED_MESSAGE } from "@/components/cart/CheckoutStatus";
import { CheckoutCode } from "@/components/cart/CheckoutCode";
import { usePromo } from "@/components/cart/usePromo";
import { useBasketPrice } from "@/components/cart/useBasketPrice";
import { useCartStockCheck } from "@/components/cart/useCartStockCheck";
import { CartStockNotice } from "@/components/cart/CartStockNotice";
import { useAccount } from "@/components/account/AccountProvider";
import { AGREEMENTS, agreementsForSecurityPolicy } from "@/lib/legal";
import { DELIVERY_TERMS_VERSION, DELIVERY_ACCEPTANCE_TEXT } from "../../../shared/rentalAgreement";
import { depositFor, depositChargeFor, smallDamageHold, formatGbp, type Protection } from "@/lib/pricing";
import { browserCheckoutStorage, readCheckoutDraft, saveCheckoutDraft } from "@/lib/checkoutDraft";
import { CartItemTimes } from "@/components/cart/CartItemTimes";
import { NextAvailableRentalOptions } from "@/components/checkout/NextAvailableRentalOptions";
import { ReplacementSets } from "@/components/cart/ReplacementSets";
import { dayMs as ms } from "@/lib/dates";
import { HOURS_SENTENCE } from "@/lib/site";
import { groupDeliveryItems } from "../../../shared/deliveryGroups";

import {useCreditBalance} from "@/components/account/useCreditBalance";
import {CancellationProtection} from "@/components/cart/CancellationProtection";
import { ASSESSMENT_SECURITY_POLICY_VERSION, hasCashDepositPolicy, savedCardChargeLimit, SECURITY_POLICY_VERSION, REFUNDABLE_DEPOSIT_POLICY_VERSION } from "../../../shared/rentalSecurity";

const PC_RE = /\b(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i;
const DRAFT_TERMS = JSON.stringify({ documents: AGREEMENTS, delivery: DELIVERY_TERMS_VERSION });

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
  const checkout = useCheckoutStatus();
  const checkoutSettings=useQuery(api.settings.get,{});
  const creditAvailability=useCreditBalance(account.token&&account.me?account.token:null);
  const start = useAction(api.checkout.start);
  const getPriceQuote = useAction(api.checkout.priceQuote);
  const getQuote = useAction(api.delivery.quote);
  const track = useMutation(api.analytics.track);
  const membershipRequest = useRef<string|null>(null);
  const membershipRecommendationCache = useRef<{offerContext:string;recommendations:any[]}|null>(null);

  useEffect(() => { membershipRequest.current = null; }, [membership?.tier, membership?.intro]);
  const replacementSum = items.reduce((n, i) => n + i.deposit, 0);
  const acctPostcode = account.me?.address?.match(PC_RE)?.[1] ?? "";

  const [useAccountCredit,setUseAccountCredit]=useState(false);
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
  const allItemTimes=!!items.length&&items.every(i=>i.pickupTime&&i.returnTime);
  const effectivePickupTime=allItemTimes?[...items].sort((a,b)=>(a.start+" "+a.pickupTime).localeCompare(b.start+" "+b.pickupTime))[0].pickupTime!:"";
  const effectiveReturnTime=allItemTimes?[...items].sort((a,b)=>(b.end+" "+b.returnTime).localeCompare(a.end+" "+a.returnTime))[0].returnTime!:"";
  const stock=useCartStockCheck(items),availability=stock.availability;
  const invalidTimeOrder = items.some(i => i.start===i.end && !!i.pickupTime && !!i.returnTime && i.returnTime<=i.pickupTime);
  const availabilityBlocked = !!items.length && (!stock.ready || !availability || items.some(i => !availability[i.listingId]?.ok));
  const unavailableItems = items.filter(item => availability?.[item.listingId]?.ok === false);
  const unavailableLineIndices = items.flatMap((item, index) => availability?.[item.listingId]?.ok === false ? [index] : []);
  const [deliveryAgreed, setDeliveryAgreed] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState("");
  const agreementRequest = useRef<string | null>(null);
  const signatureLimit = useRef<number | null>(null);
  const signedContext = useRef<string | null>(null);
  const draftScope = account.loading ? null : account.me ? `account:${account.me._id}` : "guest";
  const [restoredScope, setRestoredScope] = useState<string | null>(null);
  const draftReady = !!draftScope && restoredScope === draftScope;
  const deliveryRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recovery,setRecovery]=useState<{key:string;acceptance:string}|null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoted, setQuoted] = useState<{
    key: string;
    offerContext: string;
    value: Awaited<ReturnType<typeof getPriceQuote>>;
  } | null>(null);

  useEffect(() => {
    if (!draftScope) return;
    const draft = readCheckoutDraft(browserCheckoutStorage(), draftScope, DRAFT_TERMS);
    const profile = account.me;
    setEmail(draft?.email ?? profile?.email ?? "");
    setName(draft?.name ?? profile?.name ?? "");
    setPhone(draft?.phone ?? profile?.phone ?? "");
    setBillingAddress(draft?.billingAddress ?? profile?.address ?? "");
    setFulfilment(draft?.fulfilment ?? "pickup");
    setAddress(draft?.address ?? profile?.address ?? "");
    setPostcode(draft?.postcode ?? profile?.address?.match(PC_RE)?.[1] ?? "");
    setProtection(draft?.protection ?? "verify");
    setUseAccountCredit(draft?.useAccountCredit??false);
    setAgreed(draft?.agreed ?? false);
    setDeliveryAgreed(draft?.deliveryAgreed ?? false);
    setSignature(""); setDq(null); setQuoting(false); setRecovery(null); setQuoted(null);
    agreementRequest.current = null; membershipRequest.current = null;
    deliveryRequest.current++;
    setRestoredScope(draftScope);
  }, [draftScope]);

  useEffect(() => {
    if (!draftReady) return;
    saveCheckoutDraft(browserCheckoutStorage(), draftScope!, DRAFT_TERMS, {
      email, name, phone, billingAddress, fulfilment, address, postcode, protection,
      agreed, deliveryAgreed,useAccountCredit,
    });
  }, [draftReady, draftScope, email, name, phone, billingAddress, fulfilment, address,
    postcode, protection, agreed, deliveryAgreed,useAccountCredit]);

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
  const deliveryGroups = useMemo(() => groupDeliveryItems(items.map(i => ({
    listingId: i.listingId as string, start: ms(i.start), end: ms(i.end),
  }))), [items]);
  const deliveryKey = JSON.stringify({
    postcode: postcode.trim().replace(/\s+/g, "").toUpperCase(),
    groups: deliveryGroups,
  });
  const deliveryQuoteCurrent = fulfilment === "delivery" && dq?.ok && dq.key === deliveryKey;
  const deliveryDateLabel = (value: number) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
  const deliveryPeriodLabel = (start: number, end: number) => start === end ? deliveryDateLabel(start) : `${deliveryDateLabel(start)}–${deliveryDateLabel(end)}`;

  const detailsDone = /\S+@\S+\.\S+/.test(email) && name.trim().length >= 3 && billingAddress.trim().length >= 10;
  const deliveryAddressPostcode = address.match(PC_RE)?.[1]?.replace(/\s/g, "").toUpperCase() ?? "";
  const quotedPostcode = postcode.match(PC_RE)?.[1]?.replace(/\s/g, "").toUpperCase() ?? "";
  const fulfilmentDone =
    allItemTimes && !invalidTimeOrder && (fulfilment === "pickup" ||
      (deliveryQuoteCurrent && address.trim().length >= 10 && deliveryAddressPostcode === quotedPostcode && !!quotedPostcode && deliveryAgreed));
  const priceArgs = {
    items: items.map((i) => ({
      listingId: i.listingId as any, title: i.title, start: ms(i.start), end: ms(i.end),
      qty: 1, total: i.total, deposit: i.deposit, offerType: i.offerType,pickupTime:i.pickupTime,returnTime:i.returnTime,
    })),
    token: account.token && account.me ? account.token : undefined,
    selectedMembership: membership ? {tier:membership.tier,intro:membership.intro} : undefined,
    customerEmail: email || account.me?.email || "",
    fulfilment,
    address: fulfilment === "delivery" ? address : undefined,
    deliveryPostcode: fulfilment === "delivery" ? postcode : undefined,
    promoCode: promo.applied ?? undefined,
    protection,useAccountCredit,
  };
  const quoteKey = JSON.stringify({ ...priceArgs, quotedDeliveryFee: deliveryQuoteCurrent ? dq.fee : null, creditReservation:creditAvailability?.available??null, policy:{assessment:checkoutSettings?.assessmentSecurityEnabled,deposit:checkoutSettings?.refundableDepositEnabled,cancellation:checkoutSettings?.cancellationProtectionEnabled}, account: accountPricingContext(account.me) });
  const offerContext = membershipOfferContext({ ...priceArgs, quotedDeliveryFee: deliveryQuoteCurrent ? dq.fee : null, account: accountPricingContext(account.me) });
  const currentQuote = quoted?.key === quoteKey ? quoted.value : null;
  // Delivery details are not needed to quote the rental-only joining saving.
  // This preview never becomes the billing quote or enables payment.
  const rentalPreview = useBasketPrice(true, false, effectivePickupTime, effectiveReturnTime);
  const membershipDisplayQuote = currentQuote ?? rentalPreview.quote;
  const membershipRecommendations = membershipRecommendationPreview(membershipRecommendationCache.current, offerContext, !!quoteError);
  const displayedRecommendations = membershipRecommendations?.length ? membershipRecommendations : rentalPreview.recommendations?.length ? rentalPreview.recommendations : membershipDisplayQuote?.recommendations ?? [];
  useEffect(() => {
    if (!membership && displayedRecommendations.length) membershipRecommendationCache.current={offerContext,recommendations:displayedRecommendations};
  }, [displayedRecommendations, membership, offerContext]);
  const equipmentValue = currentQuote?.replacementValue ?? replacementSum;
  useEffect(() => { if (equipmentValue < 1000 && protection === "deposit") setProtection("verify"); }, [equipmentValue, protection]);
  const holdAmount = currentQuote?.depositHoldAmount ?? depositFor(protection, replacementSum);
  const depositAmount = currentQuote?.depositAmount ?? depositChargeFor(protection, replacementSum);

  useEffect(() => {
    setQuoteError(null);
    if (!draftReady || !priceArgs.items.length || (fulfilment === "delivery" && (!deliveryQuoteCurrent || !quotedPostcode))) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getPriceQuote(priceArgs).then((value) => {
        if (!cancelled) {
          if (!membership && value.recommendations?.length) membershipRecommendationCache.current={offerContext,recommendations:value.recommendations};
          setQuoted({ key: quoteKey, offerContext, value });
          if (shouldResetMembershipPreference(membership, value)) {
            setMembership(null);
            membershipRequest.current = null;
            return;
          }
        }
      }).catch((e: any) => {
        if (!cancelled) setQuoteError(e?.message ?? "Could not calculate this rental total.");
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [quoteKey, getPriceQuote, draftReady]);

  // Reading the documents and signing the current order are separate. Changes
  // to the order invalidate the signature/attempt. Changed security amounts or
  // policy also reset consent below, since the checkbox accepts those terms.
  const signingContext = JSON.stringify({ quoteKey, name, phone, billingAddress, pickupTime:effectivePickupTime, returnTime:effectiveReturnTime,
    deliveryAgreed, due: currentQuote?.combinedTotalDue, useAccountCredit,policy: currentQuote?.securityPolicyVersion, cancellationProtection:currentQuote?.cancellationProtectionEnabled, deposit: currentQuote?.depositAmount, hold: currentQuote?.depositHoldAmount });
  useEffect(() => { setSignature(""); agreementRequest.current = null; setRecovery(null); }, [signingContext]);
  useEffect(() => { agreementRequest.current = null; }, [signature, agreed]);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { setSignature(""); agreementRequest.current = null; setRecovery(null); }
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  const futureChargeLimit = currentQuote?.savedCardLimit ?? savedCardChargeLimit(equipmentValue);
  const refundablePolicy = hasCashDepositPolicy(currentQuote?.securityPolicyVersion);
  const assessmentPolicy=currentQuote?.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION;
  const rentalAgreements = agreementsForSecurityPolicy(currentQuote?.securityPolicyVersion,currentQuote?.cancellationProtectionEnabled);
  const savedCardQuoteReady = !!currentQuote && (currentQuote.securityPolicyVersion === SECURITY_POLICY_VERSION || refundablePolicy) && Number.isFinite(currentQuote.savedCardLimit) && (refundablePolicy ? [0,20,50,100].includes(currentQuote.depositAmount) : currentQuote.depositAmount === 0) && currentQuote.depositHoldAmount === 0;
  useEffect(()=>{setAgreed(false);setSignature("");agreementRequest.current=null;},[futureChargeLimit,currentQuote?.depositAmount,currentQuote?.securityPolicyVersion,currentQuote?.cancellationProtectionEnabled]);
  const signDone = agreed && signature.trim().length > 2 && signatureLimit.current === futureChargeLimit && signedContext.current === signingContext;

  const valid = draftReady && savedCardQuoteReady && (!account.token || !!account.me) && (!membership || membership.termsAccepted) && items.length > 0 && detailsDone && fulfilmentDone && signDone && !!currentQuote && !quoteError;

  const openedRecorded=useRef(false);
  useEffect(()=>{if(items.length&&draftReady&&!openedRecorded.current){openedRecorded.current=true;void track({type:"checkout_opened",sessionId:getSessionId()}).catch(()=>{});}},[items.length,draftReady,track]);
  const readyRecorded=useRef(false);
  useEffect(()=>{if(valid&&!readyRecorded.current){readyRecorded.current=true;void track({type:"checkout_form_ready",sessionId:getSessionId()}).catch(()=>{});}},[valid,track]);

  const currentDeliveryKey = useRef(deliveryKey);
  currentDeliveryKey.current = deliveryKey;

  const quoteDelivery = useCallback(async () => {
    if (!postcode.trim() || !deliveryGroups.length) return;
    const request = ++deliveryRequest.current, key = deliveryKey;
    const current = () => deliveryRequest.current === request && currentDeliveryKey.current === key;
    setQuoting(true);
    setDq(null);
    try {
      const r = await getQuote({ postcode: postcode.trim(), groups: deliveryGroups.map(group => ({ ...group, listingIds: group.listingIds as any })) });
      if (current()) setDq({ ...r, key });
    } catch (e: any) {
      if (current()) setDq({ ok: false, reason: e?.message ?? "Quote failed", key });
    } finally {
      if (deliveryRequest.current === request) setQuoting(false);
    }
  }, [deliveryGroups, deliveryKey, getQuote, postcode]);
  const quoteDeliveryRef = useRef(quoteDelivery);
  quoteDeliveryRef.current = quoteDelivery;
  useEffect(() => {
    if (draftReady && fulfilment === "delivery" && PC_RE.test(postcode)) void quoteDeliveryRef.current();
  }, [draftReady, fulfilment, deliveryKey]);

  const recoveryKey=JSON.stringify({priceArgs,phone,billingAddress,name,email,pickupTime:effectivePickupTime,returnTime:effectiveReturnTime,signature,agreed,deliveryAgreed,total:currentQuote?.combinedTotalDue,deliveryFee:currentQuote?.quotedDeliveryFee,membershipTermsAccepted:membership?.termsAccepted});
  const recoveryStock = useQuery(api.bookings.recoveryStock,recovery?.acceptance ? {requestId:recovery.acceptance,token:account.token??undefined}:"skip");
  const canRecover=recovery?.key===recoveryKey&&recovery.acceptance===agreementRequest.current&&recoveryStock?.ready===true;
  async function pay() {
    if (!checkout.enabled) { setErr(CHECKOUT_PAUSED_MESSAGE); return; }
    if (availabilityBlocked&&!canRecover) { setErr("Review your basket and choose available alternatives before checkout."); return; }
    if (!valid) return;
    setBusy(true);
    setErr(null);
    track({ type: "checkout_start", sessionId: getSessionId() }).catch(() => {});
    const acceptanceAttempt = agreementRequest.current ?? (agreementRequest.current = crypto.randomUUID());
    const membershipAttempt = membership ? membershipRequest.current ?? (membershipRequest.current = crypto.randomUUID()) : null;
    try {
      const docs: { kind: string; version: string }[] = rentalAgreements.map((d) => ({ kind: d.kind, version: d.version }));
      if (fulfilment === "delivery") docs.push({ kind: "delivery-disclaimer", version: DELIVERY_TERMS_VERSION });
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
          pickupTime: i.pickupTime,
          returnTime: i.returnTime,
        })),
        token: account.token ?? undefined, // Server verifies account ownership and current member benefits.
        customer: { email, name: name || undefined, phone: phone || undefined, billingAddress },
        fulfilment,
        address: fulfilment === "delivery" ? address : undefined,
        deliveryPostcode: fulfilment === "delivery" ? postcode : undefined,
        deliveryFee: currentQuote!.quotedDeliveryFee,
        expectedTotalDue: currentQuote!.combinedTotalDue,
        expectedSavedCardLimit:futureChargeLimit,
        selectedMembership: membership ? {tier:membership.tier,intro:membership.intro,termsVersion:MEMBERSHIP_TERMS_VERSION,requestId:membershipAttempt!} : undefined,
        promoCode: promo.applied ?? undefined,
        protection,useAccountCredit,
        pickupTime:effectivePickupTime,
        returnTime:effectiveReturnTime,
        agreement: { name: signature.trim(), requestId: acceptanceAttempt, securityHoldConsent: agreed, laterChargeConsent: agreed, documents: docs },
      });
      await Promise.race([track({type:"payment_redirect",sessionId:getSessionId()}).catch(()=>{}),new Promise(resolve=>setTimeout(resolve,400))]);
      window.location.href = url;
    } catch (e: any) {
      void track({type:"checkout_failure",sessionId:getSessionId()}).catch(()=>{});
      if (e?.data?.code === "CHECKOUT_STOCK_REJECTED" && e.data.freshAcceptanceRequired === true && agreementRequest.current === acceptanceAttempt) {
        agreementRequest.current = null;
        if (membershipRequest.current === membershipAttempt) membershipRequest.current = null;
        setSignature("");
        setRecovery(null);
      } else if(agreementRequest.current===acceptanceAttempt) {
        setRecovery({key:recoveryKey,acceptance:acceptanceAttempt});
      }
      setErr(typeof e?.data?.message === "string" ? e.data.message : e?.message ?? "Something went wrong");
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
        <CheckoutCode benefitKind={currentQuote?.benefitKind}/>
        {checkoutSettings?.cancellationProtectionEnabled&&<div className="mb-4"><CancellationProtection/></div>}
        <CheckoutMembership variant="checkout" loading={rentalPreview.loading && !quoteError} appliedSavings={membershipDisplayQuote ?? undefined} suggestions={displayedRecommendations} selected={membership} onChange={value=>{setMembership(value); membershipRequest.current=null;}} />
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
                    <button onClick={() => void quoteDelivery()} disabled={quoting || !postcode.trim()} className="btn-primary px-4 text-sm">
                      {quoting ? "…" : "Get quote"}
                    </button>
                  </div>
                  <p className="text-[11px] text-white/45">One postcode covers every rental period; delivery and collection are calculated separately for each date range.</p>
                  {dq && dq.key === deliveryKey && (dq.ok ? (
                    <div className="space-y-1 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                      {dq.groups.map((group: {start:number;end:number;fee:number;oneWay:number;vehicleLabel:string;km:number}, index:number) => <div key={`${group.start}-${group.end}-${index}`} className="flex flex-wrap justify-between gap-x-3">
                        <span>{deliveryPeriodLabel(group.start, group.end)} · {group.vehicleLabel} · ~{group.km}km · 2 × £{group.oneWay}</span>
                        <span className="font-semibold">£{group.fee} round trip</span>
                      </div>)}
                      <div className="border-t border-emerald-300/15 pt-1 font-semibold">Total delivery & collection · £{dq.fee}</div>
                      <span className="text-emerald-300/60">Prices include the delivery margin.</span>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">{dq.reason}</div>
                  ))}
                  <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Full delivery address, including postcode *" rows={2} className="input w-full" />
                  {address.trim().length > 0 && deliveryAddressPostcode !== quotedPostcode &&
                    <p className="text-xs text-amber-200">Include the same postcode in your delivery address as the quote above.</p>}
                  <label className="flex items-start gap-2 text-xs leading-relaxed text-white/55">
                    <input type="checkbox" checked={deliveryAgreed} onChange={(e) => setDeliveryAgreed(e.target.checked)} className="mt-0.5 accent-accent-500" />
                    <span>{DELIVERY_ACCEPTANCE_TEXT}</span>
                  </label>
                </div>
              )}

              {/* times (both pickup & delivery) */}
              <div className="mt-3 divide-y divide-white/10">{items.map((item,index)=><CartItemTimes key={`${item.listingId}|${item.start}|${item.end}|${index}`} item={item} delivery={fulfilment==="delivery"}/>)}</div>
            </StepCard>

            <StepCard n="03" title="Agreements & signature" done={signDone} delay={140}>
              <div data-testid="rental-consent" className="rounded-xl border border-white/10 bg-black/10 p-4">
                <nav aria-label="Rental agreements" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-accent-300">
                  {rentalAgreements.map(d=><a key={d.kind} href={`/legal/${d.kind}?version=${encodeURIComponent(d.version)}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{d.title}</a>)}
                </nav>
                <label className="mt-4 flex items-start gap-2.5 text-sm leading-6 text-white/80">
                  <input data-testid="rental-agreement-checkbox" type="checkbox" checked={agreed} disabled={!currentQuote} onChange={e=>{setAgreed(e.target.checked);agreementRequest.current=null;}} className="mt-1 accent-accent-500 disabled:opacity-40"/>
                  <span data-testid="saved-card-consent-text">I agree to all the linked terms and authorise my card for future damage, loss and late-fee payments.</span>
                </label>
              </div>
              <div className="mt-4">
                <label className={label} htmlFor="co-sig">Sign by typing your full name *</label>
                <input
                  id="co-sig"
                  value={signature}
                  disabled={!draftReady || !currentQuote || busy}
                  onChange={(e) => { signatureLimit.current = futureChargeLimit; signedContext.current = signingContext; setSignature(e.target.value); }}
                  placeholder="Your signature"
                  className="input serif-accent w-full border-b-2 border-b-accent-400/30 !text-xl text-white/90 placeholder:font-sans placeholder:text-sm"
                />
              </div>
            </StepCard>
          </div>

          {/* summary */}
          <aside data-testid="checkout-summary" className="ticket spot gradient-border h-fit rounded-2xl p-5 lg:sticky! lg:top-24">
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
              {!!currentQuote && currentQuote.totalReduction - currentQuote.membershipSignupOfferSaving > 0 && (
                <div className="flex justify-between text-emerald-300">
                  <span>{currentQuote.reductionLabel ?? "Rental discount"}</span>
                  <span className="font-mono">−{formatGbp(currentQuote.totalReduction - currentQuote.membershipSignupOfferSaving)}</span>
                </div>
              )}
              {fulfilment === "delivery" && (currentQuote?.deliveryGroups ?? (deliveryQuoteCurrent ? dq.groups : [])).map((group: {start:number;end:number;fee:number}, index:number) => <Row key={`${group.start}-${group.end}-${index}`} label={`Delivery & collection · ${deliveryPeriodLabel(group.start,group.end)}`} value={group.fee} />)}
              {(creditAvailability?.available??0)>0&&(currentQuote?.availableAccountCredit??0)>0&&<label className="mb-4 block rounded-xl border border-emerald-300/20 bg-emerald-300/[.04] p-3 text-xs leading-5 text-white/75"><span className="flex items-center gap-2"><input data-testid="checkout-use-credit" type="checkbox" checked={useAccountCredit} disabled={busy} onChange={e=>{setUseAccountCredit(e.target.checked);if(e.target.checked)window.dispatchEvent(new CustomEvent("dbc:credit:selected",{detail:{accountId:account.me?._id}}));}}/>Use account credit · {formatGbp(currentQuote!.availableAccountCredit)} available</span><span className="mt-1 block text-[10px] text-white/50">Selected credit is non-refundable and cannot be withdrawn as cash, subject to statutory rights. Existing expiry dates apply. Credit cannot pay the refundable deposit or membership fee. Earned credit does not stack with discounts.</span></label>}
              {!!currentQuote?.membershipSignupOfferSaving && <Row label="One-time joining credit" value={-currentQuote.membershipSignupOfferSaving} saving />}
              {!!currentQuote?.membershipCreditApplied && <Row label="Subscription credit applied" value={-currentQuote.membershipCreditApplied} saving />}
              {!!currentQuote && currentQuote.creditApplied - currentQuote.membershipCreditApplied > 0 && (
                <div className="flex justify-between text-emerald-300">
                  <span>{currentQuote.refundCreditApplied>0&&currentQuote.earnedCreditApplied>0?"Refund + earned credit":currentQuote.refundCreditApplied>0?"Refund credit":"Earned credit"}</span>
                  <span className="font-mono">−{formatGbp(currentQuote.creditApplied-currentQuote.membershipCreditApplied)}</span>
                </div>
              )}
              <hr className="receipt-sep" />
              <div data-testid="checkout-secondary-charges" className="space-y-2">
                {!!membership && <Row label={membership.intro === "trial" ? "Subscription · first 7 days free" : "First subscription month"} value={currentQuote?.membershipFee ?? 0} muted />}
                <section data-testid="refundable-security" className="mt-3 rounded-xl border border-white/10 bg-white/[.015] p-3">
                  <h3 className="mb-3 text-[10px] font-medium uppercase tracking-[.12em] text-white/55">{savedCardQuoteReady?assessmentPolicy?'Refundable deposit':'Deposit & card limit':'Quote updating'}</h3>
                  {savedCardQuoteReady?<>{refundablePolicy&&<Row label="Refundable deposit today" value={currentQuote?.depositAmount??0}/>}{!assessmentPolicy&&<Row label="Later card limit · not charged" value={futureChargeLimit} muted />}<p className="mt-3 text-[10px] leading-5 text-white/55">{refundablePolicy?"Unused deposit refunded to your card; retained amounts reduce later charges.":"No deposit or card hold. The limit is not charged today."}</p></>:<><Row label="Previous policy refundable deposit" value={currentQuote?.depositAmount??0} muted/><Row label="Previous policy card authorisation" value={currentQuote?.depositHoldAmount??0} muted/><p className="mt-3 text-[10px] leading-5 text-white/55">The updated quote must remove these security amounts before payment is available.</p></>}
                </section>
              </div>
              <hr className="receipt-sep" />
              <div className="flex justify-between font-display text-xl font-bold text-white">
                <span>Total due</span>
                <span data-testid="checkout-due" className="font-mono">{currentQuote ? formatGbp(currentQuote.combinedTotalDue) : "Calculating…"}</span>
              </div>
              {!!membership && currentQuote && <p className="mt-2 text-[11px] leading-5 text-white/50">Includes the rental with credits applied, {currentQuote.membershipFee > 0 ? "your first subscription month and " : ""}any delivery charge.{!assessmentPolicy&&" The saved-card collection limit is excluded."}</p>}
            </div>
            {quoteError && <div className="mt-3 rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">{quoteError}</div>}
            {err && <div className="mt-3 rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
            {!!items.length&&!stock.needsTimes&&!stock.invalidTimeOrder&&<div className="mt-4"><CartStockNotice ready={stock.ready} checking={stock.checking} error={stock.error} onRetry={()=>void stock.recheck()}/></div>}
            {invalidTimeOrder&&<p role="status" className="mt-4 text-sm text-amber-200">Choose a return time later than pickup, or a later return date in your basket.</p>}
            {availabilityBlocked&&!stock.needsTimes&&!invalidTimeOrder&&!canRecover&&!stock.error&&!stock.checking && <p role="status" className="mt-4 text-sm text-red-300">Some gear is unavailable. <Link href="/cart" className="underline">Review your basket and switch to an available alternative</Link>.</p>}
            {unavailableItems.length>0&&!canRecover&&<section className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[.04] p-4" aria-label="Unavailable items and replacement sets">
              <h3 className="text-sm font-semibold text-amber-100">Unavailable for these rental dates</h3>
              <NextAvailableRentalOptions lineIndices={unavailableLineIndices} />
              <p className="mt-2 text-xs leading-5 text-white/55">You can shift one item to its next checked time above, or choose a checked replacement set below. The rest of your basket stays in place.</p>
              <div className="mt-3"><ReplacementSets item={unavailableItems[0]} /></div>
            </section>}
            {canRecover&&<p role="status" className="mt-3 text-sm text-white/65">This checkout has reserved your kit. Resume the same payment session.</p>}
            {!checkout.enabled && <CheckoutPauseNotice loading={checkout.loading}/>}
            <button data-testid="checkout-pay-button" onClick={pay} disabled={!checkout.enabled || !valid || busy || (availabilityBlocked&&!canRecover)} className="btn-primary mt-5 w-full py-3">
              {!checkout.enabled ? "Checkout temporarily paused" : busy ? "Redirecting…" : canRecover ? "Retry secure checkout" : "Pay with card"}
              {!busy && <IconLock className="h-4 w-4" />}
            </button>
            <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.15em] text-white/25">
              Secured by Stripe
            </p>
          </aside>
        </div>
        <BasketRecoveryStatus />
      </main>
    </>
  );
}

function Row({ label, value, muted, saving }: { label: string; value: number; muted?: boolean; saving?: boolean }) {
  return (
    <div data-secondary-charge={muted ? "true" : undefined} className={`flex justify-between gap-3 ${saving ? "text-emerald-300" : muted ? "text-[11px] text-white/40" : "text-white/60"}`}>
      <span>{label}</span>
      <span className="shrink-0 font-mono">{formatGbp(value)}</span>
    </div>
  );
}
