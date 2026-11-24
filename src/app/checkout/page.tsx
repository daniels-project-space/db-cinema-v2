"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { IconLock, IconCheck, IconArrowRight } from "@/components/icons";
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
import { useCheckoutStatus, CheckoutPauseNotice, CancellationProtectionSummary, CHECKOUT_PAUSED_MESSAGE } from "@/components/cart/CheckoutStatus";
import { CheckoutCode } from "@/components/cart/CheckoutCode";
import { usePromo } from "@/components/cart/usePromo";
import { useBasketPrice } from "@/components/cart/useBasketPrice";
import { useCartStockCheck } from "@/components/cart/useCartStockCheck";
import { CartStockNotice } from "@/components/cart/CartStockNotice";
import { useAccount } from "@/components/account/AccountProvider";
import { AvatarUpload } from "@/components/account/AvatarUpload";
import { useFreshVerification } from "@/components/account/useFreshVerification";
import { AGREEMENTS, agreementsForSecurityPolicy, COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS } from "@/lib/legal";
import { DELIVERY_TERMS_VERSION, DELIVERY_ACCEPTANCE_TEXT } from "../../../shared/rentalAgreement";
import { deliveryQuoteTerms } from "../../../shared/rentalDeliveryQuote";
import { depositFor, depositChargeFor, smallDamageHold, formatGbp, type Protection } from "@/lib/pricing";
import { browserCheckoutStorage, readCheckoutDraft, saveCheckoutDraft } from "@/lib/checkoutDraft";
import { CartItemTimes } from "@/components/cart/CartItemTimes";
import { CheckoutAccessoryOffers } from "@/components/checkout/CheckoutAccessoryOffers";
import { CHECKOUT_ACCESSORY_OFFER } from "../../../shared/checkoutAccessoryOffer";
import { NextAvailableRentalOptions } from "@/components/checkout/NextAvailableRentalOptions";
import { ReplacementSets } from "@/components/cart/ReplacementSets";
import { dayMs as ms } from "@/lib/dates";
import { checkoutStartDestination } from "@/lib/checkoutStartResult";
import { HOURS_SENTENCE } from "@/lib/site";
import { groupDeliveryItems } from "../../../shared/deliveryGroups";
import { CURRENT_PRIVACY_NOTICE_VERSION } from "../../../shared/legalVersioning";
import { RENTAL_DRAFT_RELEASE_READY } from "../../../shared/rentalAgreementRelease";

import {useCreditBalance} from "@/components/account/useCreditBalance";
import {CancellationProtection} from "@/components/cart/CancellationProtection";
import { ASSESSMENT_SECURITY_POLICY_VERSION, hasCashDepositPolicy, isCardHoldSecurityPolicy, isSetupIntentSecurityPolicy, isImmediateClaimSecurityPolicy, savedCardChargeLimit, SECURITY_POLICY_VERSION, REFUNDABLE_DEPOSIT_POLICY_VERSION, SETUP_INTENT_SECURITY_POLICY_VERSION, IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION, immediateClaimSecurityLimit, setupIntentSecurityLimit } from "../../../shared/rentalSecurity";
import styles from "./checkout.module.css";

