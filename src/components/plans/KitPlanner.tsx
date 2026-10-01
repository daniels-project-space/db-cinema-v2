"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { useCart } from "@/components/cart/CartProvider";
import { RentalKit } from "@/components/rentals/RentalKit";
import { SiteHeader } from "@/components/SiteHeader";
import { expandKitCart, mergeKitLines } from "../../../shared/kitCart";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dayMs } from "@/lib/dates";
const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts();
  const get = (k: string) => parts.find((p) => p.type === k)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function KitPlanner({
  planId,
  bookingId,
  shareKey,
  recoveryId,
}: {
  planId?: string;
  bookingId?: string;
  shareKey?: string;
  recoveryId?: string;
}) {
  const account = useAccount(),
    cart = useCart(),
    router = useRouter();
  const source = useQuery(
    api.kitPlans.source,
    !recoveryId && (shareKey || account.token)
      ? {
          token: account.token ?? undefined,
          planId: planId as any,
          bookingId: bookingId as any,
          shareKey,
        }
      : "skip",
  );
  const recovery = useQuery(
    api.checkoutRecovery.resume,
    recoveryId && account.token
      ? { token: account.token, id: recoveryId as any }
      : "skip",
  );
  const data = recoveryId ? recovery : source;
  const catalog = useQuery(api.catalog.allBasic, {});
  const save = useMutation(api.kitPlans.save),
    share = useMutation(api.kitPlans.share);
  const [lines, setLines] = useState<{ listingId: string; qty: number }[]>([]),
    [title, setTitle] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [err, setErr] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [replaceReady, setReplaceReady] = useState(false),
    [addId, setAddId] = useState("");
  const initialized = useRef("");
  const identity = `${planId ?? ""}|${bookingId ?? ""}|${shareKey ?? ""}|${recoveryId ?? ""}`;
  useEffect(() => {
    if (!data || initialized.current === identity) return;
    initialized.current = identity;
    setLines(mergeKitLines(data.lines));
    setTitle(data.title);
    if (
      "start" in data &&
      data.start &&
      data.end &&
      iso(data.start) >= today()
    ) {
      setStart(iso(data.start));
      setEnd(iso(data.end));
    } else if (recoveryId && data.lines.length) {
      const first = data.lines[0] as { start?: number; end?: number };
      const uniform = data.lines.every(
        (l: any) =>
          (l as any).start === first.start && (l as any).end === first.end,
      );
      if (uniform && first.start && first.end && iso(first.start) >= today()) {
        setStart(iso(first.start));
        setEnd(iso(first.end));
      }
    }
  }, [data, identity]);
  const datesOK =
    start >= today() &&
    end >= start &&
    !!start &&
    !!end &&
    dayMs(end) - dayMs(start) <= 365 * 86400000;
  const validLines =
    lines.length > 0 &&
    lines.every((l) => l.qty >= 1 && Number.isInteger(l.qty) && l.qty <= 20) &&
    lines.reduce((n, l) => n + l.qty, 0) <= 100;
  const preview = useQuery(
    api.kitPlans.preview,
    datesOK && validLines
      ? { lines: lines as any, start: dayMs(start), end: dayMs(end) }
      : "skip",
  );
  const details = lines.map((l) => ({
    ...data?.items.find((i) => i.listingId === l.listingId),
    ...preview?.lines.find((i) => i.listingId === l.listingId),
    ...l,
    title:
      data?.items.find((i) => i.listingId === l.listingId)?.title ??
      catalog?.find((i) => i._id === l.listingId)?.title ??
      "Item",
  }));
  async function persist(sharing = false) {
    if (!account.token) return;
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const id = await save({
        token: account.token,
        planId: !shareKey ? (planId as any) : undefined,
        title,
        lines: lines as any,
        ...(datesOK ? { start: dayMs(start), end: dayMs(end) } : {}),
      });
      if (sharing) {
        const key = await share({
          token: account.token,
          planId: id,
          enabled: true,
        });
        setNotice(`${location.origin}/kit/${key}`);
      } else {
        setNotice("Shoot list saved.");
        if (!planId) router.replace(`/plan?plan=${id}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function book() {
    if (!preview?.available) return;
    if (cart.items.length && !replaceReady) {
      setReplaceReady(true);
      return;
    }
    cart.replace(expandKitCart(preview.lines));
    router.push("/cart");
  }
  const privateLogin = !shareKey && !account.me;
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-4xl px-6 py-12">
        <Link
          href={shareKey ? "/gear" : "/account#plans"}
          className="text-xs text-white/45"
        >
          ← {shareKey ? "Browse gear" : "Shoot lists"}
        </Link>
        <p className="hud-label mt-8">
          {shareKey
            ? "Shared kit quote"
            : bookingId
              ? "Book the whole kit again"
              : recoveryId
                ? "Resume your checkout"
                : "Shoot planner"}
        </p>
        {privateLogin ? (
          <section className="mt-6 rounded-2xl border border-white/10 p-8">
            <h1 className="font-display text-2xl text-white">
              Sign in to open your kit
            </h1>
            <p className="mt-3 text-sm text-white/50">
              Your saved kit is private. Sign in, then return to this page.
            </p>
            <Link href="/account" className="btn-primary mt-5 px-5 py-3">
              Sign in
            </Link>
          </section>
        ) : data === null ? (
          <p className="mt-8 text-white/55">
            This kit is unavailable. Its link may have expired or sharing was
            revoked.
          </p>
        ) : data === undefined ? (
          <p className="mt-8 text-white/40">Loading your kit…</p>
        ) : (
          <>
            <h1 className="mt-3 font-display text-3xl text-white">
              {title || data.title}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/45">
              Choose dates for the whole kit. This is a live estimate; stock,
              discounts, security and delivery are confirmed at checkout.
              Account credit is applied there.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
              <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                <RentalKit items={details as any} />
                <div className="mt-5 divide-y divide-white/10">
                  {details.map((l, i) => (
                    <div
                      key={l.listingId}
                      className="flex items-center gap-3 py-3"
                    >
                      <span className="min-w-0 flex-1 text-sm text-white/70">
                        {l.title}
                      </span>
                      <input
                        aria-label={`Quantity for ${l.title}`}
                        type="number"
                        min={1}
                        max={20}
                        value={l.qty}
                        onChange={(e) => {
                          setReplaceReady(false);
                          setLines((prev) =>
                            prev.map((x, j) =>
                              j === i
                                ? { ...x, qty: Number(e.target.value) }
                                : x,
                            ),
                          );
                        }}
                        className="input w-16 text-sm"
                      />
                      <button
                        aria-label={`Remove ${l.title}`}
                        onClick={() => {
                          setReplaceReady(false);
                          setLines((prev) => prev.filter((_, j) => i !== j));
                        }}
                        className="text-xs text-white/35"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <select
                    aria-label="Add gear to shoot list"
                    value={addId}
                    onChange={(e) => setAddId(e.target.value)}
                    className="input min-w-0 flex-1 text-sm"
                  >
                    <option value="">Add gear…</option>
                    {catalog
                      ?.filter((l) => !lines.some((x) => x.listingId === l._id))
                      .map((l) => (
                        <option key={l._id} value={l._id}>
                          {l.title}
                        </option>
                      ))}
                  </select>
                  <button
                    disabled={!addId || lines.length >= 50}
                    onClick={() => {
                      setLines((prev) => [
                        ...prev,
                        { listingId: addId, qty: 1 },
                      ]);
                      setAddId("");
                      setReplaceReady(false);
                    }}
                    className="rounded-full border border-white/15 px-4 text-sm text-white/65 disabled:opacity-30"
                  >
                    Add
                  </button>
                </div>
              </section>
              <aside className="self-start rounded-2xl border border-white/10 p-5">
                <label className="block text-xs text-white/45">
                  Pickup date
                  <input
                    type="date"
                    aria-label="Pickup date"
                    min={today()}
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value);
                      setReplaceReady(false);
                    }}
                    className="input mt-2 w-full text-sm"
                  />
                </label>
                <label className="mt-4 block text-xs text-white/45">
                  Return date
                  <input
                    type="date"
                    aria-label="Return date"
                    min={start || today()}
                    value={end}
                    onChange={(e) => {
                      setEnd(e.target.value);
                      setReplaceReady(false);
                    }}
                    className="input mt-2 w-full text-sm"
                  />
                </label>
                <div className="mt-6 border-t border-white/10 pt-5">
                  <p className="text-xs text-white/40">
                    Current rental estimate
                  </p>
                  <p className="mt-1 text-3xl font-medium text-white">
                    {preview?.lines.length
                      ? `£${preview.subtotal.toFixed(2)}`
                      : "—"}
                  </p>
                  <p
                    className={`mt-3 text-xs leading-5 ${preview?.available ? "text-emerald-300" : "text-white/50"}`}
                  >
                    {!datesOK
                      ? "Choose upcoming pickup and return dates."
                      : !validLines
                        ? "Choose valid item quantities."
                        : !preview
                          ? "Checking stock and prices…"
                          : preview.available
                            ? "Whole kit available for these dates"
                            : preview.issue}
                  </p>
                </div>
                {replaceReady && (
                  <p
                    role="alert"
                    className="mt-4 text-xs leading-5 text-amber-200"
                  >
                    This will replace the {cart.count} items in your current
                    basket with this whole kit.
                  </p>
                )}
                <button
                  disabled={!preview?.available}
                  onClick={book}
                  className="btn-primary mt-5 w-full justify-center px-4 py-3 disabled:opacity-35"
                >
                  {replaceReady ? "Replace basket & continue" : "Use this kit"}
                </button>
                {replaceReady && (
                  <button
                    onClick={() => setReplaceReady(false)}
                    className="mt-3 w-full text-xs text-white/50"
                  >
                    Keep current basket
                  </button>
                )}
                <p className="mt-3 text-xs leading-5 text-white/35">
                  Not reserved. Refundable security payment, card hold and
                  delivery are separate.
                </p>
              </aside>
            </div>
            <section className="mt-6 rounded-2xl border border-white/10 p-5">
              <h2 className="font-medium text-white">
                {shareKey ? "Save your own copy" : "Save & share"}
              </h2>
              {account.me ? (
                <div className="mt-3 flex flex-wrap gap-3">
                  <input
                    aria-label="Shoot list title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={80}
                    className="input min-w-0 flex-1 text-sm"
                  />
                  <button
                    disabled={busy || !validLines}
                    onClick={() => persist()}
                    className="rounded-full border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-40"
                  >
                    Save list
                  </button>
                  <button
                    disabled={busy || !validLines}
                    onClick={() => persist(true)}
                    className="rounded-full border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-40"
                  >
                    Save & share quote
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-sm text-white/45">
                  <Link className="underline" href="/account">
                    Sign in
                  </Link>{" "}
                  to save a copy to your account.
                </p>
              )}
              {err && (
                <p role="alert" className="mt-3 text-xs text-rose-300">
                  {err}
                </p>
              )}
              {notice && (
                <div
                  role="status"
                  className="mt-3 flex flex-wrap gap-3 text-xs text-white/65"
                >
                  {notice.startsWith("http") ? (
                    <>
                      <a className="break-all underline" href={notice}>
                        {notice}
                      </a>
                      <button
                        onClick={() =>
                          navigator.clipboard
                            .writeText(notice)
                            .catch(() =>
                              setErr(
                                "Copy failed. Select and copy the link above.",
                              ),
                            )
                        }
                      >
                        Copy link
                      </button>
                    </>
                  ) : (
                    notice
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
