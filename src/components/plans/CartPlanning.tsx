"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { useCart } from "@/components/cart/CartProvider";
import Link from "next/link";
import { dayMs } from "@/lib/dates";
export function CheckoutReminder() {
  const cart = useCart(),
    account = useAccount();
  if (!account.me)
    return (
      <p className="text-xs text-white/45">
        <Link href="/account" className="underline">
          Sign in
        </Link>{" "}
        to save your kit and request a checkout reminder.
      </p>
    );
  return (
    <div>
      <label className="flex items-start gap-3 text-sm text-white/65">
        <input
          type="checkbox"
          checked={cart.reminderEnabled}
          onChange={(e) => cart.setReminderEnabled(e.target.checked)}
          className="mt-1 accent-orange-500"
        />
        <span>
          Email me once if I leave this checkout unfinished.
          <span className="mt-1 block text-xs text-white/40">
            After 2 hours, when booking is available. No reservation or
            marketing signup. Turn off here or in Shoot lists.
          </span>
        </span>
      </label>
      {cart.reminderError && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {cart.reminderError}
        </p>
      )}
    </div>
  );
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
      <div className="mt-5 border-t border-white/10 pt-4">
        <CheckoutReminder />
      </div>
    </section>
  );
}