const PC_RE = /\b(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i;
const DRAFT_TERMS = JSON.stringify({ documents: AGREEMENTS, delivery: DELIVERY_TERMS_VERSION });

function StepCard({
  n,
  title,
  sub,
  done,
  children,
  open,
  onOpen,
  onContinue,
  delay = 0,
}: {
  n: string;
  title: string;
  sub?: string;
  done?: boolean;
  children: React.ReactNode;
  open: boolean;
  onOpen: () => void;
  onContinue?: () => void;
  delay?: number;
}) {
  return (
    <section
      className={`${styles.stepCard} spot gradient-border relative min-w-0 overflow-hidden rounded-2xl p-4 sm:p-6`}
      style={{ animation: `card-in 0.55s var(--ease-out-expo) ${delay}ms both` }}
    >
      <button type="button" onClick={onOpen} aria-expanded={open} aria-controls={`checkout-step-${n}`} data-testid={`checkout-step-heading-${n}`} className="relative flex w-full items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-300">
        <span
          className={`${styles.stepNumber} ${open ? styles.stepNumberActive : ""}`}
        >
          {done && !open ? <IconCheck className="h-3.5 w-3.5" /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg font-semibold text-white/90">{title}</span>
          {open && sub && <span className="mt-1 block text-xs leading-relaxed text-white/55">{sub}</span>}
        </span>
        <svg data-testid={`checkout-step-glyph-${n}`} className={`${styles.stepGlyph} ${open ? styles.stepGlyphActive : ""}`} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle className={styles.stepGlyphOrbit} cx="16" cy="16" r="14" strokeDasharray="3 6" />
          {n === "01" ? <><circle cx="16" cy="12" r="3.4"/><path d="M9.5 23c.8-3.3 3.2-5 6.5-5s5.7 1.7 6.5 5"/></> : n === "02" ? <><path d="M8 11h11v9H8zM19 14h3l3 3v3h-6"/><circle cx="11" cy="21.5" r="1.6"/><circle cx="22" cy="21.5" r="1.6"/></> : <><path d="M10 8h12v16H10zM13 12h6M13 15h6"/><path d="m13 20 2 2 4-4"/></>}
        </svg>
        <span aria-hidden="true" className={`text-white/45 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      <div id={`checkout-step-${n}`} className="mt-4" hidden={!open}>
        {children}
        {onContinue && <button type="button" data-testid={`checkout-step-continue-${n}`} disabled={!done} onClick={onContinue} className={`${styles.continueButton} mt-5 flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-40`}>{n === "02" ? "Continue to agreements" : "Continue"} <IconArrowRight className="h-4 w-4" /></button>}
      </div>
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
  const requestAccountSetup = useAction(api.accountCodes.request);
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
  const [deliveryLegs, setDeliveryLegs] = useState<"one_way" | "round_trip">("round_trip");
  const [address, setAddress] = useState(account.me?.address ?? "");
  const [postcode, setPostcode] = useState(acctPostcode);
  const [dq, setDq] = useState<any>(null);
  const [quoting, setQuoting] = useState(false);
  const [protection, setProtection] = useState<Protection>("verify");
  const [sharedRentalTimes, setSharedRentalTimes] = useState(true);
  const [openStep, setOpenStep] = useState("01");
  const allItemTimes=!!items.length&&items.every(i=>i.pickupTime&&i.returnTime);
  const firstItemNeedingTimes=items.findIndex(i=>!i.pickupTime||!i.returnTime||(i.start===i.end&&!!i.pickupTime&&!!i.returnTime&&i.returnTime<=i.pickupTime));
  const effectivePickupTime=allItemTimes?[...items].sort((a,b)=>(a.start+" "+a.pickupTime).localeCompare(b.start+" "+b.pickupTime))[0].pickupTime!:"";
  const effectiveReturnTime=allItemTimes?[...items].sort((a,b)=>(b.end+" "+b.returnTime).localeCompare(a.end+" "+a.returnTime))[0].returnTime!:"";
  const stock=useCartStockCheck(items),availability=stock.availability;
  const commonTimeSlots=useQuery(api.availability.forCheckoutTimeSlots,items.length?{items:items.map(item=>({listingId:item.listingId as any,start:ms(item.start),end:ms(item.end),qty:1}))}:"skip");
  const invalidTimeOrder = items.some(i => i.start===i.end && !!i.pickupTime && !!i.returnTime && i.returnTime<=i.pickupTime);
  const availabilityBlocked = !!items.length && (!stock.ready || !availability || items.some(i => !availability[i.listingId]?.ok));
  const unavailableItems = items.filter(item => availability?.[item.listingId]?.ok === false);
  const unavailableLineIndices = items.flatMap((item, index) => availability?.[item.listingId]?.ok === false ? [index] : []);
  const [deliveryAgreed, setDeliveryAgreed] = useState(false);
  const [timeAdjustmentNotice, setTimeAdjustmentNotice] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState("");
  const [securityConsentContext, setSecurityConsentContext] = useState<string | null>(null);
  const agreementRequest = useRef<string | null>(null);
  const signatureLimit = useRef<number | null>(null);
  const signedContext = useRef<string | null>(null);
  const resetRentalAcceptance = () => {
    setDeliveryAgreed(false);
    setAgreed(false);
    setSignature("");
    signatureLimit.current = null;
    signedContext.current = null;
    agreementRequest.current = null;
    setRecovery(null);
  };
  const draftScope = account.loading ? null : account.me ? `account:${account.me._id}` : "guest";
  const [restoredScope, setRestoredScope] = useState<string | null>(null);
  const draftReady = !!draftScope && restoredScope === draftScope;
  const deliveryRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [accountSetupBusy, setAccountSetupBusy] = useState(false);
  const [accountSetupNotice, setAccountSetupNotice] = useState<string | null>(null);
  const [accountSetupError, setAccountSetupError] = useState<string | null>(null);
  const [setupPhoto, setSetupPhoto] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [recovery,setRecovery]=useState<{key:string;acceptance:string}|null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteRefreshRevision, setQuoteRefreshRevision] = useState(0);
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
    setDeliveryLegs(draft?.deliveryLegs ?? "round_trip");
    setAddress(draft?.address ?? profile?.address ?? "");
    setPostcode(draft?.postcode ?? profile?.address?.match(PC_RE)?.[1] ?? "");
    setProtection(draft?.protection ?? "verify");
    setUseAccountCredit(draft?.useAccountCredit??false);
    setAgreed(draft?.agreed ?? false);
    const restoredConsentContext = typeof draft?.securityConsentContext === "string" && draft.securityConsentContext.startsWith("checkout-consent-v2:")
      ? draft.securityConsentContext
      : null;
    setSecurityConsentContext(restoredConsentContext);
    setDeliveryAgreed(draft?.deliveryAgreed ?? false);
    setSignature(""); setDq(null); setQuoting(false); setRecovery(null); setQuoted(null);
    agreementRequest.current = null; membershipRequest.current = null;
    deliveryRequest.current++;
    setRestoredScope(draftScope);
  }, [draftScope]);

  useEffect(() => {
    if (!draftReady) return;
    saveCheckoutDraft(browserCheckoutStorage(), draftScope!, DRAFT_TERMS, {
      email, name, phone, billingAddress, fulfilment, deliveryLegs, address, postcode, protection,
      agreed, deliveryAgreed, useAccountCredit, securityConsentContext,
    });
  }, [draftReady, draftScope, email, name, phone, billingAddress, fulfilment, address,
    postcode, protection, agreed, deliveryAgreed, useAccountCredit, securityConsentContext, deliveryLegs]);

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
    deliveryLegs,
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
    deliveryLegs: fulfilment === "delivery" ? deliveryLegs : undefined,
    address: fulfilment === "delivery" ? address : undefined,
    deliveryPostcode: fulfilment === "delivery" ? postcode : undefined,
    promoCode: promo.applied ?? undefined,
    protection,useAccountCredit,
  };
  const reuseStarts=items.map(item=>ms(item.start));
  const reuseVerification=useQuery(api.accounts.checkoutVerification,account.token && account.me && signature.trim() && billingAddress.trim() && reuseStarts.length && reuseStarts.every(Number.isFinite)
    ? {token:account.token,name:signature,address:billingAddress,starts:reuseStarts} : "skip");
  const reuseVerificationFresh=useFreshVerification(reuseVerification?.proofExpiresAt);
  const quoteKey = JSON.stringify({ ...priceArgs, quotedDeliveryFee: deliveryQuoteCurrent ? dq.fee : null, creditReservation:creditAvailability?.available??null, policy:{setupIntent:checkoutSettings?.setupIntentSecurityEnabled,cardHold:checkoutSettings?.cardHoldSecurityEnabled,assessment:checkoutSettings?.assessmentSecurityEnabled,deposit:checkoutSettings?.refundableDepositEnabled,cancellation:checkoutSettings?.cancellationProtectionEnabled}, account: accountPricingContext(account.me), refresh:quoteRefreshRevision });
  const offerContext = membershipOfferContext({ ...priceArgs, quotedDeliveryFee: deliveryQuoteCurrent ? dq.fee : null, account: accountPricingContext(account.me) });
  const currentQuote = quoted?.key === quoteKey ? quoted.value : null;
  // Keep the last quote only as a labelled display reference while a changed
  // basket is being requoted. It never participates in payment eligibility.
  const previousSecurityQuote = currentQuote ?? quoted?.value ?? null;
  const previousDepositAmount = previousSecurityQuote?.depositAmount ?? 0;
  const previousCardHoldAmount = previousSecurityQuote?.depositHoldAmount ?? 0;
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
  // to the order invalidate the signature/attempt. Consent is bound to the
  // current quote and resets whenever its price or security terms change.
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

  const futureChargeLimit = currentQuote?.savedCardLimit ?? (checkoutSettings?.setupIntentSecurityEnabled === true ? immediateClaimSecurityLimit(equipmentValue) : checkoutSettings?.setupIntentSecurityEnabled === false ? setupIntentSecurityLimit(equipmentValue) : savedCardChargeLimit(equipmentValue));
  const refundablePolicy = hasCashDepositPolicy(currentQuote?.securityPolicyVersion);
  const assessmentPolicy=currentQuote?.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION;
  const cardHoldPolicy=isCardHoldSecurityPolicy(currentQuote?.securityPolicyVersion);
  const setupIntentPolicy=isSetupIntentSecurityPolicy(currentQuote?.securityPolicyVersion);
  const immediateClaimPolicy=isImmediateClaimSecurityPolicy(currentQuote?.securityPolicyVersion);
  const rentalAgreements = agreementsForSecurityPolicy(currentQuote?.securityPolicyVersion,currentQuote?.cancellationProtectionEnabled);
  // Immediate-claim policies share SetupIntent mechanics, but remain
  // fail-closed until their exact legal and backend versions are released.
  const releasedSetupIntentPolicy = setupIntentPolicy && [SETUP_INTENT_SECURITY_POLICY_VERSION, IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION].includes(currentQuote?.securityPolicyVersion ?? "");
  const expectedSetupIntentLimit = currentQuote?.securityPolicyVersion === IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION ? immediateClaimSecurityLimit(equipmentValue) : setupIntentSecurityLimit(equipmentValue);
  const savedCardQuoteReady = RENTAL_DRAFT_RELEASE_READY && !!currentQuote && (currentQuote.securityPolicyVersion === SECURITY_POLICY_VERSION || refundablePolicy || cardHoldPolicy || releasedSetupIntentPolicy) && Number.isFinite(currentQuote.savedCardLimit) && (cardHoldPolicy ? currentQuote.depositAmount === 0 && currentQuote.savedCardLimit === 0 && [0,50,100,200].includes(currentQuote.depositHoldAmount) : releasedSetupIntentPolicy ? currentQuote.savedCardLimit === expectedSetupIntentLimit && currentQuote.depositAmount === 0 && currentQuote.depositHoldAmount === 0 : (refundablePolicy ? [0,20,50,100].includes(currentQuote.depositAmount) : currentQuote.depositAmount === 0) && currentQuote.depositHoldAmount === 0);
  // Do not persist quoteKey here: it includes private checkout inputs such as
  // account tokens, email and delivery address. This fingerprint binds consent
  // to the current basket and legal/security terms using only non-secret data.
  const currentSecurityConsentContext = currentQuote ? `checkout-consent-v2:${JSON.stringify({
    items: items.map(item => ({ listingId:item.listingId, start:item.start, end:item.end, pickupTime:item.pickupTime ?? null, returnTime:item.returnTime ?? null, total:item.total, deposit:item.deposit, offerType:item.offerType ?? null })),
    membership: membership ? { tier:membership.tier, intro:membership.intro } : null,
    customerType: account.me ? "account" : "guest",
    fulfilment,
    deliveryLegs: fulfilment === "delivery" ? deliveryLegs : null,
    deliveryFee: deliveryQuoteCurrent ? dq.fee : null,
    deliveryAgreed: fulfilment === "delivery" && deliveryAgreed,
    due: currentQuote.combinedTotalDue,
    policy: currentQuote.securityPolicyVersion,
    limit: currentQuote.savedCardLimit,
    deposit: currentQuote.depositAmount,
    hold: currentQuote.depositHoldAmount,
    cancellationProtection: currentQuote.cancellationProtectionEnabled,
    documents: rentalAgreements.map(({ kind, version }) => ({ kind, version })),
  })}` : null;
  const securityConsentMatchesQuote = !!currentSecurityConsentContext && securityConsentContext === currentSecurityConsentContext;
  const agreedToCurrentQuote = agreed && securityConsentMatchesQuote;
  useEffect(() => {
    if (!draftReady || !currentSecurityConsentContext) return;
    if (securityConsentContext !== currentSecurityConsentContext) setAgreed(false);
    setSecurityConsentContext(currentSecurityConsentContext);
  }, [draftReady, currentSecurityConsentContext, securityConsentContext]);
  const signDone = agreedToCurrentQuote && signature.trim().length > 2 && signatureLimit.current === futureChargeLimit && signedContext.current === signingContext;

  const currentAccountTermsVersion = rentalAgreements.find(doc => doc.kind === "terms")?.version;
  const accountConsentReady = !membership || !!account.me || (!!currentAccountTermsVersion &&
    membership.accountTermsAcceptedVersion === currentAccountTermsVersion &&
    membership.privacyNoticeAcceptedVersion === CURRENT_PRIVACY_NOTICE_VERSION);
  const valid = draftReady && savedCardQuoteReady && (!account.token || !!account.me) && (!membership || membership.termsAccepted) && accountConsentReady && items.length > 0 && detailsDone && fulfilmentDone && signDone && !!currentQuote && !quoteError;

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
      const r = await getQuote({ postcode: postcode.trim(), groups: deliveryGroups.map(group => ({ ...group, listingIds: group.listingIds as any })), deliveryLegs });
      if (current()) setDq({ ...r, key });
    } catch (e: any) {
      if (current()) setDq({ ok: false, reason: e?.message ?? "Quote failed", key });
    } finally {
      if (deliveryRequest.current === request) setQuoting(false);
    }
  }, [deliveryGroups, deliveryKey, deliveryLegs, getQuote, postcode]);
  const quoteDeliveryRef = useRef(quoteDelivery);
  quoteDeliveryRef.current = quoteDelivery;
  useEffect(() => {
    if (draftReady && fulfilment === "delivery" && PC_RE.test(postcode)) void quoteDeliveryRef.current();
  }, [draftReady, fulfilment, deliveryKey]);

  const recoveryKey=JSON.stringify({priceArgs,phone,billingAddress,name,email,pickupTime:effectivePickupTime,returnTime:effectiveReturnTime,signature,agreed,deliveryAgreed,total:currentQuote?.combinedTotalDue,deliveryFee:currentQuote?.quotedDeliveryFee,membershipTermsAccepted:membership?.termsAccepted});
  const recoveryStock = useQuery(api.bookings.recoveryStock,recovery?.acceptance ? {requestId:recovery.acceptance,token:account.token??undefined}:"skip");
  const canRecover=recovery?.key===recoveryKey&&recovery.acceptance===agreementRequest.current&&recoveryStock?.ready===true;
  async function requestCheckoutAccountSetup() {
    if (account.me || accountSetupBusy) return;
    setAccountSetupBusy(true);
    setAccountSetupNotice(null);
    setAccountSetupError(null);
    try {
      const result = await requestAccountSetup({ email, name, phone, purpose: "setup" });
      setAccountSetupNotice("If this address is eligible, a secure setup email is on its way. Verify your email, choose a password and accept the current Terms and Privacy Notice to finish creating your account.");
      if (setupPhoto) {
        await stageCheckoutPhoto(result.challenge, setupPhoto);
        setAccountSetupNotice("If this address is eligible, a secure setup email is on its way. If your photo arrives before verification, you can review it and choose whether to use it.");
      }
    } catch (error) {
      setAccountSetupError(error instanceof Error ? error.message : "We could not request account setup. Please try again.");
    } finally {
      setAccountSetupBusy(false);
    }
  }
  async function stageCheckoutPhoto(challenge: string, photo: File) {
    const origin=process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud",".convex.site");
    if(!origin)throw Error("The setup email may be on its way, but the photo could not be prepared. You can add it in Account settings.");
    try {
      const response=await fetch(`${origin}/signup-avatar`,{method:"POST",headers:{Authorization:`Bearer ${challenge}`,"Content-Type":photo.type},body:photo});
      if(!response.ok)throw Error("Photo upload failed.");
    } catch {
      throw Error("The setup email may be on its way, but the photo could not be prepared. Add it later in Account settings.");
    }
  }
  async function pay() {
    if (!checkout.enabled) { setErr(CHECKOUT_PAUSED_MESSAGE); return; }
    if (availabilityBlocked&&!canRecover) { setErr("Review your basket and choose available alternatives before checkout."); return; }
    if (membership && !account.me && !accountConsentReady) { setErr("Accept the rental Terms and Privacy Notice above once to set up your membership account."); return; }
    if (!valid) return;
    setBusy(true);
    setErr(null);
    track({ type: "checkout_start", sessionId: getSessionId() }).catch(() => {});
    const acceptanceAttempt = agreementRequest.current ?? (agreementRequest.current = crypto.randomUUID());
    const membershipAttempt = membership ? membershipRequest.current ?? (membershipRequest.current = crypto.randomUUID()) : null;
    try {
      const docs: { kind: string; version: string }[] = rentalAgreements.map((d) => ({ kind: d.kind, version: d.version }));
      if (fulfilment === "delivery") docs.push({ kind: "delivery-disclaimer", version: DELIVERY_TERMS_VERSION });
      const result = await start({
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
        deliveryLegs: fulfilment === "delivery" ? deliveryLegs : undefined,
        deliveryPostcode: fulfilment === "delivery" ? postcode : undefined,
        deliveryFee: currentQuote!.quotedDeliveryFee,
        expectedTotalDue: currentQuote!.combinedTotalDue,
        expectedSavedCardLimit:futureChargeLimit,
        selectedMembership: membership ? {
          tier:membership.tier,intro:membership.intro,termsVersion:MEMBERSHIP_TERMS_VERSION,requestId:membershipAttempt!,
          accountTermsPrivacyAcknowledged: membership.accountTermsAcceptedVersion === currentAccountTermsVersion && membership.privacyNoticeAcceptedVersion === CURRENT_PRIVACY_NOTICE_VERSION,
          accountTermsVersion: membership.accountTermsAcceptedVersion,
          privacyNoticeVersion: membership.privacyNoticeAcceptedVersion,
        } : undefined,
        promoCode: promo.applied ?? undefined,
        protection,useAccountCredit,
        pickupTime:effectivePickupTime,
        returnTime:effectiveReturnTime,
        agreement: { name: signature.trim(), requestId: acceptanceAttempt, securityHoldConsent: agreed, laterChargeConsent: cardHoldPolicy ? false : agreed, deliveryAccepted: deliveryAgreed, documents: docs },
      });
      await Promise.race([track({type:"payment_redirect",sessionId:getSessionId()}).catch(()=>{}),new Promise(resolve=>setTimeout(resolve,400))]);
      window.location.href = checkoutStartDestination(result);
    } catch (e: any) {
      void track({type:"checkout_failure",sessionId:getSessionId()}).catch(()=>{});
      if (e?.data?.code === "CHECKOUT_MEMBERSHIP_SESSION_RETIRED" && e?.data?.freshAcceptanceRequired === false && agreementRequest.current === acceptanceAttempt) {
        if (membershipRequest.current === membershipAttempt) membershipRequest.current = null;
        setRecovery(null);
      } else if (e?.data?.freshAcceptanceRequired === true && ["CHECKOUT_STOCK_REJECTED","CHECKOUT_TERMS_CHANGED","CHECKOUT_CLOSED"].includes(e?.data?.code) && agreementRequest.current === acceptanceAttempt) {
        setOpenStep(e.data.code === "CHECKOUT_STOCK_REJECTED" ? "02" : "03");
        agreementRequest.current = null;
        if (membershipRequest.current === membershipAttempt) membershipRequest.current = null;
        setAgreed(false);
        setSignature("");
        setRecovery(null);
        setQuoted(null);
        setQuoteRefreshRevision(revision=>revision+1);
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
  const checkoutLegalVersion = rentalAgreements.find(document => document.kind === "cancellation")?.version ?? "";

  return (
    <>
      <SiteHeader />
      <CheckoutLoopBanner />
      <main className="section-window mx-auto min-w-0 max-w-5xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8">
        <CheckoutCode benefitKind={currentQuote?.benefitKind}/>
        {(currentQuote?.cancellationProtectionEnabled || (currentQuote && (COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS as readonly string[]).includes(checkoutLegalVersion)))&&<div className="mb-4"><CancellationProtection version={checkoutLegalVersion} showV16RenterPolicy={Boolean(assessmentPolicy&&currentQuote?.cancellationProtectionEnabled)}/></div>}
        <CheckoutMembership variant="checkout" loading={rentalPreview.loading && !quoteError} appliedSavings={membershipDisplayQuote ?? undefined} suggestions={displayedRecommendations} selected={membership} onChange={value=>{setMembership(value); membershipRequest.current=null;}} />
        <div className="mt-8 grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="flex flex-col gap-5">
            {/* 01 — details */}
            <StepCard n="01" title="Your details" done={detailsDone} open={openStep === "01"} onOpen={() => setOpenStep("01")} onContinue={() => setOpenStep("02")} delay={0}>
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
                  <p className="mt-1 text-[11px] text-white/40">Used on your rental statement. If needed, you will submit proof of address through the verification provider.</p>
                  {!account.me && !account.loading && <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
                    <p className="text-xs leading-relaxed text-white/55">Want an account? Use the details above. We’ll only create it after you verify your email, choose a password and accept the current terms.</p>
                    <div data-testid="checkout-profile-photo-after-account" className="mt-3 text-xs leading-relaxed text-white/55">
                      <label htmlFor="co-setup-photo" className="block font-medium text-white/80">Profile photo · optional</label>
                      <p className="mt-1">After email verification, review the photo and choose whether to use it. We never use a verification selfie.</p>
                      <input id="co-setup-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={accountSetupBusy} className="mt-2 block w-full text-xs text-white/60 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-white" onChange={event=>{const file=event.target.files?.[0];setAccountSetupError(null);if(file&&(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>5*1024*1024)){setSetupPhoto(null);event.target.value="";setAccountSetupError("Choose a JPEG, PNG or WebP photo under 5 MB.");return;}setSetupPhoto(file??null);}}/>
                      <p className="mt-2 text-white/40">The photo is prepared with the setup email; it is not saved to an account until you confirm it.</p>
                    </div>
                    <button type="button" onClick={() => void requestCheckoutAccountSetup()} disabled={accountSetupBusy || !email.trim() || !name.trim() || !phone.trim()} className="btn-secondary mt-3 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45">
                      {accountSetupBusy ? "Sending secure setup email…" : "Email me a secure setup link"}
                    </button>
                    {!phone.trim() && <p className="mt-2 text-[11px] text-white/40">Add a phone number above to request setup.</p>}
                    {accountSetupNotice && <p role="status" className="mt-2 text-xs leading-relaxed text-emerald-200/85">{accountSetupNotice}</p>}
                    {accountSetupError && <p role="alert" className="mt-2 text-xs leading-relaxed text-red-300">{accountSetupError}</p>}
                  </div>}
                </div>
                <section aria-labelledby="co-delivery-preview-heading" className="rounded-xl border border-accent-300/15 bg-accent-300/[.035] p-3 sm:p-4">
                  <h3 id="co-delivery-preview-heading" className="text-sm font-medium text-white/90">Explore delivery</h3>
                  <p className="mt-1 text-xs leading-relaxed text-white/55">See the delivery options for your kit and dates.</p>
                  <div className="mt-3 flex gap-2">
                    <label htmlFor="co-preview-postcode" className="sr-only">Postcode for delivery estimate</label>
                    <input id="co-preview-postcode" value={postcode} onChange={event => { setPostcode(event.target.value); setDq(null); resetRentalAcceptance(); }} autoComplete="postal-code" placeholder="Delivery postcode" className="input min-w-0 flex-1 uppercase placeholder:normal-case" />
                    <button type="button" onClick={() => void quoteDelivery()} disabled={quoting || !PC_RE.test(postcode)} className="btn-secondary shrink-0 px-3 py-2 text-xs disabled:opacity-40">{quoting ? "Checking…" : "See prices"}</button>
                  </div>
                  {dq && dq.key === deliveryKey && (dq.ok && dq.groups.every((group: {oneWayFee?:number;roundTripFee?:number}) => Number.isSafeInteger(group.oneWayFee) && Number.isSafeInteger(group.roundTripFee)) ? <div className="mt-3" data-testid="checkout-delivery-preview" aria-live="polite">
                    <div className="grid grid-cols-2 gap-2">
                      {([['one_way', 'One way', 'oneWayFee'], ['round_trip', 'Delivery & collection', 'roundTripFee']] as const).map(([legs, label, field]) => <button type="button" key={legs} onClick={() => { resetRentalAcceptance(); setDeliveryLegs(legs); setFulfilment('delivery'); setOpenStep('02'); }} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-left transition hover:border-accent-300/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-300"><span className="block text-xs text-white/65">{label}</span><strong className="mt-1 block text-sm text-accent-200">{formatGbp(dq.groups.reduce((total: number, group: Record<string, number>) => total + group[field], 0))}</strong></button>)}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-white/45">Estimate before any eligible member savings. Confirm your address and terms in the next step.</p>
                  </div> : !dq.ok ? <p role="status" className="mt-2 text-xs text-amber-200">{dq.reason}</p> : null)}
                </section>
                {account.token && account.me ? (
                  <div data-testid="checkout-profile-photo" className="rounded-xl border border-white/10 bg-white/[.025] p-3 sm:p-4">
                    <p className="hud-label mb-2">Profile photo <span className="text-white/40">· optional</span></p>
                    <p className="mb-3 max-w-prose text-xs leading-relaxed text-white/55">Choose your own photo for your renter account and chat. It is never taken from verification; public reviews show it only if you opt in.</p>
                    <AvatarUpload />
                  </div>
                ) : null}
              </div>
            </StepCard>


            {/* 02 — fulfilment */}
            <StepCard
              n="02"
              title="Fulfilment"
              sub={`Pickup, return & delivery windows: ${HOURS_SENTENCE}.`}
              done={fulfilmentDone}
              open={openStep === "02"}
              onOpen={() => setOpenStep("02")}
              onContinue={() => setOpenStep("03")}
              delay={70}
            >
              <div className="flex flex-col gap-2.5">
                {(
                  [
                    ["pickup", "Pick up in Trafalgar Square", "Collect and return at our location"],
                    ["delivery", "Delivery", "Quoted by distance"],
                  ] as const
                ).map(([f, t, d]) => (
                  <button
                    key={f}
                    onClick={() => setFulfilment(f)}
                    aria-label={f === "pickup" ? "Pick up in Trafalgar Square" : "Delivery, quoted by distance"}
                    aria-pressed={fulfilment === f}
                    data-testid={`fulfilment-${f}`}
                    className={`${styles.fulfilmentChoice} flex min-w-0 items-center gap-3 rounded-xl p-3.5 text-left sm:gap-5 sm:p-4`}
                  >
                    <span className={styles.choiceRadio} aria-hidden="true" />
                    <span data-testid={`fulfilment-glyph-${f}`} className={styles.fulfilmentGlyph} aria-hidden="true">{f === "pickup" ? <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16 28s9-9.6 9-16a9 9 0 0 0-18 0c0 6.4 9 16 9 16Z"/><circle cx="16" cy="12" r="3"/></svg> : <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h16v13H4M20 13h4l4 4v5h-8M2 13h7M2 17h5"/><circle cx="9" cy="23" r="2.5"/><circle cx="24" cy="23" r="2.5"/></svg>}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white/90 sm:text-base">{t}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-white/55">{d}</span>
                    </span>
                  </button>
                ))}
              </div>
              {fulfilment === "delivery" && (
                <div className="mt-5 flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-white/90">Choose a delivery option</h3>
                  <div role="group" aria-label="Delivery option" className="grid grid-cols-2 gap-2.5">
                    {([
                      ["one_way", "One way", "Return in Trafalgar Square"],
                      ["round_trip", "Delivery + collection", "Courier both ways"],
                    ] as const).map(([legs, title, detail]) => (
                      <button
                        key={legs}
                        type="button"
                        aria-pressed={deliveryLegs === legs}
                        data-testid={`delivery-legs-${legs}`}
                        onClick={() => {
                          if (deliveryLegs === legs) return;
                          setDeliveryLegs(legs);
                          setDq(null);
                          resetRentalAcceptance();
                        }}
                        className={`${styles.deliveryLeg} flex min-w-0 items-start gap-2.5 rounded-xl p-3 text-left sm:p-4`}
                      >
                        <span className={styles.choiceRadio} aria-hidden="true" />
                        <span className="min-w-0"><span className="block text-[13px] font-semibold leading-snug text-white/90 sm:text-sm">{title}</span>
                        {dq?.ok && dq.key === deliveryKey && dq.groups.every((group: {oneWayFee?:number;roundTripFee?:number}) => Number.isSafeInteger(group.oneWayFee) && Number.isSafeInteger(group.roundTripFee)) && <strong className="mt-1 block text-sm text-white">{formatGbp(dq.groups.reduce((total: number, group: {oneWayFee:number;roundTripFee:number}) => total + (legs === "one_way" ? group.oneWayFee : group.roundTripFee), 0))}</strong>}
                        <span className="mt-1 block text-[11px] leading-relaxed text-white/50">{detail}</span></span>
                      </button>
                    ))}
                  </div>
                  <section aria-labelledby="co-delivery-postcode-heading" className="pt-1">
                    <h3 id="co-delivery-postcode-heading" className="mb-2 text-xs font-medium text-white/75">Delivery postcode *</h3>
                    <div className="flex gap-2">
                      <label htmlFor="co-delivery-postcode" className="sr-only">Delivery postcode *</label>
                      <input
                        id="co-delivery-postcode"
                        value={postcode}
                        onChange={(e) => { setPostcode(e.target.value); setDq(null); resetRentalAcceptance(); }}
                        type="text"
                        autoComplete="postal-code"
                        required
                        aria-required="true"
                        aria-invalid={postcode.trim().length > 0 && !PC_RE.test(postcode)}
                        placeholder="e.g. SW1A 1AA"
                        className="input min-w-0 flex-1 font-mono uppercase placeholder:normal-case placeholder:font-sans"
                      />
                      <button type="button" onClick={() => void quoteDelivery()} disabled={quoting || !PC_RE.test(postcode)} className={`${styles.continueButton} shrink-0 px-4 text-sm disabled:opacity-40`}>
                        {quoting ? "…" : "Get quote"}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-white/45">One postcode covers every rental period. Each period is priced separately.</p>
                  </section>
                  {dq && dq.key === deliveryKey && (dq.ok ? (
                    <div className={`${styles.deliveryQuote} flex gap-3 rounded-xl px-3 py-3 text-xs text-white/75`}>
                      <svg aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-[#e9bd91]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M7.5 3v4M16.5 3v4M3.5 9.5h17M8 14h3M8 17h6"/></svg>
                      <div className="min-w-0 flex-1 space-y-1">
                        {dq.groups.map((group: {start:number;end:number;fee:number;vehicleLabel:string;km:number}, index:number) => <div key={`${group.start}-${group.end}-${index}`} className="flex flex-wrap justify-between gap-x-3">
                          <span>{deliveryPeriodLabel(group.start, group.end)} · {group.vehicleLabel} · ~{group.km}km</span>
                          <span className="font-semibold">£{group.fee} · {deliveryLegs === "one_way" ? "one way" : "return"}</span>
                        </div>)}
                        <div className="border-t border-white/10 pt-2 font-semibold text-white">{deliveryLegs === "one_way" ? "One-way delivery total" : "Total delivery & collection"} · £{dq.fee}</div>
                        <span className="text-white/45">Before any eligible member saving.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">{dq.reason}</div>
                  ))}
                  <textarea value={address} onChange={(e) => { setAddress(e.target.value); resetRentalAcceptance(); }} placeholder="Full delivery address, including postcode *" rows={2} className="input w-full" />
                  {address.trim().length > 0 && deliveryAddressPostcode !== quotedPostcode &&
                    <p className="text-xs text-amber-200">Include the same postcode in your delivery address as the quote above.</p>}
                  <details className="text-xs leading-relaxed text-white/55"><summary className="cursor-pointer text-white/75">Delivery details</summary><p className="mt-2">{deliveryQuoteTerms(DELIVERY_ACCEPTANCE_TEXT, deliveryLegs)}</p></details>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-white/85">
                    <label className="flex cursor-pointer items-center gap-2.5"><input data-testid="checkout-delivery-terms" type="checkbox" checked={deliveryAgreed} onChange={(e) => setDeliveryAgreed(e.target.checked)} className="h-4 w-4 accent-accent-500" />I accept the</label>
                    <Link href={`/legal/delivery-disclaimer?version=${encodeURIComponent(DELIVERY_TERMS_VERSION)}`} target="_blank" rel="noopener noreferrer" className="font-medium text-[#edc7a1] underline underline-offset-4">delivery terms</Link>.
                  </div>
                </div>
              )}

              {/* times (both pickup & delivery) */}
              {items.length>1&&<label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-white/10 bg-white/[.025] px-3 py-2 text-xs text-white/75">
                <input type="checkbox" checked={sharedRentalTimes} onChange={event=>setSharedRentalTimes(event.target.checked)} className="accent-accent-500" />
                <span><span className="block font-medium text-white/85">Use one time for the whole kit</span><span className="text-[11px] text-white/45">Choose pickup and return once for every item.</span></span>
              </label>}
              <div className="mt-3 divide-y divide-white/10">{items.map((item,index)=><CartItemTimes key={`${item.listingId}|${item.start}|${index}`} item={item} delivery={fulfilment==="delivery"} initiallyExpanded={index===firstItemNeedingTimes} onNotice={setTimeAdjustmentNotice} useSharedTimes={sharedRentalTimes} commonSlots={commonTimeSlots}/>)}</div>
              {timeAdjustmentNotice && <p role="status" aria-live="polite" className="mt-2 rounded-lg border border-emerald-300/20 bg-emerald-300/[.05] px-3 py-2 text-xs leading-relaxed text-emerald-200">{timeAdjustmentNotice}</p>}
            </StepCard>

            <StepCard n="03" title="Agreements & signature" done={signDone} open={openStep === "03"} onOpen={() => setOpenStep("03")} delay={140}>
              <div data-testid="rental-consent" className="rounded-xl border border-white/10 bg-black/10 p-4">
                <nav aria-label="Rental agreements" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-accent-300">
                  {rentalAgreements.map(d=><a key={d.kind} href={`/legal/${d.kind}?version=${encodeURIComponent(d.version)}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{d.title}</a>)}
                </nav>
                <label className="mt-4 flex items-start gap-2.5 text-sm leading-6 text-white/80">
                  <input data-testid="rental-agreement-checkbox" type="checkbox" checked={agreedToCurrentQuote} disabled={!savedCardQuoteReady||!currentQuote||!securityConsentMatchesQuote} onChange={e=>{const accepted=e.target.checked;setAgreed(accepted);agreementRequest.current=null;if(membership&&!account.me)setMembership({...membership,accountTermsAcceptedVersion:accepted?currentAccountTermsVersion:undefined,privacyNoticeAcceptedVersion:accepted?CURRENT_PRIVACY_NOTICE_VERSION:undefined});}} className="mt-1 accent-accent-500 disabled:opacity-40"/>
                  <span data-testid="saved-card-consent-text">{!savedCardQuoteReady?"I agree to the linked rental documents and Privacy Notice. Security terms are updating; checkout stays disabled until the current quote is ready.":setupIntentPolicy?`I agree to the linked rental terms and Privacy Notice${membership && !account.me ? ", including the current account Terms and Privacy Notice for membership setup" : ""}. I permit evidenced post-return claims up to ${formatGbp(futureChargeLimit)}. No funds are held upfront.`:cardHoldPolicy?`I agree to the linked rental terms${membership && !account.me ? ", including the current account Terms and Privacy Notice for membership setup" : ""} and a temporary card hold. This does not authorize later charges.`:`I have read the linked rental documents and Privacy Notice${membership && !account.me ? ", including the current account Terms and Privacy Notice for membership setup" : ""}, and agree to them and authorize my card for future damage, loss and late-fee payments.`}</span>
                </label>
                {savedCardQuoteReady && setupIntentPolicy && <details data-testid="claim-consent-details" className={`${styles.agreementDetail} group ml-7 mt-2 rounded-lg border border-white/10 bg-white/[.025] px-3 py-2 text-xs text-white/55`}>
                  <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-3 text-accent-300 [&::-webkit-details-marker]:hidden"><span className="inline-flex min-w-0 items-center gap-2"><svg data-testid="claim-consent-glyph" className={styles.detailGlyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true"><circle className={styles.glyphOrbit} cx="12" cy="12" r="10" strokeDasharray="4 6"/><path d="M8 6.5h8v11l-4-2.2-4 2.2v-11Z"/><path className={styles.glyphMark} d="M10 10h4M10 12.8h4" strokeLinecap="round"/></svg><span>Claim timing & details</span></span><svg data-testid="agreement-disclosure-chevron" className="h-4 w-4 shrink-0 transition-transform duration-300 ease-out group-open:rotate-180 motion-reduce:transition-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg></summary>
                  <p className="mt-2 leading-relaxed">{immediateClaimPolicy?"DB may choose whether and how much to claim for an evidenced amount actually due. Before one card attempt, we send a final itemised invoice with the damage or repair/replacement description, calculation and evidence.":"An itemised notice and seven-day query period apply before collection."} Insurance is separate.</p>
                </details>}
                {cardHoldPolicy && <details data-testid="hold-return-details" className={`${styles.agreementDetail} group ml-7 mt-2 rounded-lg border border-white/10 bg-white/[.025] px-3 py-2 text-xs text-white/55`}>
                  <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-3 text-accent-300 [&::-webkit-details-marker]:hidden"><span className="inline-flex min-w-0 items-center gap-2"><svg data-testid="hold-return-glyph" className={styles.detailGlyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true"><circle className={styles.glyphOrbit} cx="12" cy="12" r="10" strokeDasharray="4 6"/><path d="M12 3.7 18.5 6v5.1c0 4.2-2.7 7.3-6.5 9.2-3.8-1.9-6.5-5-6.5-9.2V6L12 3.7Z"/><path className={styles.glyphMark} d="m9.3 12 1.8 1.8 3.8-4" strokeLinecap="round" strokeLinejoin="round"/></svg><span>Hold & return details</span></span><svg data-testid="agreement-disclosure-chevron" className="h-4 w-4 shrink-0 transition-transform duration-300 ease-out group-open:rotate-180 motion-reduce:transition-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg></summary>
                  <p className="mt-2 leading-relaxed">The temporary card authorisation follows the linked return process. This checkbox does not authorise later off-session charges.</p>
                </details>}
              </div>
              <div className="mt-4">
                <label className={label} htmlFor="co-sig">Sign by typing your full name *</label>
                <input
                  id="co-sig"
                  value={signature}
                  disabled={!draftReady || !savedCardQuoteReady || !currentQuote || busy}
                  onChange={(e) => { signatureLimit.current = futureChargeLimit; signedContext.current = signingContext; setSignature(e.target.value); }}
                  placeholder="Your signature"
                  className="input serif-accent w-full border-b-2 border-b-accent-400/30 !text-xl text-white/90 placeholder:font-sans placeholder:text-sm"
                />
                {reuseVerification && reuseVerificationFresh && <p role="status" className="mt-2 text-xs text-emerald-300">Previously verified · eligible for reuse until {new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeZone:"Europe/London"}).format(new Date(reuseVerification.expiresAt))}. Other handover checks still apply.</p>}
              </div>
            </StepCard>
          </div>

          {/* summary */}
          <aside data-testid="checkout-summary" className="ticket spot gradient-border h-fit min-w-0 rounded-2xl p-5 lg:sticky! lg:top-24">
            <div className="hud-label !text-accent-400/90">Order summary</div>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              {items.map((i, index) => (
                <div key={i.key} className="flex justify-between text-white/55">
                  <span className="mr-2 line-clamp-1">
                    {currentQuote?.items[index]?.title ?? i.title}
                    {i.offerType === CHECKOUT_ACCESSORY_OFFER ? <span className="ml-1 text-[10px] text-emerald-200/75">· accessory offer</span> : i.offerType ? " (offer)" : ""}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1.5 font-mono">
                    {currentQuote?.items[index]?.accessoryOffer && <span className="text-[10px] text-white/35 line-through">{formatGbp(currentQuote.items[index].accessoryOffer.originalTotal)}</span>}
                    <span>{formatGbp(currentQuote?.items[index]?.total ?? i.total)}</span>
                  </span>
                </div>
              ))}
            </div>
            <CheckoutAccessoryOffers items={items} />
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
              {!!currentQuote?.sameDayFee && <Row label="Same-day booking fee · 10%" value={currentQuote.sameDayFee} />}
              {(creditAvailability?.available??0)>0&&(currentQuote?.availableAccountCredit??0)>0&&<label className="mb-4 block rounded-xl border border-emerald-300/20 bg-emerald-300/[.04] p-3 text-xs leading-5 text-white/75"><span className="flex items-center gap-2"><input data-testid="checkout-use-credit" type="checkbox" checked={useAccountCredit} disabled={busy} onChange={e=>{setUseAccountCredit(e.target.checked);if(e.target.checked)window.dispatchEvent(new CustomEvent("dbc:credit:selected",{detail:{accountId:account.me?._id}}));}}/>Use account credit · {formatGbp(currentQuote!.availableAccountCredit)} available</span><span className="mt-1 block text-[10px] text-white/50">Credit pays the eligible balance after discounts. Existing expiry dates apply; credit cannot pay membership fees or separately quoted security amounts. Credit cannot be withdrawn as cash, subject to statutory rights.</span></label>}
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
                <section data-testid="refundable-security" data-quote-current={currentQuote ? "true" : "false"} className="mt-3 rounded-xl border border-white/10 bg-white/[.015] p-3">
                  <h3 className="mb-3 text-[10px] font-medium uppercase tracking-[.12em] text-white/55">{savedCardQuoteReady?setupIntentPolicy?'Saved card':cardHoldPolicy?'Card authorisation hold':assessmentPolicy?'Refundable deposit':'Deposit & card limit':'Quote updating'}</h3>
                  {savedCardQuoteReady?cardHoldPolicy?<><Row label={currentQuote?.depositHoldAmount?"Temporary card hold":"Card hold"} value={currentQuote?.depositHoldAmount??0} muted/><p className="mt-3 text-xs leading-relaxed text-white/55">{currentQuote?.depositHoldAmount?"Not a payment or part of your total. It may reduce available balance. If pickup is over a week away, we request a replacement five hours before pickup and release the old hold only after the new hold succeeds.":"No hold is due because this account meets the agreed exemption criteria."} An issue-free return releases the hold automatically; any claim needs a recorded reason.</p></>:setupIntentPolicy?<p data-testid="saved-card-security-summary" className="text-xs leading-relaxed text-white/55">No upfront charge. Later claims follow the rental terms below.</p>:<>{refundablePolicy&&<Row label="Refundable deposit today" value={currentQuote?.depositAmount??0}/>}{!assessmentPolicy&&<Row label="Later card limit · not charged" value={futureChargeLimit} muted />}<p className="mt-3 text-[10px] leading-5 text-white/55">{refundablePolicy?"Unused deposit refunded to your card; retained amounts reduce later charges.":"No deposit or card hold. The limit is not charged today."}</p></>:<>{previousDepositAmount>0&&<Row label="Previous refundable deposit" value={previousDepositAmount} muted/>}{previousCardHoldAmount>0&&<Row label="Previous card authorisation" value={previousCardHoldAmount} muted/>}<p data-testid="checkout-security-quote-status" className="mt-3 text-[10px] leading-5 text-white/55">{previousSecurityQuote?"Security terms are updating. Payment stays disabled until the new quote is ready.":"Calculating security terms. Payment stays disabled until the quote is ready."}</p></>}
                </section>
              </div>
              <hr className="receipt-sep" />
              <CancellationProtectionSummary enabled={Boolean(currentQuote?.cancellationProtectionEnabled || (currentQuote && (COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS as readonly string[]).includes(checkoutLegalVersion)))} version={checkoutLegalVersion} testId="checkout-free-cancellation" />
              <div className="flex justify-between font-display text-xl font-bold text-white">
                <span>Total due</span>
                <span data-testid="checkout-due" className="font-mono">{currentQuote ? formatGbp(currentQuote.combinedTotalDue) : "Calculating…"}</span>
              </div>
              {!!membership && currentQuote && <p className="mt-2 text-[11px] leading-5 text-white/50">Includes the rental with credits applied, {currentQuote.membershipFee > 0 ? "your first subscription month and " : ""}any delivery charge.</p>}
            </div>
            {quoteError && <div role="alert" className="mt-3 rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">{quoteError}</div>}
            {err && <div role="alert" className="mt-3 rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
            {!!items.length&&!stock.needsTimes&&!stock.invalidTimeOrder&&<div className="mt-4"><CartStockNotice ready={stock.ready} checking={stock.checking} error={stock.error} onRetry={()=>void stock.recheck()}/></div>}
            {(quoteError || err || stock.error) && <p className="mt-3 text-xs text-white/70">Need help? <Link href={account.token ? "/account?conversation=general#chat" : "/contact"} className="underline underline-offset-4">{account.token ? "Open your chat with the team" : "Contact the team"}</Link>.</p>}
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
