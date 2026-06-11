"use client";

import Link from "next/link";
import { useCart } from "./CartProvider";
import { IconX, IconArrowRight } from "@/components/icons";

export function CartDrawer() {
  const { items, remove, subtotal, depositTotal, isOpen, close } = useCart();

  return (
    <>
      {/* backdrop */}
      <div
        onClick={close}
        className={`fixed inset-0 z-50 bg-black/65 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden
      />
      {/* panel */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-charcoal-900/95 backdrop-blur-xl transition-transform duration-500 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h2 className="font-display text-lg font-bold text-white/90">
            Your kit{" "}
            <span className="font-mono text-sm font-normal text-accent-400">
              ({items.length})
            </span>
          </h2>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <div className="mt-20 text-center text-white/30">
              <div className="hud-label mb-3">Empty slate</div>
              Your kit is empty.
              <div className="mt-4">
                <Link
                  href="/gear"
                  onClick={close}
                  className="arrow-link text-accent-400 hover:text-accent-300"
                >
                  Browse gear <span className="arrow">→</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((it, i) => (
                <div
                  key={it.key}
                  className="glass flex gap-3 rounded-xl p-3"
                  style={isOpen ? { animation: `drawer-item-in 0.45s var(--ease-out-expo) ${120 + i * 60}ms both` } : undefined}
                >
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-charcoal-800">
                    {it.heroImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.heroImage}
                        alt={it.title}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/gear/${it.slug}`}
                      onClick={close}
                      className="line-clamp-1 text-sm text-white/80 transition-colors hover:text-white"
                    >
                      {it.title}
                    </Link>
                    <div className="mt-0.5 font-mono text-[11px] text-white/40">
                      {it.start} → {it.end} · {it.days}d
                    </div>
                    <div className="mt-1 text-sm text-accent-400">
                      £{it.total}{" "}
                      <span className="text-xs text-white/30">
                        +£{it.deposit} deposit
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => remove(it.key)}
                    className="flex h-7 w-7 items-center justify-center self-start rounded-full text-white/30 transition-colors hover:bg-white/5 hover:text-rec-500"
                    aria-label="Remove"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-white/5 px-5 py-4">
            <div className="flex justify-between text-sm text-white/60">
              <span>Subtotal</span>
              <span className="font-mono text-white/90">£{subtotal}</span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-white/35">
              <span>Refundable deposits</span>
              <span className="font-mono">£{depositTotal}</span>
            </div>
            <Link
              href="/cart"
              onClick={close}
              className="btn-primary mt-4 w-full py-3"
            >
              Review kit
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
