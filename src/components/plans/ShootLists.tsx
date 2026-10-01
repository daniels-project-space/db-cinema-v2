"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { RentalKit } from "@/components/rentals/RentalKit";
import { CheckoutReminder } from "./CartPlanning";
import Link from "next/link";
const day = (n: number) =>
  new Date(n).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
export function ShootLists() {
  const { token } = useAccount();
  const plans = useQuery(api.kitPlans.list, token ? { token } : "skip"),
    alerts = useQuery(api.waitlist.mine, token ? { token } : "skip");
  const share = useMutation(api.kitPlans.share),
    remove = useMutation(api.kitPlans.remove),
    cancel = useMutation(api.waitlist.cancel);
  const [err, setErr] = useState("");
  async function act(work: () => Promise<unknown>) {
    setErr("");
    try {
      await work();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <div className="mt-6 space-y-8">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-white">Shoot lists</h2>
          <Link href="/gear" className="text-sm text-white/50">
            Build a kit ↗
          </Link>
        </div>
        <p className="mt-2 text-sm text-white/40">
          Save from your basket. Edit quantities and dates, share a quote, then
          book at current prices.
        </p>
        {err && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {err}
          </p>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {plans?.map((p) => (
            <article
              key={p._id}
              className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <h3 className="font-medium text-white">{p.title}</h3>
                <span className="text-xs text-white/35">
                  {p.start && p.end
                    ? `${day(p.start)} – ${day(p.end)}`
                    : "Dates to choose"}
                </span>
              </div>
              <RentalKit items={p.items} compact />
              <div className="mt-5 flex flex-wrap gap-3 text-xs">
                <Link
                  href={`/plan?plan=${p._id}`}
                  className="rounded-full bg-white px-4 py-2 text-black"
                >
                  Edit / book
                </Link>
                <button
                  className="text-white/60"
                  onClick={() =>
                    act(async () => {
                      await share({
                        token: token!,
                        planId: p._id,
                        enabled: !p.shareKey,
                      });
                    })
                  }
                >
                  {p.shareKey ? "Revoke sharing" : "Create share link"}
                </button>
                <button
                  className="text-white/35"
                  onClick={() => {
                    if (
                      confirm(
                        "Delete this shoot list and revoke its shared quote?",
                      )
                    )
                      void act(() => remove({ token: token!, planId: p._id }));
                  }}
                >
                  Delete
                </button>
              </div>
              {p.shareKey && (
                <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-3">
                  <Link
                    className="min-w-0 truncate text-xs text-white/50"
                    href={`/kit/${p.shareKey}`}
                  >
                    View shared quote ↗
                  </Link>
                  <button
                    className="ml-auto shrink-0 text-xs text-white/65"
                    onClick={() =>
                      act(() =>
                        navigator.clipboard.writeText(
                          `${location.origin}/kit/${p.shareKey}`,
                        ),
                      )
                    }
                  >
                    Copy link
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
        {plans?.length === 0 && (
          <p className="mt-5 rounded-2xl border border-dashed border-white/10 p-8 text-sm text-white/40">
            Your next shoot starts with a saved kit. Add gear to your basket,
            then choose “Save shoot list”.
          </p>
        )}
      </div>
      <section className="rounded-2xl border border-white/10 p-5">
        <h2 className="mb-4 font-medium text-white">Checkout reminder</h2>
        <CheckoutReminder />
      </section>
      <section>
        <h2 className="font-display text-xl text-white">Availability alerts</h2>
        <p className="mt-2 text-sm text-white/40">
          Set an alert on a booked-out item’s page. An email never reserves
          stock.
        </p>
        <div className="mt-4 divide-y divide-white/10">
          {alerts?.map((w) => (
            <div key={w._id} className="flex flex-wrap items-center gap-3 py-4">
              <div className="min-w-0 flex-1">
                <Link
                  className="text-sm text-white/80"
                  href={`/gear/${w.slug}?start=${new Date(w.start).toISOString().slice(0, 10)}&end=${new Date(w.end).toISOString().slice(0, 10)}`}
                >
                  {w.listingTitle}
                </Link>
                <p className="mt-1 text-xs text-white/40">
                  {day(w.start)} – {day(w.end)}
                </p>
              </div>
              <span className="text-xs text-white/45">
                {w.cancelled
                  ? "Cancelled"
                  : w.deliveredAt
                    ? "Email sent"
                    : w.notified
                      ? "Expired"
                      : "Watching"}
              </span>
              {!w.notified && !w.cancelled && (
                <button
                  onClick={() =>
                    act(() => cancel({ token: token!, id: w._id }))
                  }
                  className="text-xs text-white/60"
                >
                  Cancel alert
                </button>
              )}
            </div>
          ))}
        </div>
        {alerts?.length === 0 && (
          <p className="mt-4 text-sm text-white/35">No alerts yet.</p>
        )}
      </section>
    </div>
  );
}
