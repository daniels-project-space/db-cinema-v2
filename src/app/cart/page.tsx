"use client";

import Link from "next/link";
import { useCheckoutStatus, CheckoutPauseNotice } from "@/components/cart/CheckoutStatus";
import { Fragment } from "react";
import { ReplacementSets } from "@/components/cart/ReplacementSets";
import { useCartStockCheck } from "@/components/cart/useCartStockCheck";
import { CartStockNotice } from "@/components/cart/CartStockNotice";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { GearLoopBanner } from "@/components/GearLoopBanner";
import { CartPlanning } from "@/components/plans/CartPlanning";
import { KitCompatibility } from "@/components/cart/KitCompatibility";
import { useCart } from "@/components/cart/CartProvider";
import { usePromo } from "@/components/cart/usePromo";
import { Recommendations } from "@/components/Recommendations";
import { formatGbp } from "@/lib/pricing";
import { CheckoutMembership } from "@/components/CheckoutMembership";
import { useBasketPrice } from "@/components/cart/useBasketPrice";
import { CartItemDates } from "@/components/cart/CartItemDates";
import { CheckoutReminderNotice } from "@/components/cart/CheckoutReminderNotice";
import { IconX, IconArrowRight, IconLock } from "@/components/icons";


export default function CartPage() {
  const {
    items,
    remove,
    duplicateItem,
    clear,
    subtotal,
    eligibleSubtotal,
    membership,
    setMembership,
  } = useCart();
  const { quote, recommendations, error: quoteError, loading } = useBasketPrice();
  const promo = usePromo(eligibleSubtotal);
  const checkout = useCheckoutStatus();

  const stock=useCartStockCheck(items),avail=stock.availability,router=useRouter();
  const blocked = !!items.length && (!stock.ready || !avail || items.some(i => !avail[i.listingId]?.ok));
  async function continueCheckout(){
    if (!checkout.enabled) return;
    const receipt=await stock.recheck();
    if(receipt&&items.every(i=>receipt.availability[i.listingId]?.ok))router.push("/checkout");
  }

  const first = items[0];

  return (
    <>
      <SiteHeader />
      <GearLoopBanner
        eyebrow="Your kit"
        lead="Review &"
        accent="checkout"
        sub="Check your dates and gear, then book securely."
      />
      <main className="section-window mx-auto max-w-5xl px-6 pb-12 pt-8">
        {items.length === 0 ? (
          <div className="mt-16 text-center">
            <div className="hud-label">Empty slate</div>
            <p className="mt-3 text-white/40">Your kit is empty.</p>
            <Link href="/gear" className="btn-primary mt-6 px-7 py-3">
              Browse gear
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <>
            <CartStockNotice checking={stock.checking} error={stock.error} onRetry={()=>void stock.recheck()}/>
            <CheckoutReminderNotice className="mb-4" />
            <CheckoutMembership
              compact
              loading={loading}
              suggestions={recommendations}
              appliedSavings={quote ?? undefined}
              selected={membership}
              onChange={setMembership}
            />
            <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
              <div className="flex min-w-0 flex-col gap-3">
                {items.map((it, idx) => {
                  const a = avail?.[it.listingId];
                  const unavailable = a && a.available === 0;
                  const over = a && !a.ok && a.available > 0;
                  const dim = unavailable || over;
                  return (
                    <Fragment key={it.key}>
                    <div
                      className={`spot grid grid-cols-[64px_minmax(0,1fr)_auto] gap-x-3 rounded-2xl p-4 sm:grid-cols-[80px_minmax(0,1fr)_auto] ${dim ? "opacity-50 ring-1 ring-rec-500/40" : ""}`}
                      style={{
                        animation: `card-in 0.5s var(--ease-out-expo) ${idx * 60}ms both`,
                      }}
                    >
                      <Link
                        href={`/gear/${it.slug}`}
                        className="block h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-charcoal-800 sm:h-20 sm:w-20"
                      >
                        {it.heroImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={it.heroImage}
                            alt={it.title}
                            className={`h-full w-full object-cover transition-transform duration-500 hover:scale-105 ${dim ? "grayscale" : ""}`}
                          />
                        ) : null}
                      </Link>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/gear/${it.slug}`}
                          className="text-white/85 transition-colors hover:text-white"
                        >
                          {it.title}
                        </Link>
                        <div className="mt-1.5 font-mono text-xs text-white/40">
                          {it.start} → {it.end} · {it.days}d
                        </div>
                        {unavailable ? (
                          <div className="mt-1.5 text-xs text-red-300">
                            Unavailable for your selected dates — choose an alternative below
                          </div>
                        ) : over ? (
                          <div className="mt-1.5 text-xs text-red-300">
                            Only {a.available} available for these dates (you
                            have {a.demanded})
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end justify-between">
                        <div className="font-display text-lg font-bold text-accent-400">
                          {formatGbp(quote?.items[idx]?.total ?? it.total)}
                        </div>
                        <button
                          onClick={() => remove(it.key)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/5 hover:text-rec-500"
                          aria-label={`Remove ${it.title}`}
                        >
                          <IconX className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="col-span-3"><CartItemDates item={it} /><button type="button" onClick={() => duplicateItem(it.key)} className="mt-2 text-xs text-white/60 hover:text-white">+ Add another of this item</button></div>
                    </div>
                    {dim && <ReplacementSets item={it} />}
                    </Fragment>
                  );
                })}
              </div>

              <aside data-testid="basket-summary" className="ticket spot gradient-border h-fit rounded-2xl p-5 lg:sticky! lg:top-24">
                <div className="hud-label !text-accent-400/90">Summary</div>

                {/* promo */}
                <div className="mt-4">
                  <div className="flex gap-2">
                    <input
                      value={promo.draft}
                      onChange={(e) => promo.setDraft(e.target.value)}
                      placeholder="Promo or referral code"
                      className="input min-w-0 flex-1 font-mono uppercase placeholder:normal-case placeholder:font-sans"
                    />
                    {promo.applied ? (
                      <button
                        onClick={promo.remove}
                        className="btn-ghost px-3 text-xs"
                      >
                        remove
                      </button>
                    ) : (
                      <button
                        onClick={promo.apply}
                        disabled={!quote}
                        className="btn-primary px-4 text-sm"
                      >
                        apply
                      </button>
                    )}
                  </div>
                  {promo.applied && promo.status && !promo.status.valid && (
                    <div className="mt-1.5 text-xs text-red-300">
                      {(promo.status as any).reason ?? "invalid code"}
                    </div>
                  )}
                  {quote &&
                    ["promo","referral_friend"].includes(quote.benefitKind) &&
                    quote.totalReduction - quote.membershipSignupOfferSaving > 0 && (
                      <div className="mt-1.5 text-xs text-emerald-300">
                        Code {promo.applied?.toUpperCase()} applied — −
                        {formatGbp(quote.totalReduction - quote.membershipSignupOfferSaving)}
                      </div>
                    )}
                  {!!promo.applied&&promo.status?.valid&&quote&&!["promo","referral_friend"].includes(quote.benefitKind)&&<p className="mt-2 text-xs text-white/45">A larger saving is selected instead. This code has not been used.</p>}
                  {!!quote?.weekendSaving && (
                    <p className="mt-2 text-xs text-accent-200">
                      Weekend deal applied. Rental promo discounts cannot stack.
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-1.5 text-sm">
                  <SummaryRow
                    label="Rental subtotal"
                    value={quote?.subtotal ?? subtotal}
                  />
                  {!!quote && quote.totalReduction - quote.membershipSignupOfferSaving > 0 && (
                    <SummaryRow
                      label={quote.reductionLabel ?? "Rental discount"}
                      value={-(quote.totalReduction - quote.membershipSignupOfferSaving)}
                    />
                  )}
                  {!!quote?.membershipSignupOfferSaving && <SummaryRow label="One-time joining credit" value={-quote.membershipSignupOfferSaving} saving />}
                  {!!quote?.membershipCreditApplied && <SummaryRow label="Subscription credit applied" value={-quote.membershipCreditApplied} saving />}
                  {!!quote && quote.creditApplied-quote.membershipCreditApplied > 0 && (
                    <SummaryRow
                      label="Account credit"
                      value={-(quote.creditApplied-quote.membershipCreditApplied)}
                      saving
                    />
                  )}
                  <hr className="receipt-sep" />
                  {!!membership && (
                    <SummaryRow
                      label={
                        membership.intro === "trial"
                          ? "Subscription · first 7 days free"
                          : "First subscription month"
                      }
                      value={quote?.membershipFee}
                      muted
                    />
                  )}
                  {quoteError && (
                    <p role="alert" className="text-xs text-red-300">
                      {quoteError}
                    </p>
                  )}
                  <div className="flex justify-between font-display text-lg font-bold text-white">
                    <span>Estimated basket total</span>
                    <span data-testid="basket-due" className="font-mono">
                      {quote
                        ? formatGbp(Math.round((quote.combinedTotalDue - quote.depositAmount) * 100) / 100)
                        : "Calculating…"}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-white/40">Rental charges{membership ? " + subscription" : ""}, after applied credit. Delivery and refundable security are calculated at checkout.</p>
                </div>

                {!checkout.enabled ? <><button data-testid="checkout-paused-button" type="button" disabled className="mt-5 w-full cursor-not-allowed rounded-full bg-white/10 py-3 text-white/50">Checkout temporarily paused</button><CheckoutPauseNotice loading={checkout.loading}/></> : blocked ? (
                  <button
                    disabled
                    className="mt-5 w-full cursor-not-allowed rounded-full bg-white/10 py-3 text-center font-medium text-white/40"
                  >
                    {stock.error ? "Check availability to checkout" : stock.checking ? "Checking availability…" : "Resolve availability to checkout"}
                  </button>
                ) : (
                  <button type="button" onClick={()=>void continueCheckout()}
                    className="btn-primary mt-5 w-full py-3"
                  >
                    Secure checkout
                    <IconArrowRight className="h-4 w-4" />
                  </button>
                )}
                <p className="mt-3 flex items-center justify-center gap-1.5 text-center font-mono text-[10px] uppercase tracking-[0.15em] text-white/25">
                  <IconLock className="h-3 w-3" /> Secured by Stripe · test mode
                </p>
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    data-testid="clear-basket"
                    onClick={clear}
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/50 transition-colors hover:bg-white/10 hover:text-white/75"
                  >
                    Clear basket
                  </button>
                </div>
              </aside>
            </div>

            <div className="mt-8">
              <KitCompatibility />
            </div>
            <CartPlanning />

            {first && (
              <Recommendations
                start={first.start}
                end={first.end}
                days={first.days}
              />
            )}
          </>
        )}
      </main>
    </>
  );
}

function SummaryRow({ label, value, saving, muted }: { label: string; value?: number; saving?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${saving ? "text-emerald-300" : muted ? "text-[11px] text-white/40" : "text-white/60"}`}>
      <span>{label}</span>
      <span className="shrink-0 font-mono">
        {value === undefined ? "…" : formatGbp(value)}
      </span>
    </div>
  );
}
