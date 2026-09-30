"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalAdditionApproval } from "./RentalAdditionApproval";
import { RENTAL_STAGE_LABELS } from "@/lib/rentalPresentation";

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
    lastRead.current = "";
  }, [bookingId]);
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
  const messages = [
    ...new Map(
      [...history, ...(thread?.page ?? [])].map((m) => [m._id, m]),
    ).values(),
  ].sort((a, b) => a.at - b.at);
  return (
    <section
      ref={container}
      className="flex min-h-[450px] sm:min-h-[540px] flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[#131313]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent-500/15 font-display font-bold text-accent-300">
            G
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">
              {title}
            </h3>
            <p className="mt-1 text-xs text-white/40">
              {RENTAL_STAGE_LABELS[stage] ?? stage} ·{" "}
              {(thread?.escalated ?? escalated)
                ? "Team conversation"
                : "Gaffer is here"}
            </p>
          </div>
        </div>
        <button
          onClick={handoff}
          className="shrink-0 rounded-full border border-white/10 px-3 py-2 text-xs text-white/60 hover:text-white"
        >
          {admin
            ? (thread?.escalated ?? escalated)
              ? "Hand to Gaffer"
              : "Take over"
            : "Ask the team"}
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
                    ? "Rental update"
                    : admin
                      ? "Renter"
                      : "You";
            return (
              <div
                key={m._id}
                data-message-id={m._id}
                className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[80%] ${mine ? "bg-accent-500 text-white" : m.sender === "system" ? "border border-white/[0.06] bg-white/[0.025] text-white/55" : "bg-white/[0.065] text-white/85"}`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  {m.meta?.kind === "paylink" && (
                    <a
                      href={m.meta.url}
                      className="mt-3 inline-block rounded-full border border-current/20 px-3 py-1 text-xs"
                    >
                      Review payment · £{m.meta.amount}
                    </a>
                  )}
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
