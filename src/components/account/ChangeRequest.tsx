"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import type { EnrichedBooking } from "@/lib/bookingDisplay";

/** Reschedule / item-level extend request. Hidden unless the server flag is on and the booking
 *  is confirmed/active. Submits a change request → admin approves via Telegram. */
export function ChangeRequest({ booking }: { booking: EnrichedBooking }) {
  const account = useAccount();
  const request = useMutation(api.changes.requestBookingChange);
  const [mode, setMode] = useState<null | "reschedule" | "extend">(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [days, setDays] = useState(1);
  const [items, setItems] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!(account.me as any)?.customerActionsEnabled) return null;
  if (!["confirmed", "active"].includes(booking.status)) return null;

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "reschedule") {
        if (!start || !end) throw new Error("Pick both dates");
        await request({
          token: account.token!,
          bookingId: booking._id as any,
          type: "reschedule",
          requestedStart: new Date(start + "T12:00:00Z").getTime(),
          requestedEnd: new Date(end + "T12:00:00Z").getTime(),
        });
      } else {
        await request({
          token: account.token!,
          bookingId: booking._id as any,
          type: "extend",
          extraDays: days,
          lineItemIndexes: items.length ? items : undefined,
        });
      }
      setMsg("Requested — we'll confirm in your chat.");
      setMode(null);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't submit");
    } finally {
      setBusy(false);
    }
  }

  if (msg) return <span className="text-[11px] text-emerald-300">{msg}</span>;

  if (!mode)
    return (
      <>
        <button onClick={() => { setMode("reschedule"); setErr(null); }} className="font-medium text-white/55 hover:text-white">
          Reschedule
        </button>
        <button onClick={() => { setMode("extend"); setErr(null); }} className="font-medium text-white/55 hover:text-white">
          + Add day
        </button>
      </>
    );

  return (
    <div className="mt-1 w-full rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-xs">
      {mode === "reschedule" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-white/50">New dates</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded bg-white/[0.06] px-2 py-1 text-white/80 outline-none" />
          <span className="text-white/30">→</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded bg-white/[0.06] px-2 py-1 text-white/80 outline-none" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-white/60">
            Extra days
            <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value)))} className="w-16 rounded bg-white/[0.06] px-2 py-1 text-white/80 outline-none" />
          </label>
          {booking.lineItems.length > 1 && (
            <div className="flex flex-col gap-1">
              <span className="text-white/40">Which items? (none = all)</span>
              {booking.lineItems.map((li, i) => (
                <label key={i} className="flex items-center gap-2 text-white/60">
                  <input type="checkbox" checked={items.includes(i)} onChange={(e) => setItems(e.target.checked ? [...items, i] : items.filter((x) => x !== i))} className="accent-accent-500" />
                  {li.title}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {err && <div className="mt-1.5 text-rose-300">{err}</div>}
      <div className="mt-2 flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-primary px-3 py-1 text-[11px]">
          {busy ? "…" : "Send request"}
        </button>
        <button onClick={() => setMode(null)} className="text-white/40 hover:text-white">
          cancel
        </button>
      </div>
    </div>
  );
}
