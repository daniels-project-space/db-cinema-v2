"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
export function RentalManagerDelivery({ token, bookingId }: { token: string; bookingId: string }) {
  const data = useQuery(api.rmv2Delivery.status, { token, bookingId: bookingId as any });
  const retry = useMutation(api.rmv2Delivery.retry);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!data) return null;
  const explanation=data.error?.startsWith("http_422")?"Rental Manager rejected this rental update. Check the rental and shared availability before handover.":data.error?"The rental update could not be confirmed. Check shared availability before handover.":null;
  return <div className="mt-3 rounded-lg border border-white/10 p-3 text-[11px] text-white/50"><p>Rental Manager sync · {data.status === "delivered" ? "Up to date" : data.status === "pending" ? `Waiting for confirmation · ${data.attempts} attempts · retrying automatically` : data.status === "attention" ? "Needs attention" : "Not yet confirmed"}</p>{explanation && <p className="mt-1 text-amber-200">{explanation}</p>}<p className="mt-1">This is the sync between systems, not the customer's pickup or delivery choice.</p>{data.status !== "delivered" && data.status !== "pending" && <button disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await retry({ token, bookingId: bookingId as any }); } catch(e) { setError(e instanceof Error ? e.message : "Could not retry sync."); } finally { setBusy(false); } }} className="mt-2 text-accent-300 disabled:opacity-40">{busy ? "Queueing…" : "Retry rental update"}</button>}{error && <p role="alert" className="mt-1 text-rose-200">{error}</p>}</div>;
}
