"use client";

import { useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import type { Id } from "@cvx/_generated/dataModel";
import { SmartImage } from "@/components/SmartImage";

type ListingChoice = {
  _id: Id<"listings">;
  title: string;
  slug: string;
  heroImage: string | null;
  imageSources: string[];
  bookable: boolean;
  displayOnly: boolean;
};

function secureShareKey() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function dayStart(value: string) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

export function AdminCheckoutBasket({
  token,
  accountId,
  bookingId,
  email,
}: {
  token: string;
  accountId: Id<"accounts">;
  bookingId?: Id<"bookings">;
  email: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [selected, setSelected] = useState<ListingChoice[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [delivery, setDelivery] = useState<"chat" | "email" | "both">("chat");
  const shareKeyRef = useRef<string | null>(null);
  const [shareCreated, setShareCreated] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<boolean | null>(null);
  const [emailUncertain, setEmailUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listings = useQuery(api.catalog.adminListListings, {
    token,
    search: search.trim() || undefined,
    paginationOpts: { numItems: 12, cursor },
  });
  const share = useAction(api.checkoutCarts.adminShare);
  const hasBothDates = !!startDate && !!endDate;
  const invalidDates = hasBothDates && endDate < startDate;
  const locked = shareCreated && emailSent === false;

  function clearShareAttempt() {
    shareKeyRef.current = null;
    setShareCreated(false);
    setShareUrl(null);
    setEmailSent(null);
    setEmailUncertain(false);
    setError(null);
  }

  function toggleListing(listing: ListingChoice) {
    setSelected(current => current.some(item => item._id === listing._id)
      ? current.filter(item => item._id !== listing._id)
      : [...current, listing]);
    clearShareAttempt();
  }

  function changeSearch(value: string) {
    setSearch(value);
    setCursor(null);
    setCursorHistory([]);
  }

  function nextPage() {
    if (!listings || listings.isDone) return;
    setCursorHistory(current => [...current, cursor]);
    setCursor(listings.continueCursor);
  }

  function previousPage() {
    if (!cursorHistory.length) return;
    setCursor(cursorHistory.at(-1) ?? null);
    setCursorHistory(current => current.slice(0, -1));
  }

  async function sendBasket() {
    if (busy || !selected.length || invalidDates || !!startDate !== !!endDate) return;
    setBusy(true);
    setError(null);
    const key = shareKeyRef.current ?? secureShareKey();
    shareKeyRef.current = key;
    try {
      const result = await share({
        token,
        accountId,
        bookingId,
        email,
        shareKey: key,
        delivery,
        lines: selected.map(item => ({
          listingId: item._id,
          ...(hasBothDates ? { start: dayStart(startDate), end: dayStart(endDate) } : {}),
        })),
      });
      setShareCreated(true);
      setShareUrl(result.url);
      setEmailSent(result.emailSent);
      setEmailUncertain(!!result.emailUncertain);
      if (result.emailSent === false) {
        setDelivery("email");
        setError(result.emailUncertain ? "Email delivery is unclear. Check the email thread before sending again." : result.chatSent ? "Sent in chat. The email didn’t go through—retry or copy the link." : "The email didn’t go through—retry or copy the link.");
      } else {
        setOpen(false);
        setSelected([]);
        setStartDate("");
        setEndDate("");
        shareKeyRef.current = null;
        setShareCreated(false);
        setShareUrl(null);
        setEmailSent(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the checkout link.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!shareUrl || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setError("Link copied.");
    } catch {
      setError("Could not copy the link. Retry the email or open it from the chat.");
    }
  }

  function close() {
    if (busy) return;
    setOpen(false);
    if (shareCreated && emailSent === false) return;
    shareKeyRef.current = null;
    setShareCreated(false);
    setShareUrl(null);
    setEmailSent(null);
  }

  return <>
    <button
      type="button"
      data-testid="admin-build-checkout-cart"
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
      className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-accent-200/25 bg-accent-200/[.09] px-3 text-xs font-medium text-accent-100 transition hover:border-accent-100/45 hover:bg-accent-200/[.14] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-200"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M10 3v14M3 10h14" /></svg>
      Build kit link
    </button>
    {open && <dialog
      open
      aria-modal="true"
      aria-labelledby="admin-checkout-basket-title"
      data-testid="admin-checkout-basket-dialog"
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}
      className="fixed inset-0 z-[120] m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto border-0 bg-black/70 p-4 text-white backdrop-blur-md backdrop:bg-black/70 sm:grid sm:place-items-center sm:p-6"
    >
      <section className="mx-auto my-4 w-full max-w-3xl overflow-hidden rounded-[26px] border border-white/10 bg-[linear-gradient(145deg,rgba(43,39,34,.98),rgba(19,20,20,.99)_54%,rgba(15,16,17,.98))] shadow-[0_30px_100px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.07)]">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <div><p className="text-[10px] uppercase tracking-[.18em] text-accent-200/70">Customer checkout</p><h2 id="admin-checkout-basket-title" className="mt-1 font-display text-xl text-white">Build a kit link</h2><p className="mt-1 text-xs text-white/45">Choose gear, then share it in chat or by email.</p></div>
          <button type="button" onClick={close} disabled={busy} aria-label="Close kit builder" className="rounded-full border border-white/10 px-3 py-1 text-white/60 hover:bg-white/5">×</button>
        </header>
        {shareCreated && emailSent === false ? <div className="space-y-4 p-5 sm:p-6">
          <p role="status" className="rounded-2xl border border-amber-200/15 bg-amber-100/[.05] p-4 text-sm text-amber-50/80">{error}</p>
          <div className="flex flex-wrap gap-2">{!emailUncertain && <button type="button" onClick={() => void sendBasket()} disabled={busy} className="btn-primary px-4 py-2 text-xs">{busy ? "Retrying…" : "Retry email"}</button>}<button type="button" onClick={() => void copyLink()} className="rounded-xl border border-white/12 px-4 py-2 text-xs text-white/70 hover:bg-white/5">Copy checkout link</button><button type="button" onClick={close} className="rounded-xl px-4 py-2 text-xs text-white/55">Close</button></div>
        </div> : <div className="grid gap-5 p-5 sm:grid-cols-[1.1fr_.9fr] sm:p-6">
          <section className="min-w-0">
            <label className="block text-xs text-white/55">Find gear<input autoFocus aria-label="Find gear" value={search} maxLength={96} onChange={event => changeSearch(event.target.value)} placeholder="Search the live catalogue…" className="input mt-2 w-full" /></label>
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1" aria-label="Catalogue results">
              {listings === undefined ? <p className="rounded-xl border border-white/10 p-4 text-xs text-white/45" role="status">Loading listings…</p>
                : listings.page.length ? listings.page.map(listing => {
                  const choice: ListingChoice = { _id: listing._id, title: listing.title, slug: listing.slug, heroImage: listing.heroImage, imageSources: listing.imageSources ?? [], bookable: listing.bookable, displayOnly: listing.displayOnly };
                  const included = selected.some(item => item._id === choice._id);
                  const selectable = choice.bookable && !choice.displayOnly;
                  return <article key={choice._id} className={`flex items-center gap-3 rounded-2xl border p-2.5 transition ${included ? "border-accent-200/30 bg-accent-200/[.06]" : "border-white/[.08] bg-black/15"}`}>
                    <SmartImage fit="cover" src={choice.heroImage} fallbackSources={choice.imageSources} alt="" className="h-14 w-16 shrink-0 rounded-xl bg-white/[.035]" />
                    <div className="min-w-0 flex-1"><h3 className="line-clamp-2 text-xs leading-snug text-white/85">{choice.title}</h3>{!selectable && <p className="mt-1 text-[10px] text-white/35">Not bookable</p>}</div>
                    <button type="button" disabled={!selectable || locked} onClick={() => toggleListing(choice)} className="shrink-0 rounded-full border border-white/12 px-3 py-1.5 text-[11px] text-white/75 transition hover:border-accent-100/30 hover:bg-accent-100/[.08] disabled:cursor-not-allowed disabled:opacity-35">{included ? "Remove" : "Add"}</button>
                  </article>;
                }) : <p className="rounded-xl border border-white/10 p-4 text-xs text-white/45">No matching listings.</p>}
            </div>
            {listings && (cursorHistory.length > 0 || !listings.isDone) && <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-white/40"><button type="button" aria-label="Previous catalogue page" onClick={previousPage} disabled={!cursorHistory.length} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-35">← Previous</button><span>Page {cursorHistory.length + 1}</span><button type="button" aria-label="Next catalogue page" onClick={nextPage} disabled={listings.isDone} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-35">Next →</button></div>}
          </section>
          <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[.025] p-4">
            <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-white/90">Your kit</h3><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/45">{selected.length} item{selected.length === 1 ? "" : "s"}</span></div>
            {selected.length ? <div className="mt-3 space-y-2">{selected.map(item => <div key={item._id} className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-black/15 p-2">
              <SmartImage fit="cover" src={item.heroImage} fallbackSources={item.imageSources} alt="" className="h-10 w-12 shrink-0 rounded-lg bg-white/[.03]" />
              <p className="min-w-0 flex-1 line-clamp-2 text-[11px] leading-snug text-white/70">{item.title}</p>
              <button type="button" disabled={locked} onClick={() => toggleListing(item)} aria-label={`Remove ${item.title}`} className="px-1 text-white/40 hover:text-white">×</button>
            </div>)}</div> : <p className="mt-3 rounded-xl border border-dashed border-white/10 p-4 text-xs text-white/40">Add listings from the catalogue.</p>}
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-xs font-medium text-white/75">Dates <span className="font-normal text-white/35">· optional</span></p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[10px] text-white/45">First day<input type="date" aria-label="Kit start date" value={startDate} disabled={locked} max={endDate || undefined} onChange={event => { setStartDate(event.target.value); clearShareAttempt(); }} className="input mt-1 w-full text-xs" /></label>
                <label className="text-[10px] text-white/45">Last day<input type="date" aria-label="Kit return date" value={endDate} disabled={locked} min={startDate || undefined} onChange={event => { setEndDate(event.target.value); clearShareAttempt(); }} className="input mt-1 w-full text-xs" /></label>
              </div>
              {!!startDate !== !!endDate && <p role="alert" className="mt-2 text-[10px] text-amber-200">Choose both dates, or leave both blank.</p>}
              {invalidDates && <p role="alert" className="mt-2 text-[10px] text-amber-200">Return must be on or after the first day.</p>}
              <p className="mt-2 text-[10px] leading-relaxed text-white/35">Exact times, delivery and payment are completed at checkout. The kit link does not reserve stock.</p>
            </div>
            <fieldset className="mt-4 space-y-2" disabled={locked}>
              <legend className="text-xs font-medium text-white/75">Send to {email}</legend>
              {([["chat", "Chat"], ["email", "Email"], ["both", "Both"]] as const).map(([value, label]) => <label key={value} className="flex cursor-pointer items-center gap-2 text-xs text-white/65"><input type="radio" name="checkout-cart-delivery" value={value} checked={delivery === value} onChange={() => setDelivery(value)} className="accent-[#d8ad82]" />{label}</label>)}
            </fieldset>
            {error && !locked && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
            <button type="button" data-testid="admin-send-checkout-cart" onClick={() => void sendBasket()} disabled={busy || !selected.length || invalidDates || (!!startDate !== !!endDate)} className="btn-primary mt-4 w-full py-2.5 text-xs disabled:opacity-45">{busy ? "Preparing…" : delivery === "chat" ? "Send in chat" : delivery === "email" ? "Email checkout link" : "Send to chat + email"}</button>
          </section>
        </div>}
      </section>
    </dialog>}
  </>;
}
