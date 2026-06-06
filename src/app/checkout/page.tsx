"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "@/components/cart/CartProvider";
import { usePromo } from "@/components/cart/usePromo";
import { useAccount } from "@/components/account/AccountProvider";

const DELIVERY_FEE = 25;
const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");

export default function CheckoutPage() {
  const { items, subtotal, eligibleSubtotal, depositTotal } = useCart();
  const account = useAccount();
  const promo = usePromo(eligibleSubtotal);
  const start = useAction(api.checkout.start);

  const [email, setEmail] = useState(account.me?.email ?? "");
  const [name, setName] = useState(account.me?.name ?? "");
  const [phone, setPhone] = useState(account.me?.phone ?? "");
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">("pickup");
  const [address, setAddress] = useState(account.me?.address ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const deliveryFee = fulfilment === "delivery" ? DELIVERY_FEE : 0;
  const total = subtotal + depositTotal + deliveryFee - promo.discount;
  const valid =
    items.length > 0 &&
    /\S+@\S+\.\S+/.test(email) &&
    (fulfilment === "pickup" || address.trim().length > 5);

  async function pay() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
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
        })),
        customer: { email, name: name || undefined, phone: phone || undefined },
        fulfilment,
        address: fulfilment === "delivery" ? address : undefined,
        deliveryFee,
        promoCode: promo.applied ?? undefined,
        origin: window.location.origin,
      });
      window.location.href = url;
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong");
      setBusy(false);
    }
  }

  if (items.length === 0)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-4xl px-6 py-20 text-center text-white/40">
          Your kit is empty.{" "}
          <Link href="/gear" className="text-accent-400 hover:underline">
            Browse gear →
          </Link>
        </main>
      </>
    );

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-4xl px-6 py-12">
        <h1 className="font-display text-3xl font-bold text-white/90">
          Check<span className="gradient-text">out</span>
        </h1>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-5">
            <div className="glass gradient-border rounded-2xl p-5">
              <h2 className="mb-3 font-display font-semibold text-white/80">Your details</h2>
              <div className="flex flex-col gap-3">
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email *" type="email" className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
                <div className="flex gap-3">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1 rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="flex-1 rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
                </div>
              </div>
            </div>

            <div className="glass gradient-border rounded-2xl p-5">
              <h2 className="mb-3 font-display font-semibold text-white/80">Fulfilment</h2>
              <div className="flex gap-3">
                {(["pickup", "delivery"] as const).map((f) => (
                  <button key={f} onClick={() => setFulfilment(f)} className={`flex-1 rounded-lg px-4 py-2.5 text-sm capitalize transition-colors ${fulfilment === f ? "bg-accent-500 text-white" : "glass text-white/60 hover:text-white"}`}>
                    {f}{f === "delivery" ? ` (+£${DELIVERY_FEE})` : ""}
                  </button>
                ))}
              </div>
              {fulfilment === "delivery" && (
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address *" rows={3} className="mt-3 w-full rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
              )}
            </div>
          </div>

          <aside className="h-fit rounded-2xl glass gradient-border p-5">
            <h2 className="font-display font-semibold text-white/80">Summary</h2>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              {items.map((i) => (
                <div key={i.key} className="flex justify-between text-white/55">
                  <span className="mr-2 line-clamp-1">{i.title}{i.offerType ? " (offer)" : ""}</span>
                  <span className="shrink-0">£{i.total}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-white/5 pt-3 text-sm">
              <Row label="Rental subtotal" value={subtotal} />
              {promo.discount > 0 && (
                <div className="flex justify-between text-emerald-300">
                  <span>{promo.applied?.toUpperCase()}</span>
                  <span>−£{promo.discount}</span>
                </div>
              )}
              {deliveryFee > 0 && <Row label="Delivery" value={deliveryFee} />}
              <Row label="Refundable deposit" value={depositTotal} muted />
              <div className="mt-2 flex justify-between border-t border-white/5 pt-2 font-display text-lg font-bold text-white/90">
                <span>Total due</span>
                <span>£{total}</span>
              </div>
            </div>
            {err && <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
            <button onClick={pay} disabled={!valid || busy} className="mt-5 w-full rounded-full bg-accent-500 py-3 font-medium text-white transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-30">
              {busy ? "Redirecting…" : "Pay with card"}
            </button>
            <p className="mt-2 text-center text-[11px] text-white/25">Secured by Stripe · test mode</p>
          </aside>
        </div>
      </main>
    </>
  );
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-white/35" : "text-white/60"}`}>
      <span>{label}</span>
      <span>£{value}</span>
    </div>
  );
}
