"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
export function RentalManagerDelivery({ token, bookingId }: { token: string; bookingId: string }) {
  const data = useQuery(api.rmv2Delivery.status, { token, bookingId: bookingId as any });
  const retry = useMutation(api.rmv2Delivery.retry);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!data) return null;
  return <div className="mt-3 rounded-lg border border-white/10 p-3 text-[11px] text-white/50"><p>Rental Manager · {data.status === "delivered" ? "Latest rental update delivered" : data.status === "pending" ? `Update pending · ${data.attempts} attempts · retrying automatically` : data.status === "attention" ? "Delivery needs attention" : "Delivery has not been confirmed"}</p>{data.error && <p className="mt-1 text-amber-200">{data.error}</p>}{data.status !== "delivered" && data.status !== "pending" && <button disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await retry({ token, bookingId: bookingId as any }); } catch(e) { setError(e instanceof Error ? e.message : "Could not retry sync."); } finally { setBusy(false); } }} className="mt-2 text-accent-300 disabled:opacity-40">{busy ? "Queueing…" : "Retry rental update"}</button>}{error && <p role="alert" className="mt-1 text-rose-200">{error}</p>}</div>;
}
