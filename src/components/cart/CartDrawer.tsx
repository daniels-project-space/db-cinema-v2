"use client";

import Link from "next/link";
import { useCart } from "./CartProvider";

export function CartDrawer() {
  const { items, remove, subtotal, depositTotal, isOpen, close } = useCart();

  return (
    <>
      {/* backdrop */}
      <div
        onClick={close}
        className={`fixed inset-0 z-50 bg-black/60 transition-opacity ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden
      />
      {/* panel */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-charcoal-900/95 backdrop-blur-xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h2 className="font-display text-lg font-bold text-white/90">
            Your kit{" "}
            <span className="text-sm font-normal text-white/40">
              ({items.length})
            </span>
          </h2>
          <button
            onClick={close}
            className="text-white/40 transition-colors hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <div className="mt-20 text-center text-white/30">
              Your kit is empty.
              <div className="mt-4">
                <Link
                  href="/gear"
                  onClick={close}
                  className="text-accent-400 hover:underline"
                >
                  Browse gear →
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((it) => (
                <div
                  key={it.key}
                  className="flex gap-3 rounded-xl glass p-3"
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
                      className="line-clamp-1 text-sm text-white/80 hover:text-white"
                    >
                      {it.title}
                    </Link>
                    <div className="mt-0.5 text-xs text-white/40">
                      {it.start} → {it.end} · {it.days} day
                      {it.days > 1 ? "s" : ""}
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
                    className="self-start text-white/30 transition-colors hover:text-red-300"
                    aria-label="Remove"
                  >
                    ✕
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
              <span className="text-white/90">£{subtotal}</span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-white/35">
              <span>Refundable deposits</span>
              <span>£{depositTotal}</span>
            </div>
            <Link
              href="/cart"
              onClick={close}
              className="mt-4 block rounded-full bg-accent-500 py-3 text-center font-medium text-white transition-colors hover:bg-accent-600"
            >
              Review kit
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
