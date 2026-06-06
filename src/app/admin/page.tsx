"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const STATUSES = ["confirmed", "active", "returned", "cancelled"] as const;

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    setToken(localStorage.getItem("dbc_admin"));
  }, []);

  const bookings = useQuery(api.bookings.adminList, token ? { token } : "skip");
  const contacts = useQuery(api.contact.adminList, token ? { token } : "skip");
  const setStatus = useMutation(api.bookings.adminSetStatus);
  const refund = useAction(api.checkout.refundDeposit);
  const markHandled = useMutation(api.contact.adminMarkHandled);

  const authed = bookings?.authorized;

  function save() {
    localStorage.setItem("dbc_admin", input);
    setToken(input);
  }

  if (!token || authed === false) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-sm px-6 py-24">
          <h1 className="font-display text-2xl font-bold text-white/90">Admin</h1>
          <p className="mt-2 text-sm text-white/40">Enter the admin passcode.</p>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Passcode"
            className="mt-4 w-full rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none"
          />
          <button
            onClick={save}
            className="mt-3 w-full rounded-full bg-accent-500 py-2.5 font-medium text-white hover:bg-accent-600"
          >
            Enter
          </button>
          {authed === false && (
            <p className="mt-3 text-center text-xs text-red-300">Wrong passcode.</p>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-6xl px-6 py-10">
        <h1 className="font-display text-3xl font-bold text-white/90">
          Admin <span className="gradient-text">dashboard</span>
        </h1>

        {/* bookings */}
        <h2 className="mt-8 font-display text-lg font-semibold text-white/80">
          Bookings {bookings ? `(${bookings.items.length})` : ""}
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          {bookings?.items.map((b: any) => (
            <div key={b._id} className="rounded-2xl glass p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="text-sm text-white/80">{b.guestEmail}</span>
                  <span
                    className={`ml-2 rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                      b.status === "confirmed"
                        ? "bg-accent-500/20 text-accent-300"
                        : b.status === "active"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : b.status === "returned"
                            ? "bg-white/10 text-white/50"
                            : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    {b.status}
                  </span>
                  <span className="ml-2 text-xs text-white/30">{b.fulfilment}</span>
                </div>
                <div className="text-right">
                  <div className="font-display font-bold text-white/90">£{b.total}</div>
                  <div className="text-[11px] text-white/30">
                    deposit £{b.depositAmount}
                    {b.depositRefunded ? " · refunded" : ""}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-xs text-white/45">
                {b.lineItems.map((li: any, i: number) => (
                  <div key={i}>
                    {li.title} · {day(li.start)}→{day(li.end)} · £{li.lineTotal}
                  </div>
                ))}
              </div>
              {b.address && (
                <div className="mt-1 text-xs text-white/30">📍 {b.address}</div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus({ token, bookingId: b._id, status: s })}
                    disabled={b.status === s}
                    className="rounded-full glass px-3 py-1 text-xs text-white/60 hover:text-white disabled:opacity-25"
                  >
                    {s}
                  </button>
                ))}
                <button
                  onClick={() =>
                    refund({ token, bookingId: b._id }).catch((e) => alert(e.message))
                  }
                  disabled={b.depositRefunded || b.depositAmount <= 0}
                  className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-25"
                >
                  Refund deposit
                </button>
              </div>
            </div>
          ))}
          {bookings && bookings.items.length === 0 && (
            <div className="text-sm text-white/30">No bookings yet.</div>
          )}
        </div>

        {/* contact inbox */}
        <h2 className="mt-10 font-display text-lg font-semibold text-white/80">
          Contact inbox {contacts ? `(${contacts.items.length})` : ""}
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          {contacts?.items.map((m: any) => (
            <div
              key={m._id}
              className={`rounded-2xl glass p-4 ${m.handled ? "opacity-50" : ""}`}
            >
              <div className="flex justify-between">
                <span className="text-sm text-white/80">
                  {m.name} <span className="text-white/40">({m.email})</span>
                </span>
                {!m.handled && (
                  <button
                    onClick={() => markHandled({ token, id: m._id })}
                    className="text-xs text-accent-400 hover:underline"
                  >
                    mark handled
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-white/50">{m.message}</p>
            </div>
          ))}
          {contacts && contacts.items.length === 0 && (
            <div className="text-sm text-white/30">No messages.</div>
          )}
        </div>
      </main>
    </>
  );
}
