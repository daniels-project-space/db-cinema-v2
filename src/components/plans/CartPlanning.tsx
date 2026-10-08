"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { useCart } from "@/components/cart/CartProvider";
import Link from "next/link";
import { dayMs } from "@/lib/dates";
export function BasketRecoveryStatus() {
  const cart = useCart();
  return cart.recoveryError ? <p role="alert" className="mt-2 text-xs text-rose-300">{cart.recoveryError}</p> : null;
}
export function CartPlanning() {
  const cart = useCart(),
    account = useAccount(),
    save = useMutation(api.kitPlans.save);
  const [name, setName] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function persist() {
    if (!account.token) return;
    setBusy(true);
    setMessage("");
    try {
      const lines = new Map<string, number>();
      for (const i of cart.items)
        lines.set(i.listingId, (lines.get(i.listingId) ?? 0) + 1);
      const same = cart.items.every(
        (i) => i.start === cart.items[0].start && i.end === cart.items[0].end,
      );
      await save({
        token: account.token,
        title: name.trim() || "My shoot kit",
        lines: [...lines].map(([listingId, qty]) => ({
          listingId: listingId as any,
          qty,
        })),
        ...(same
          ? { start: dayMs(cart.items[0].start), end: dayMs(cart.items[0].end) }
          : {}),
      });
      setMessage(
        "Saved. Open Shoot lists in your account to edit or share it.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!cart.items.length) return null;
  return (
    <section className="mb-7 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="font-medium text-white">Keep this kit</h2>
          <p className="mt-1 text-xs text-white/40">
            Save it for a shoot or share a live quote.
          </p>
        </div>
        {account.me && (
          <>
            <input
              aria-label="Shoot list name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Shoot name"
              className="input w-44 text-sm"
            />
            <button
              disabled={busy}
              onClick={persist}
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save shoot list"}
            </button>
          </>
        )}
      </div>
      {message && (
        <p role="status" className="mt-3 text-xs text-white/65">
          {message}{" "}
          <Link className="underline" href="/account#plans">
            Shoot lists ↗
          </Link>
        </p>
      )}
      <BasketRecoveryStatus />
    </section>
  );
}
