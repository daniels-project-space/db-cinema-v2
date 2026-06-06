"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "@/components/cart/CartProvider";

export default function CartPage() {
  const { items, remove, clear, subtotal, depositTotal } = useCart();

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-4xl px-6 py-12">
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
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-3">
              {items.map((it) => (
                <div key={it.key} className="flex gap-4 rounded-2xl glass p-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-charcoal-800">
                    {it.heroImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.heroImage} alt={it.title} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/gear/${it.slug}`} className="text-white/85 hover:text-white">
                      {it.title}
                    </Link>
                    <div className="mt-1 text-sm text-white/40">
                      {it.start} → {it.end} · {it.days} day{it.days > 1 ? "s" : ""} · £{it.perDay}/day
                    </div>
                    <div className="mt-1 text-xs text-white/30">
                      refundable deposit £{it.deposit}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-lg font-bold text-accent-400">£{it.total}</div>
                    <button
                      onClick={() => remove(it.key)}
                      className="mt-2 text-xs text-white/30 hover:text-red-300"
                    >
                      remove
                    </button>
                  </div>
                </div>
              ))}
              <button onClick={clear} className="self-start text-xs text-white/30 hover:text-white/60">
                clear kit
              </button>
            </div>

            <aside className="h-fit rounded-2xl glass gradient-border p-5">
              <h2 className="font-display font-semibold text-white/80">Summary</h2>
              <div className="mt-4 flex justify-between text-sm text-white/60">
                <span>Rental subtotal</span>
                <span className="text-white/90">£{subtotal}</span>
              </div>
              <div className="mt-1 flex justify-between text-xs text-white/35">
                <span>Refundable deposits</span>
                <span>£{depositTotal}</span>
              </div>
              <div className="mt-3 flex justify-between border-t border-white/5 pt-3 font-display text-lg font-bold text-white/90">
                <span>Due now</span>
                <span>£{subtotal + depositTotal}</span>
              </div>
              <Link
                href="/checkout"
                className="mt-5 block w-full rounded-full bg-accent-500 py-3 text-center font-medium text-white transition-colors hover:bg-accent-600"
              >
                Secure checkout
              </Link>
              <p className="mt-2 text-center text-[11px] text-white/25">
                Secured by Stripe · test mode
              </p>
            </aside>
          </div>
        )}
      </main>
    </>
  );
}
