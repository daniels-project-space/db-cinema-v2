"use client";

import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";

export function RentalDeliveryQuotePanel({ token, booking }: { token: string; booking: any }) {
  const state = useQuery(api.rentalDeliveryState.adminQuote, { token, bookingId: booking._id });
  const createQuote = useAction(api.rentalDelivery.createQuote);
  const cancelQuote = useAction(api.rentalDelivery.cancelQuote);
  const [open, setOpen] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState(booking.address ?? "");
  const [deliveryLegs, setDeliveryLegs] = useState<"one_way" | "round_trip">("round_trip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!deliveryAddress && booking.address) setDeliveryAddress(booking.address); }, [booking.address, deliveryAddress]);
  const current = state?.authorized ? state.quotes.find((quote: any) => ["awaiting_acceptance", "creating_checkout", "checkout_open"].includes(quote.status)) : null;
  const eligible = !!state?.authorized && !current && booking.status === "confirmed" && booking.idVerifyStatus === "verified" && booking.fulfilment === "pickup" && !booking.deliveryLegs && !booking.cancellationDecision && !booking.returnDecision && !booking.activeAdditionId && !booking.activeDeliveryQuoteId && !booking.activeExtensionId && !booking.activePriceAdjustmentId;
  useEffect(() => { if (!eligible) setOpen(false); }, [eligible]);
  async function submit() {
    if (busy || !eligible) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await createQuote({ token, bookingId: booking._id, requestId: crypto.randomUUID(), deliveryLegs, deliveryAddress });
      setNotice(`${deliveryLegs === "one_way" ? "One-way delivery" : "Delivery and collection"} quote sent in the rental conversation: ${formatGbp(result.amountPence / 100)}.`);
      setOpen(false);
    } catch (e: any) {
      setError(e.message ?? "Delivery quote could not be created.");
    } finally { setBusy(false); }
  }
  async function cancelActiveQuote(id: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await cancelQuote({ token, id: id as any }); setNotice("Delivery quote closed and its payment link expired."); }
    catch (e: any) { setError(e.message ?? "Quote could not be closed."); }
    finally { setBusy(false); }
  }
  return (
    <section className="mt-3 rounded-xl border border-sky-200/15 bg-sky-300/[0.035] p-3" aria-label="Delivery quote">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-xs font-semibold text-sky-100">Delivery</p><p className="mt-1 text-[11px] text-white/45">Quote in chat · activates after payment</p></div>
        {eligible && <button type="button" onClick={() => { setOpen(value => !value); setError(""); }} className="rounded-full border border-sky-200/25 px-3 py-2 text-xs text-sky-100">{open ? "Close quote" : "Quote delivery"}</button>}
      </div>
      {current && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-amber-100/80"><span>{current.deliveryLegs === "one_way" ? "One-way" : "Round trip"} · {formatGbp(current.amountPence / 100)} · {current.status.replaceAll("_", " ")}</span><button type="button" disabled={busy} onClick={() => void cancelActiveQuote(current._id)} className="underline underline-offset-2 disabled:opacity-40">Close</button></div>}
      {notice && <p role="status" className="mt-3 text-xs text-emerald-200">{notice}</p>}
      {open && eligible && <div className="mt-3 space-y-3">
        <label className="block text-xs text-white/70">Delivery address<textarea value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} rows={3} maxLength={300} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-sky-200/40" autoComplete="street-address" /></label>
        <fieldset className="space-y-2 text-xs text-white/75"><legend className="mb-1 font-medium">Delivery type</legend>
          <label className="flex items-start gap-2"><input type="radio" name={`delivery-leg-${booking._id}`} value="round_trip" checked={deliveryLegs === "round_trip"} onChange={() => setDeliveryLegs("round_trip")} className="mt-0.5 accent-sky-300"/><span>Round trip · deliver and collect</span></label>
          <label className="flex items-start gap-2"><input type="radio" name={`delivery-leg-${booking._id}`} value="one_way" checked={deliveryLegs === "one_way"} onChange={() => setDeliveryLegs("one_way")} className="mt-0.5 accent-sky-300"/><span>One way · renter returns at Waterstones, Trafalgar Square</span></label>
        </fieldset>
        <p className="text-[11px] text-white/45">Checkout pricing · member savings included</p>
        <button type="button" disabled={busy || !eligible} onClick={() => void submit()} className="rounded-full bg-sky-200 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">{busy ? "Calculating…" : "Send quote"}</button>
      </div>}
      {state?.authorized && !eligible && !current && booking.status === "confirmed" && booking.fulfilment === "pickup" && <p className="mt-3 text-[11px] text-white/35">Quote unavailable while verification, settlement, or another change is pending.</p>}
      {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
    </section>
  );
}
