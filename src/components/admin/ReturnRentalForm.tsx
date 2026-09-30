"use client";

import { useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { lateFeeQuote } from "@cvx/lib/lateFee";
import { formatGbp } from "@/lib/pricing";

const localNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function ReturnRentalForm({ booking, token, onClose }: { booking: any; token: string; onClose: () => void }) {
  const submit = useAction(api.checkout.markReturned);
  const saved = booking.returnDecision;
  const [returnedAt, setReturnedAt] = useState(() => saved ? new Date(saved.actualReturnedAt - new Date(saved.actualReturnedAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : localNow());
  const [damage, setDamage] = useState(() => String(saved?.damageKept ?? 0));
  const [damageNote, setDamageNote] = useState(() => saved?.damageNote ?? "");
  const [chargeLate, setChargeLate] = useState(() => saved?.chargeLate ?? true);
  const [waiverReason, setWaiverReason] = useState(() => saved?.lateWaiverReason ?? "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedAt = new Date(returnedAt).getTime();
  const savedMinute = saved ? new Date(saved.actualReturnedAt - new Date(saved.actualReturnedAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : null;
  const at = saved && returnedAt === savedMinute ? saved.actualReturnedAt : parsedAt;
  const quote = useMemo(() => {
    try { return Number.isFinite(at) ? lateFeeQuote(booking.lineItems, booking.returnTime, at) : null; }
    catch { return null; }
  }, [booking.lineItems, booking.returnTime, at]);
  const damageAmount = Number(damage);
  const valid = !!quote && Number.isFinite(at) && at <= Date.now() + 60000 && Number.isFinite(damageAmount) && damageAmount >= 0 &&
    damageAmount <= booking.depositAmount + (booking.depositHoldAmount ?? 0) &&
    (damageAmount === 0 || damageNote.trim().length >= 10) &&
    (chargeLate || !quote?.amount || waiverReason.trim().length >= 5);

  async function finish() {
    if (!valid || working) return;
    setWorking(true);
    setError(null);
    try {
      const result = await submit({
        token, bookingId: booking._id, actualReturnedAt: at,
        damageKept: damageAmount, damageNote: damageAmount ? damageNote.trim() : undefined,
        chargeLate: chargeLate && !!quote?.amount,
        lateWaiverReason: !chargeLate ? waiverReason.trim() : undefined,
      });
      alert(`Return recorded. Damage/loss ${formatGbp(result.kept)}; refundable security payment returned ${formatGbp(result.released)}; separate late charge assessed ${formatGbp(result.lateAmount)}. A return statement will be emailed.`);
      onClose();
    } catch (e: any) { setError(e?.message ?? "Return could not be recorded."); }
    finally { setWorking(false); }
  }

  return <div className="mt-3 rounded-xl border border-accent-400/25 bg-black/20 p-3 text-[11px] text-white/70">
    <div className="flex items-center justify-between gap-3"><h4 className="font-semibold text-white">Record return and settlement</h4><button onClick={onClose} className="text-white/50 hover:text-white">Close</button></div>
    {saved && <p className="mt-2 text-amber-200">A return was started but settlement did not finish. The saved time and amounts are loaded so you can retry safely.</p>}
    <p className="mt-1 text-white/45">The return time is entered in your device’s local timezone. Late days are calculated against the agreed London return time and each item’s booked daily rate.</p>
    <label className="mt-3 block">Actual physical return time<input type="datetime-local" value={returnedAt} onChange={(e) => setReturnedAt(e.target.value)} className="input mt-1 w-full [color-scheme:dark]" /></label>
    <div className="mt-3 rounded-lg border border-white/10 p-2.5">
      <div className="font-semibold text-white">Late rental time · {quote ? formatGbp(quote.amount) : "—"}</div>
      {!booking.returnTime && <p className="mt-1 text-amber-200">No agreed return time is stored for this booking, so no automatic late charge can be assessed.</p>}
      {quote?.breakdown.map((line, i) => <div key={i} className="mt-1 flex justify-between gap-2"><span>{line.title} · {line.days} commenced day{line.days === 1 ? "" : "s"} × {formatGbp(line.dailyRate)}</span><span>{formatGbp(line.amount)}</span></div>)}
      {quote?.breakdown.some((line) => line.dailyRate === 0) && <p className="mt-1 text-amber-200">A booked daily rate is missing for at least one item; it will not be charged automatically.</p>}
      {quote && quote.amount > 0 && <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={chargeLate} onChange={(e) => setChargeLate(e.target.checked)} /> Apply this separately agreed late rental charge</label>}
      {quote && quote.amount > 0 && !chargeLate && <label className="mt-2 block">Reason for waiving late time<input value={waiverReason} onChange={(e) => setWaiverReason(e.target.value)} className="input mt-1 w-full" placeholder="Required for the booking record" /></label>}
    </div>
    <label className="mt-3 block">Documented damage or loss to retain (£)<input type="number" min="0" max={booking.depositAmount + (booking.depositHoldAmount ?? 0)} step="0.01" value={damage} onChange={(e) => setDamage(e.target.value)} className="input mt-1 w-full" /></label>
    {damageAmount > 0 && <label className="mt-2 block">Itemised evidence and reason<textarea value={damageNote} onChange={(e) => setDamageNote(e.target.value)} rows={3} placeholder="Describe the item, damage or loss, evidence, and calculation" className="input mt-1 w-full" /></label>}
    <p className="mt-3 text-white/45">An active card hold covers damage first. If there is no damage, an unused active hold may cover the late charge after the separate notice and dispute period. Any remaining late balance is a separate saved-card attempt.</p>
    {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
    <button type="button" disabled={!valid || working} onClick={finish} className="mt-3 rounded-md bg-accent-400 px-3 py-2 font-semibold text-black disabled:opacity-40">{working ? "Settling…" : "Confirm return and email statement"}</button>
  </div>;
}
