"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "@/components/cart/CartProvider";
import { usePromo } from "@/components/cart/usePromo";
import { Offers } from "@/components/Offers";
import { Recommendations } from "@/components/Recommendations";
import { smallDamageHold } from "@/lib/pricing";

const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");

export default function CartPage() {
  const { items, remove, clear, subtotal, eligibleSubtotal, depositTotal } = useCart();
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
  const first = items[0];

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-5xl px-6 py-12">
        <h1 className="font-display text-3xl font-bold text-white/90">
          Your <span className="gradient-text">kit</span>
        </h1>

        {items.length === 0 ? (
          <div className="mt-12 text-center text-white/40">
            Your kit is empty.{" "}
            <Link href="/gear" className="text-accent-400 hover:underline">
              Browse gear →
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
              <div className="flex flex-col gap-3">
                {items.map((it) => {
                  const a: any = (avail as any)[it.listingId];
                  const unavailable = a && a.available === 0;
                  const over = a && !a.ok && a.available > 0;
                  const dim = unavailable || over;
                  return (
                  <div key={it.key} className={`flex gap-4 rounded-2xl glass p-4 ${dim ? "opacity-50 ring-1 ring-red-400/40" : ""}`}>
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-charcoal-800">
                      {it.heroImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.heroImage} alt={it.title} className={`h-full w-full object-cover ${dim ? "grayscale" : ""}`} />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/gear/${it.slug}`} className="text-white/85 hover:text-white">
                        {it.title}
                      </Link>
                      {it.offerType && (
                        <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] uppercase text-emerald-300">
                          offer
                        </span>
                      )}
                      <div className="mt-1 text-sm text-white/40">
                        {it.start} → {it.end} · {it.days} day{it.days > 1 ? "s" : ""} · £{it.perDay}/day
                      </div>
                      {unavailable ? (
                        <div className="mt-1 text-xs text-red-300">✕ Unavailable for these dates — remove to checkout</div>
                      ) : over ? (
                        <div className="mt-1 text-xs text-red-300">✕ Only {a.available} available for these dates (you have {a.demanded})</div>
                      ) : (
                        <div className="mt-1 text-xs text-white/30">refundable deposit £{it.deposit}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-display text-lg font-bold text-accent-400">£{it.total}</div>
                      <button onClick={() => remove(it.key)} className="mt-2 text-xs text-white/30 hover:text-red-300">
                        remove
                      </button>
                    </div>
                  </div>
                  );
                })}
                <button onClick={clear} className="self-start text-xs text-white/30 hover:text-white/60">
                  clear kit
                </button>
              </div>

              <aside className="h-fit rounded-2xl glass gradient-border p-5">
                <h2 className="font-display font-semibold text-white/80">Summary</h2>

                {/* promo */}
                <div className="mt-4">
                  <div className="flex gap-2">
                    <input
                      value={promo.draft}
                      onChange={(e) => promo.setDraft(e.target.value)}
                      placeholder="Promo code"
                      className="flex-1 rounded-lg bg-white/[0.04] px-3 py-2 text-sm uppercase text-white/80 outline-none placeholder:text-white/30 placeholder:normal-case"
                    />
                    {promo.applied ? (
                      <button onClick={promo.remove} className="rounded-lg glass px-3 text-xs text-white/60 hover:text-white">
                        remove
                      </button>
                    ) : (
                      <button onClick={promo.apply} className="rounded-lg bg-accent-500 px-4 text-sm text-white hover:bg-accent-600">
                        apply
                      </button>
                    )}
                  </div>
                  {promo.applied && promo.status && !promo.status.valid && (
                    <div className="mt-1 text-xs text-red-300">
                      {(promo.status as any).reason ?? "invalid code"}
                    </div>
                  )}
                  {promo.discount > 0 && (
                    <div className="mt-1 text-xs text-emerald-300">
                      Code {promo.applied?.toUpperCase()} applied — −£{promo.discount}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-1 text-sm">
                  <div className="flex justify-between text-white/60">
                    <span>Rental subtotal</span>
                    <span>£{subtotal}</span>
                  </div>
                  {promo.discount > 0 && (
                    <div className="flex justify-between text-emerald-300">
                      <span>Discount</span>
                      <span>−£{promo.discount}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-white/35 text-xs">
                    <span>Refundable damage hold</span>
                    <span>£{hold}</span>
                  </div>
                  <div className="text-[11px] text-white/25">
                    Choose ID+insurance (small hold) or a full security deposit at checkout.
                  </div>
                  <div className="mt-2 flex justify-between border-t border-white/5 pt-2 font-display text-lg font-bold text-white/90">
                    <span>Due now</span>
                    <span>£{total}</span>
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
                    className="mt-5 block w-full rounded-full bg-accent-500 py-3 text-center font-medium text-white transition-colors hover:bg-accent-600"
                  >
                    Secure checkout
                  </Link>
                )}
                <p className="mt-2 text-center text-[11px] text-white/25">Secured by Stripe · test mode</p>
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
