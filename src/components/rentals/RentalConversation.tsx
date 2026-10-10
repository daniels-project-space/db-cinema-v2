"use client";
import styles from "./RentalConversation.module.css";
import { SmartImage } from "@/components/SmartImage";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalAdditionApproval } from "./RentalAdditionApproval";
import { RentalExtensionPanel } from "./RentalExtensionPanel";
import { RENTAL_STAGE_LABELS } from "@/lib/rentalPresentation";
import { ChatAvatar, GafferIcon } from "./ChatIdentity";
import { RentalCreditOffer } from "./RentalCreditOffer";
import { BookingReview } from "@/components/account/BookingReview";
import { RentalVerificationSummary } from "./RentalVerificationSummary";

export function RentalConversation({
  token,
  bookingId,
  accountId,
  admin = false,
  title,
  stage,
  stageLabel,
  escalated = false,
  tools,
  openRevision = 0,
  bookingSummary,
}: {
  token: string;
  bookingId?: string;
  accountId?: string;
  admin?: boolean;
  title: string;
  stage: string;
  stageLabel?: string;
  escalated?: boolean;
  tools?: React.ReactNode;
  openRevision?: number;
  bookingSummary?: { image?: string | null; imageSources?: string[]; dates: string; count: number };
}) {
  const extension = useQuery(api.rentalExtensions.state, bookingId ? {token,bookingId:bookingId as any,admin} : "skip");
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
  const scopeKey = JSON.stringify([token, admin, bookingId ?? null, accountId ?? null]);
  const scope = useRef({ key: scopeKey });
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey };
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
  }, [thread?.page[0]?._id, scopeKey]);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openRevision || !thread) return;
    const frame = requestAnimationFrame(() => {
      container.current?.scrollIntoView({ block: "start", behavior: "auto" });
      if (body.current) body.current.scrollTop = body.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [openRevision, bookingId, accountId, thread !== undefined]);
  const lastRead = useRef<string>("");
  useEffect(() => {
    setHistory([]);
    setBefore(undefined);
    setText("");
    setError(null);
    setDrafts(null);
    setBusy(false);
    setDrafting(false);
    setVisible(null);
    lastRead.current = "";
  }, [scopeKey]);
  useEffect(() => () => { scope.current = { key: scope.current.key }; }, []);
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
      const requestedScope = scope.current;
      lastRead.current = last;
      void read({
        token,
        bookingId: bookingId as any,
        accountId: accountId as any,
        admin,
        through: last,
      }).catch(() => {
        if (scope.current === requestedScope) lastRead.current = "";
      });
    }
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [thread?.page[0]?._id, bookingId, accountId, token, admin, read, visible]);
  async function submit() {
    if (!text.trim() || busy) return;
    const requestedScope = scope.current;
    const submitted = text.trim();
    setBusy(true);
    setError(null);
    try {
      if (admin)
        await sendOwner({
          token,
          bookingId: bookingId as any,
          accountId: accountId as any,
          text: submitted,
        });
      else
        await sendRenter({
          token,
          bookingId: bookingId as any,
          text: submitted,
        });
      if (scope.current === requestedScope) setText(current => current.trim() === submitted ? "" : current);
    } catch (e: any) {
      if (scope.current === requestedScope) setError(e.message ?? "Message could not be sent.");
    } finally {
      if (scope.current === requestedScope) setBusy(false);
    }
  }
  async function handoff() {
    const requestedScope = scope.current;
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
      if (scope.current === requestedScope) setError(e.message);
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
    } finally { if (scope.current === requestedScope) setDrafting(false); }
  }
  const messages = [
    ...new Map(
      [...history, ...(thread?.page ?? [])].map((m) => [m._id, m]),
    ).values(),
  ].sort((a, b) => a.at - b.at);
  const teamHandling = thread?.escalated ?? escalated;
  const displayedStage = stageLabel ?? RENTAL_STAGE_LABELS[stage] ?? stage;
  return (
    <section
      ref={container}
      data-conversation-scope={bookingId ? `rental:${bookingId}` : `support:${accountId ?? "self"}`}
      data-role={admin ? "admin" : "renter"}
      className={`${styles.conversation} ${tools ? styles.withTools : ""}`}
    >
      <header className={styles.header}>
        <div className={styles.identity}>
          <ChatAvatar sender={admin ? "renter" : "owner"} name={thread && "renter" in thread ? thread.renter?.name : null} photo={thread && "renter" in thread ? thread.renter?.photo : null} />
          <div><p className={styles.eyebrow}>{admin ? "Rental conversation" : "Your rental team"}</p>
            <h3>{admin ? thread && "renter" in thread ? thread.renter?.name || "Guest renter" : thread === undefined ? "Loading conversation…" : "Customer account unavailable" : "DB Cinema Rentals"}</h3>
            <p className={styles.supportStatus}><span />{teamHandling ? "Team handling your conversation" : "Gaffer available · team can join"}</p>
          </div>
        </div>
        <button onClick={handoff} disabled={!admin && teamHandling} className={styles.handoff}>
          {admin ? teamHandling ? "Hand to Gaffer" : "Take over" : teamHandling ? "Team notified" : "Request a human"}
        </button>
      </header>
      <div className={`management-conversation-main ${styles.main}`}>
      <div className={styles.bookingStrip}>
        {bookingSummary?.image && <SmartImage src={bookingSummary.image} fallbackSources={bookingSummary.imageSources} alt={title} className={styles.kitImage} />}
        <div><h4>{title}</h4><p>{bookingSummary ? `${bookingSummary.dates} · ${bookingSummary.count} ${bookingSummary.count === 1 ? "listing" : "listings"}` : bookingId ? "Messages, collection and return" : "Account support and enquiries"}</p></div>
        <span className={styles.stage} data-ready={["Verification approved","On hire","Returned"].includes(displayedStage)}>{displayedStage}</span>
        {!!extension?.requests.length && <button type="button" data-testid="chat-open-extension" className={styles.extensionLink} onClick={()=>{const panel=container.current?.querySelector<HTMLElement>("[data-testid=rental-extension-panel]");const disclosure=panel?.closest("details");if(disclosure)disclosure.open=true;panel?.scrollIntoView({block:"start",behavior:"auto"});panel?.focus({preventScroll:true});}}>Extension details ↗</button>}
      </div>
      {bookingId && <RentalVerificationSummary bookingId={bookingId} token={token} admin={admin} compact/>}
      {!admin && bookingId && (
        <RentalAdditionApproval token={token} bookingId={bookingId} />
      )}
      {bookingId && !tools && <RentalExtensionPanel key={bookingId} token={token} bookingId={bookingId} admin={admin} />}
      <div
        ref={body}
        className={`management-conversation-messages ${styles.messages}`}
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
          messages.map((m, index) => {
            const date = new Date(m.at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
            const previousDate = index ? new Date(messages[index - 1].at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
            const mine = admin ? m.sender === "owner" : m.sender === "renter";
            const label =
              m.sender === "bot"
                ? "Gaffer"
                : m.sender === "owner"
                  ? "DB Cinema team"
                  : m.sender === "system"
                  ? "Automatic rental update"
                    : admin
                      ? (thread && "renter" in thread ? thread.renter?.name || "Renter" : "Renter")
                      : "You";
            return (<Fragment key={m._id}>
              {date !== previousDate && <p className="management-conversation-date self-stretch text-center text-[10px] text-white/40"><span>{date}</span></p>}
              <div
                data-message-id={m._id}
                data-sender={m.sender}
                data-mine={mine}
                className={`management-conversation-message ${styles.message}`}
              >
                <div className={`management-conversation-message-row flex max-w-full items-start gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                <ChatAvatar key={`${m.sender}-${thread && "renter" in thread ? thread.renter?.photo : ""}`} sender={m.sender} name={thread && "renter" in thread ? thread.renter?.name : null} photo={thread && "renter" in thread ? thread.renter?.photo : null} />
                <div className={styles.messageContent}>
                  <div className={styles.messageMeta}><strong>{label}</strong><time dateTime={new Date(m.at).toISOString()}>{new Date(m.at).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit"})}</time></div>
                <div
                  className={`management-conversation-message-copy min-w-0 max-w-[calc(100%-2.5rem)] rounded-2xl border px-4 py-3 text-sm leading-relaxed ${m.sender === "bot" ? "border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-50" : m.sender === "owner" ? "border-accent-300/25 bg-accent-500/15 text-orange-50" : m.sender === "system" ? "border-dashed border-sky-200/20 bg-sky-300/[0.04] text-sky-100/70" : "border-violet-300/20 bg-violet-300/10 text-violet-50"}`}
                >
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
                </div>
              </div></Fragment>
            );
          })
        )}
      </div>
      <footer className={styles.composer}>
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
          className={styles.composeForm}
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
      </div>
      {tools && (
        <aside aria-label={admin ? "Rental management controls" : "Your rental details"} className={`management-conversation-tools ${styles.tools}`}><div className={styles.toolsHeading}><p className={styles.eyebrow}>{admin ? "Operations" : "Your booking"}</p><h4>{admin ? "Booking details" : "Rental details"}</h4></div>{tools}{bookingId && <details key={bookingId} className={styles.extensionDetails} data-testid="chat-extension-disclosure"><summary><span>Rental extension</span><span>{extension?.requests.length ? `${extension.requests.length} ${extension.requests.length === 1 ? "request" : "requests"}` : "Manage dates"}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 5 5-5 5" /></svg></span></summary><RentalExtensionPanel key={bookingId} token={token} bookingId={bookingId} admin={admin} /></details>}</aside>
      )}
    </section>
  );
}
