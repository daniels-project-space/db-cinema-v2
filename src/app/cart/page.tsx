"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { GearLoopBanner } from "@/components/GearLoopBanner";
import { KitCompatibility } from "@/components/cart/KitCompatibility";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import { usePromo } from "@/components/cart/usePromo";
import { Offers } from "@/components/Offers";
import { Recommendations } from "@/components/Recommendations";
import { smallDamageHold } from "@/lib/pricing";
import { IconX, IconArrowRight, IconLock } from "@/components/icons";

import { dayMs as ms } from "@/lib/dates";

export default function CartPage() {
  const { items, remove, clear, subtotal, eligibleSubtotal, depositTotal } = useCart();
  const account = useAccount();
  const promo = usePromo(eligibleSubtotal);
  const hold = smallDamageHold(depositTotal); // default ID+insurance damage hold

  const avail =
    useQuery(
      api.availability.forCart,
      items.length
        ? { items: items.map((i) => ({ listingId: i.listingId as any, start: ms(i.start), end: ms(i.end) })) }
        : "skip",
    ) ?? {};
  const blocked = Object.values(avail).some((a: any) => !a.ok);

  const total = subtotal + hold - promo.discount;
  // store credit (members) applies to the rental spend, never the refundable hold — previewed here,
  // applied for real server-side at checkout.
  const storeCredit = (account.me as any)?.storeCredit ?? 0;
  const creditApplied = Math.min(storeCredit, Math.max(0, subtotal - promo.discount));
  const dueNow = total - creditApplied;
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
            <div className="mt-8">
              <KitCompatibility />
            </div>
            <div className="grid gap-8 lg:grid-cols-[1fr_330px]">
              <div className="flex flex-col gap-3">
                {items.map((it, idx) => {
                  const a: any = (avail as any)[it.listingId];
                  const unavailable = a && a.available === 0;
                  const over = a && !a.ok && a.available > 0;
                  const dim = unavailable || over;
                  return (
                    <div
                      key={it.key}
                      className={`spot flex gap-4 rounded-2xl p-4 ${dim ? "opacity-50 ring-1 ring-rec-500/40" : ""}`}
                      style={{ animation: `card-in 0.5s var(--ease-out-expo) ${idx * 60}ms both` }}
                    >
                      <Link href={`/gear/${it.slug}`} className="block h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-charcoal-800">
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
                        <Link href={`/gear/${it.slug}`} className="text-white/85 transition-colors hover:text-white">
                          {it.title}
                        </Link>
                        {it.offerType && (
                          <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] uppercase text-emerald-300">
                            offer
                          </span>
                        )}
                        <div className="mt-1.5 font-mono text-xs text-white/40">
                          {it.start} → {it.end} · {it.days}d · £{it.perDay}/day
                        </div>
                        {unavailable ? (
                          <div className="mt-1.5 text-xs text-red-300">Unavailable for these dates — remove to checkout</div>
                        ) : over ? (
                          <div className="mt-1.5 text-xs text-red-300">Only {a.available} available for these dates (you have {a.demanded})</div>
                        ) : (
                          <div className="mt-1.5 text-xs text-white/30">refundable deposit £{it.deposit}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end justify-between">
                        <div className="font-display text-lg font-bold text-accent-400">£{it.total}</div>
                        <button
                          onClick={() => remove(it.key)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/5 hover:text-rec-500"
                          aria-label={`Remove ${it.title}`}
                        >
                          <IconX className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <button onClick={clear} className="self-start text-xs text-white/30 transition-colors hover:text-white/60">
                  clear kit
                </button>
              </div>

              <aside className="ticket spot gradient-border h-fit rounded-2xl p-5 lg:sticky! lg:top-24">
                <div className="hud-label !text-accent-400/90">Summary</div>

                {/* promo */}
                <div className="mt-4">
                  <div className="flex gap-2">
                    <input
                      value={promo.draft}
                      onChange={(e) => promo.setDraft(e.target.value)}
                      placeholder="Promo code"
                      className="input min-w-0 flex-1 font-mono uppercase placeholder:normal-case placeholder:font-sans"
                    />
                    {promo.applied ? (
                      <button onClick={promo.remove} className="btn-ghost px-3 text-xs">
                        remove
                      </button>
                    ) : (
                      <button onClick={promo.apply} className="btn-primary px-4 text-sm">
                        apply
                      </button>
                    )}
                  </div>
                  {promo.applied && promo.status && !promo.status.valid && (
                    <div className="mt-1.5 text-xs text-red-300">
                      {(promo.status as any).reason ?? "invalid code"}
                    </div>
                  )}
                  {promo.discount > 0 && (
                    <div className="mt-1.5 text-xs text-emerald-300">
                      Code {promo.applied?.toUpperCase()} applied — −£{promo.discount}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-1.5 text-sm">
                  <div className="flex justify-between text-white/60">
                    <span>Rental subtotal</span>
                    <span className="font-mono">£{subtotal}</span>
                  </div>
                  {promo.discount > 0 && (
                    <div className="flex justify-between text-emerald-300">
                      <span>Discount</span>
                      <span className="font-mono">−£{promo.discount}</span>
                    </div>
                  )}
                  {creditApplied > 0 && (
                    <div className="flex justify-between text-amber-300">
                      <span>Store credit</span>
                      <span className="font-mono">−£{creditApplied}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs text-white/35">
                    <span>Refundable damage hold</span>
                    <span className="font-mono">£{hold}</span>
                  </div>
                  <div className="text-[11px] leading-relaxed text-white/25">
                    Choose ID+insurance (small hold) or a full security deposit at checkout.
                  </div>
                  <hr className="receipt-sep" />
                  <div className="flex justify-between font-display text-lg font-bold text-white">
                    <span>Due now</span>
                    <span className="font-mono">£{dueNow}</span>
                  </div>
                </div>

                {blocked ? (
                  <button
                    disabled
                    className="mt-5 w-full cursor-not-allowed rounded-full bg-white/10 py-3 text-center font-medium text-white/40"
                  >
                    Resolve availability to checkout
                  </button>
                ) : (
                  <Link
                    href="/checkout"
                    onClick={(e) => {
                      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                        e.preventDefault();
                        window.dispatchEvent(new CustomEvent("dbc:checkout-turn"));
                      }
                    }}
                    className="btn-primary mt-5 w-full py-3"
                  >
                    Secure checkout
                    <IconArrowRight className="h-4 w-4" />
                  </Link>
                )}
                <p className="mt-3 flex items-center justify-center gap-1.5 text-center font-mono text-[10px] uppercase tracking-[0.15em] text-white/25">
                  <IconLock className="h-3 w-3" /> Secured by Stripe · test mode
                </p>
              </aside>
            </div>

            <Offers />
            {first && (
              <Recommendations start={first.start} end={first.end} days={first.days} />
            )}
          </>
        )}
      </main>
    </>
  );
}
