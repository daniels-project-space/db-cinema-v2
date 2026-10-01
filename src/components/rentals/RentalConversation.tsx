"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalAdditionApproval } from "./RentalAdditionApproval";
import { RENTAL_STAGE_LABELS } from "@/lib/rentalPresentation";
import { ChatAvatar, GafferIcon } from "./ChatIdentity";
import { RentalCreditOffer } from "./RentalCreditOffer";
import { BookingReview } from "@/components/account/BookingReview";

export function RentalConversation({
  token,
  bookingId,
  accountId,
  admin = false,
  title,
  stage,
  escalated = false,
  tools,
}: {
  token: string;
  bookingId?: string;
  accountId?: string;
  admin?: boolean;
  title: string;
  stage: string;
  escalated?: boolean;
  tools?: React.ReactNode;
}) {
  const thread = useQuery(api.rentalChat.messages, {
    token,
    bookingId: bookingId as any,
    accountId: accountId as any,
    admin,
    paginationOpts: { numItems: 50, cursor: null },
  });
  const [before, setBefore] = useState<string | undefined>();
  const older = useQuery(
    api.rentalChat.messages,
    before
      ? {
          token,
          bookingId: bookingId as any,
          accountId: accountId as any,
          admin,
          paginationOpts: { numItems: 50, cursor: before },
        }
      : "skip",
  );
  const [history, setHistory] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftReplies = useAction(api.gaffer.ownerDrafts);
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<{ messageId: string | null; drafts: { label: string; text: string }[] } | null>(null);
  const scope = useRef("");
  scope.current = `${bookingId ?? ""}:${accountId ?? ""}`;
  const sendRenter = useMutation(api.chat.send),
    sendOwner = useMutation(api.rentalChat.sendOwner),
    read = useMutation(api.rentalChat.markRead);
  const human = useMutation(api.chat.requestHuman),
    handler = useMutation(api.rentalChat.setHandler);
  const [visible, setVisible] = useState<string | null>(null);
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    const latest = thread?.page[0]?._id;
    let inView = false;
    const refresh = () =>
      setVisible(
        inView && document.visibilityState === "visible"
          ? (latest ?? null)
          : null,
      );
    const observer = new IntersectionObserver(
      (entries) => {
        inView = !!entries[0]?.isIntersecting;
        refresh();
      },
      { threshold: 0.1 },
    );
    const element = latest
      ? container.current?.querySelector(`[data-message-id="${latest}"]`)
      : null;
    if (element) observer.observe(element);
    else setVisible(null);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [thread?.page[0]?._id]);
  const body = useRef<HTMLDivElement>(null);
  const lastRead = useRef<string>("");
  useEffect(() => {
    setHistory([]);
    setBefore(undefined);
    setText("");
    setError(null);
    setDrafts(null);
    lastRead.current = "";
  }, [bookingId, accountId]);
  useEffect(() => {
    if (older?.page)
      setHistory((h) =>
        [
          ...new Map([...older.page, ...h].map((m) => [m._id, m])).values(),
        ].sort((a, b) => a.at - b.at),
      );
  }, [older]);
  useEffect(() => {
    const last = thread?.page[0]?._id;
    if (last && visible === last && last !== lastRead.current) {
      lastRead.current = last;
      void read({
        token,
        bookingId: bookingId as any,
        accountId: accountId as any,
        admin,
        through: last,
      }).catch(() => {
        lastRead.current = "";
      });
    }
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [thread?.page[0]?._id, bookingId, token, admin, read, visible]);
  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (admin)
        await sendOwner({
          token,
          bookingId: bookingId as any,
          accountId: accountId as any,
          text: text.trim(),
        });
      else
        await sendRenter({
          token,
          bookingId: bookingId as any,
          text: text.trim(),
        });
      setText("");
    } catch (e: any) {
      setError(e.message ?? "Message could not be sent.");
    } finally {
      setBusy(false);
    }
  }
  async function handoff() {
    setError(null);
    try {
      if (admin)
        await handler({
          token,
          bookingId: bookingId as any,
          accountId: accountId as any,
          gaffer: thread?.escalated ?? escalated,
        });
      else await human({ token, bookingId: bookingId as any });
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function suggest() {
    const requestedScope = scope.current;
    setDrafting(true);
    setError(null);
    try {
      const result = await draftReplies({ token, bookingId: bookingId as any, accountId: accountId as any });
      if (scope.current === requestedScope) setDrafts(result);
    } catch (e: any) {
      if (scope.current === requestedScope) setError(e.message ?? "Drafts unavailable.");
    } finally { setDrafting(false); }
  }
  const messages = [
    ...new Map(
      [...history, ...(thread?.page ?? [])].map((m) => [m._id, m]),
    ).values(),
  ].sort((a, b) => a.at - b.at);
  const teamHandling = thread?.escalated ?? escalated;
  return (
    <section
      ref={container}
      className="flex min-h-[450px] sm:min-h-[540px] flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[#131313]"
    >
      <header className={`flex items-center justify-between gap-3 border-b p-5 ${teamHandling ? "border-amber-300/20 bg-amber-300/[0.07]" : "border-emerald-300/20 bg-emerald-300/[0.05]"}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl font-display font-bold ${teamHandling ? "bg-amber-300/15 text-amber-200" : "bg-emerald-300/15 text-emerald-200"}`}>
            {teamHandling ? <ChatAvatar sender="owner" /> : <GafferIcon className="h-7 w-7" />}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">
              {title}
            </h3>
            <p className="mt-1 text-xs text-white/40">
              {RENTAL_STAGE_LABELS[stage] ?? stage} ·{" "}
              {teamHandling ? "Human support · team notified" : "Gaffer · automatic assistant"}
            </p>
          </div>
        </div>
        <button
          onClick={handoff}
          disabled={!admin && teamHandling}
          className={`shrink-0 rounded-full border px-3 py-2 text-xs font-medium disabled:opacity-60 ${teamHandling ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200"}`}
        >
          {admin
            ? (thread?.escalated ?? escalated)
              ? "Hand to Gaffer"
              : "Take over"
            : teamHandling ? "Team notified" : "Request a human"}
        </button>
      </header>
      {!admin && bookingId && (
        <RentalAdditionApproval token={token} bookingId={bookingId} />
      )}
      {tools && (
        <div className="border-b border-white/[0.06] px-5 py-3">{tools}</div>
      )}
      <div
        ref={body}
        className="flex h-[320px] sm:h-[440px] min-h-0 shrink-0 flex-col gap-4 overflow-y-auto px-5 py-6"
        aria-live="polite"
        aria-label="Rental conversation"
      >
        {!(older?.isDone ?? thread?.isDone ?? true) && (
          <button
            onClick={() =>
              setBefore(older?.continueCursor ?? thread?.continueCursor)
            }
            className="self-center rounded-full border border-white/10 px-4 py-2 text-xs text-white/50"
          >
            Earlier messages
          </button>
        )}
        {thread === undefined ? (
          <p className="m-auto text-sm text-white/30">Loading conversation…</p>
        ) : !messages.length ? (
          <div className="m-auto max-w-xs text-center">
            <p className="font-display text-lg text-white/85">
              A home for your rental.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/40">
              Ask about your kit, collection or return. Gaffer knows this order,
              and the team can join when needed.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = admin ? m.sender === "owner" : m.sender === "renter";
            const label =
              m.sender === "bot"
                ? "Gaffer"
                : m.sender === "owner"
                  ? "DB Cinema team"
                  : m.sender === "system"
                  ? "Automatic rental update"
                    : admin
                      ? "Renter"
                      : "You";
            return (
              <div
                key={m._id}
                data-message-id={m._id}
                data-sender={m.sender}
                className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <div className={`flex max-w-full items-start gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                <ChatAvatar key={`${m.sender}-${thread && "renter" in thread ? thread.renter?.photo : ""}`} sender={m.sender} name={thread && "renter" in thread ? thread.renter?.name : null} photo={thread && "renter" in thread ? thread.renter?.photo : null} />
                <div
                  className={`min-w-0 max-w-[calc(100%-2.5rem)] rounded-2xl border px-4 py-3 text-sm leading-relaxed ${m.sender === "bot" ? "border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-50" : m.sender === "owner" ? "border-accent-300/25 bg-accent-500/15 text-orange-50" : m.sender === "system" ? "border-dashed border-sky-200/20 bg-sky-300/[0.04] text-sky-100/70" : "border-violet-300/20 bg-violet-300/10 text-violet-50"}`}
                >
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">{label}</div>
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  {m.meta?.kind === "full_credit_offer" && !admin && <RentalCreditOffer token={token} offerId={m.meta.offerId} />}
                  {m.meta?.kind === "review_invitation" && !admin && bookingId && <BookingReview key={bookingId} bookingId={bookingId} token={token} inline />}
                  {m.meta?.kind === "paylink" && (
                    <a
                      href={m.meta.url}
                      className="mt-3 inline-block rounded-full border border-current/20 px-3 py-1 text-xs"
                    >
                      Review payment · £{m.meta.amount}
                    </a>
                  )}
                </div>
                </div>
                <span className="mt-1.5 px-1 text-[10px] text-white/30">
                  {label} ·{" "}
                  {new Date(m.at).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            );
          })
        )}
      </div>
      <footer className="border-t border-white/[0.07] p-4">
        {admin && <div className="mb-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={suggest} disabled={drafting} className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-200 disabled:opacity-50"><GafferIcon className="h-4 w-4" />{drafting ? "Drafting…" : "Suggest replies"}</button>
            {thread && "quickReplies" in thread && thread.quickReplies?.map((reply) => <button key={reply.label} type="button" onClick={() => setText(reply.text)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60">{reply.label}</button>)}
          </div>
          {drafts && drafts.messageId === (thread?.page[0]?._id ?? null) && <div className="flex snap-x gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible" aria-label="Suggested replies">
            {drafts.drafts.map((draft, index) => <button key={index} type="button" onClick={() => setText(draft.text)} className="w-[85%] shrink-0 snap-start rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] p-3 text-left sm:w-auto">
              <span className="text-xs font-medium text-emerald-200">{draft.label}</span><p className="mt-1 line-clamp-4 text-xs leading-relaxed text-white/60">{draft.text}</p><span className="mt-2 block text-[10px] text-white/30">Use draft · review before sending</span>
            </button>)}
          </div>}
        </div>}
        {error && (
          <p role="alert" className="mb-3 text-xs text-rose-300">
            {error}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex items-end gap-2"
        >
          <textarea
            aria-label="Message"
            value={text}
            maxLength={2000}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={
              admin ? "Reply to the renter…" : "Message Gaffer or the team…"
            }
            className="min-h-11 flex-1 resize-none rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-accent-400/50"
          />
          <button
            disabled={busy || !text.trim()}
            className="rounded-2xl bg-accent-500 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "…" : "Send"}
          </button>
        </form>
      </footer>
    </section>
  );
}
