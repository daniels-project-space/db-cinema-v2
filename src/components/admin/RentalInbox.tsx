"use client";
import { formatGbp } from "@/lib/pricing";
import { RentalKit } from "@/components/rentals/RentalKit";
import { RentalOrderTools } from "./RentalOrderTools";
import { AdminDroneLicence } from "@/components/rentals/DroneLicence";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, usePaginatedQuery, useMutation, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import chatStyles from "@/components/rentals/RentalConversation.module.css";
import { RentalConversation } from "@/components/rentals/RentalConversation";
import { SmartImage } from "@/components/SmartImage";
import { ownerConversationUrl } from "../../../shared/ownerConversationRoute";
import { rentalStageLabel } from "../../../shared/rentalReadiness";
import {
  rentalTitle,
  rentalDate,
  RENTAL_STAGES,
  RENTAL_STAGE_LABELS,
} from "@/lib/rentalPresentation";

function emailDate(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return "Time unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function EmailConversationPanel({
  token,
  threadId,
  onOpenRenterChat,
}: {
  token: string;
  threadId: any;
  onOpenRenterChat: (accountId: string) => void;
}) {
  const data = useQuery(api.emailInbox.adminThread, { token, threadId });
  const sendOwnerReply = useAction(api.emailInbox.sendOwnerReply);
  const markRead = useMutation(api.emailInbox.markRead);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const replyConfigured = data?.authorized === true && data.replyConfigured === true;
  const thread = data?.authorized ? data.thread : null;
  const messages = data?.authorized ? data.messages : [];

  useEffect(() => {
    if (!thread || !thread.unreadOwner) return;
    void markRead({ token, threadId }).catch(() => {
      setError("This email opened, but its unread marker could not be cleared.");
    });
  }, [thread?.unreadOwner, threadId, token, markRead]);

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await sendOwnerReply({ token, threadId, text });
      if (!result.ok) throw new Error(result.busy ? "A reply is already being sent. Wait a moment and refresh." : "The email reply could not be sent.");
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The email reply could not be sent.");
    } finally {
      setSending(false);
    }
  }

  if (data === undefined) {
    return <div className="flex min-h-[450px] items-center justify-center rounded-3xl border border-sky-300/15 text-sm text-sky-100/50">Opening email…</div>;
  }
  if (!data.authorized || !thread) {
    return <div className="flex min-h-[450px] items-center justify-center rounded-3xl border border-rose-300/15 text-sm text-rose-100/60">This email thread is unavailable.</div>;
  }

  return (
    <section aria-label="Email conversation" className="flex min-h-[600px] flex-col overflow-hidden rounded-3xl border border-sky-300/15 bg-slate-950/70">
      <header className="border-b border-sky-300/10 bg-sky-400/[0.06] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-300/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-100">
              <span aria-hidden="true">✉</span> Email
            </div>
            <h3 className="break-words text-lg font-semibold text-white">{thread.subject || "Customer email"}</h3>
            <p className="mt-1 break-all text-xs text-white/55">{thread.name ? `${thread.name} · ` : ""}{thread.email}</p>
            {thread.status === "human_requested" && <p role="status" className="mt-3 inline-flex rounded-full border border-rose-300/25 bg-rose-300/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-100">Human requested · urgent</p>}
          </div>
          {thread.accountId && (
            <button type="button" onClick={() => onOpenRenterChat(String(thread.accountId))} className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2 text-xs text-emerald-100/80 hover:bg-emerald-300/[0.12]">
              Open renter chat
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
        {!messages.length && <p className="text-sm text-white/40">No messages in this email thread.</p>}
        {messages.map((message: any) => {
          const fromCustomer = message.direction === "in";
          return (
            <article key={message._id} className={`max-w-[92%] rounded-2xl border p-4 ${fromCustomer ? "mr-auto border-white/[0.08] bg-white/[0.035]" : "ml-auto border-sky-300/15 bg-sky-300/[0.07]"}`}>
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-white/45">
                <span className={fromCustomer ? "text-white/70" : "text-sky-100/80"}>{fromCustomer ? (thread.name || thread.email) : "DB Cinema"}</span>
                <span>·</span>
                <time dateTime={new Date(message.at).toISOString()}>{emailDate(message.at)}</time>
                {message.state !== (fromCustomer ? "received" : "sent") && <span className="rounded-full bg-amber-200/10 px-2 py-0.5 text-amber-100/70">{message.state}</span>}
              </div>
              {message.subject && fromCustomer && <p className="mb-2 text-xs font-medium text-white/60">Subject: {message.subject}</p>}
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-white/85">{message.text}</p>
            </article>
          );
        })}
      </div>

      <form onSubmit={submitReply} className="border-t border-sky-300/10 bg-white/[0.02] p-4 sm:p-5">
        <label htmlFor="email-owner-reply" className="mb-2 block text-xs font-medium text-white/65">Reply by email</label>
        <textarea id="email-owner-reply" value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} maxLength={12000} disabled={!replyConfigured} placeholder={replyConfigured ? "Write an email reply…" : "Email replies are temporarily unavailable"} className="w-full resize-y rounded-2xl border border-white/10 bg-black/20 p-3 text-sm leading-6 text-white outline-none placeholder:text-white/25 focus:border-sky-300/35 disabled:cursor-not-allowed disabled:opacity-45" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-white/40">{replyConfigured ? "Replies send from dbcinemarentals@gmail.com." : "Replies are paused because the business Gmail sender is not configured."}</p>
          <button type="submit" disabled={!replyConfigured || sending || !draft.trim()} className="rounded-full bg-sky-200 px-4 py-2 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{sending ? "Sending…" : "Send email reply"}</button>
        </div>
        {error && <p role="alert" className="mt-3 text-xs leading-5 text-rose-200">{error}</p>}
      </form>
    </section>
  );
}

export function RentalInbox({
  token,
  focusBookingId,
  focusAccountId,
  focusRevision = 0,
}: {
  token: string;
  focusBookingId?: string | null;
  focusAccountId?: string | null;
  focusRevision?: number;
}) {
  const [stage, setStage] = useState(focusAccountId ? "general" : "all"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(focusBookingId ?? focusAccountId ?? null);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const isEmailStage = stage === "emails";
  const emailInbox = useQuery(api.emailInbox.adminInbox, { token, limit: 100 });
  const emailItems = emailInbox?.authorized ? emailInbox.items : [];
  const emailUnread = emailItems.reduce((count, thread) => count + (thread.unreadOwner ?? 0), 0);
  const rentals = usePaginatedQuery(
    api.rentalChat.adminPage,
    stage === "general" || isEmailStage
      ? "skip"
      : { token, stage: stage === "all" ? undefined : stage },
    { initialNumItems: 50 },
  );
  const support = usePaginatedQuery(
    api.rentalChat.generalOwnerPage,
    stage === "general" ? { token } : "skip",
    { initialNumItems: 50 },
  );
  const {
    results: rows,
    status,
    loadMore,
  } = stage === "general" ? support : rentals;
  const unread =
    useQuery(api.rentalChat.unreadTotals, { token, admin: true }) ?? 0;
  const counts = useQuery(api.rentalChat.unreadBreakdown, {
    token,
    admin: true,
  });
  const notifications = useQuery(api.adminNotifications.latest, { token }) ?? [];
  const acknowledge = useMutation(api.adminNotifications.acknowledge);
  const [showAttention, setShowAttention] = useState(false);
  const [pendingAttention,setPendingAttention]=useState<{id:any;target:string;general:boolean}|null>(null);
  const [attentionError,setAttentionError]=useState("");
  const [navigationRevision,setNavigationRevision]=useState(0);
  const [ping, setPing] = useState(false);
  const previous = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    setPing(localStorage.getItem("dbc_chat_pings") === "true");
  }, []);
  useEffect(() => {
    if (focusBookingId) {
      setSelected(focusBookingId);
      setSelectedEmail(null);
      setStage("all");
      setSearch("");
    } else if (focusAccountId) {
      setSelected(focusAccountId);
      setSelectedEmail(null);
      setStage("general");
      setSearch("");
    }
  }, [focusBookingId, focusAccountId, focusRevision]);
  useEffect(() => {
    if (!ping) return;
    const unlock = () => {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [ping]);

  useEffect(() => {
    if (
      previous.current !== null &&
      unread > previous.current &&
      ping &&
      audio.current
    ) {
      const oscillator = audio.current.createOscillator(),
        gain = audio.current.createGain();
      oscillator.connect(gain);
      gain.connect(audio.current.destination);
      oscillator.frequency.value = 720;
      gain.gain.setValueAtTime(0.06, audio.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audio.current.currentTime + 0.2,
      );
      oscillator.start();
      oscillator.stop(audio.current.currentTime + 0.2);
    }
    previous.current = unread;
  }, [unread, ping]);
  const direct = useQuery(
    api.rentalChat.getConversation,
    selected && stage !== "general"
      ? { token, bookingId: selected as any, admin: true }
      : "skip",
  );
  const generalDirect = useQuery(api.rentalChat.getGeneralConversation,
    selected && stage === "general" ? { token, accountId: selected as any } : "skip");
  const selectedConversation=stage==="general"?generalDirect:direct;
  useEffect(()=>{
    if(!pendingAttention)return;
    if(selected!==pendingAttention.target || (stage==="general")!==pendingAttention.general){setPendingAttention(null);return;}
    if(selectedConversation===null){setAttentionError("This conversation is unavailable. The notification remains unread.");setPendingAttention(null);return;}
    if(selectedConversation?._id!==pendingAttention.target)return;
    let current=true;
    void acknowledge({token,id:pendingAttention.id}).then(()=>{
      if(current)setPendingAttention(null);
    }).catch(()=>{
      if(current){setAttentionError("The conversation opened, but the notification could not be marked read. Please retry.");setPendingAttention(null);}
    });
    return()=>{current=false;};
  },[pendingAttention,selected,stage,selectedConversation?._id,selectedConversation===null,acknowledge,token]);
  const visible = rows
    .filter(
      (r) =>
        (!isEmailStage && (stage === "all" ||
          stage === "general" ||
          (stage === "unread" && r.unreadOwner > 0) ||
          r.status === stage)) &&
        (!search ||
          `${r.guestEmail} ${r.name} ${r.items.map((li: any) => li.title).join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    )
    .sort(
      (a, b) =>
        Number(b.unreadOwner > 0) - Number(a.unreadOwner > 0) ||
        b.updatedAt - a.updatedAt,
    );
  const visibleEmails = emailItems
    .filter((thread) => !search || `${thread.email} ${thread.name ?? ""} ${thread.subject} ${thread.lastText}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number((b.unreadOwner ?? 0) > 0) - Number((a.unreadOwner ?? 0) > 0) || b.updatedAt - a.updatedAt);
  const focus = selected
      ? (rows.find((r) => r._id === selected) ?? (stage === "general" ? generalDirect : direct))
    : visible[0];
  const selectedAny = isEmailStage ? !!selectedEmail : !!selected;
  return (
    <section id="messages" className={chatStyles.inboxScreen}>
      <div className={chatStyles.inbox}>
        <aside className={chatStyles.directory} data-conversation-open={!!selected} aria-label="Rental inbox navigation">
      <div className={chatStyles.inboxHeading}>
        <div>
          <h2 className="font-display text-xl font-semibold text-white">
            Rental inbox
          </h2>
          <p className="mt-1 text-xs text-white/40">
            {unread + emailUnread ? `${unread + emailUnread} unread messages` : "You're up to date"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <button
          aria-pressed={ping}
          onClick={() => {
            const enabled = !ping;
            setPing(enabled);
            localStorage.setItem("dbc_chat_pings", String(enabled));
            if (enabled) {
              audio.current ??= new AudioContext();
              void audio.current.resume();
            }
          }}
          className={`rounded-full border px-3 py-2 text-xs ${ping ? "border-accent-400/30 text-accent-300" : "border-white/10 text-white/45"}`}
        >
          {ping ? "Pings on" : "Enable pings"}
        </button>
        </div>
      </div>
      {!!notifications.length && <div className={chatStyles.attentionPanel}>
        <button type="button" onClick={() => setShowAttention(v => !v)} aria-expanded={showAttention} aria-controls="rental-attention-list" className={chatStyles.attentionToggle}><span>Needs your attention</span><span className="rounded-full bg-[#b98160]/15 px-2 py-1">{notifications.length>=30?"30+":notifications.length}</span></button>
        {showAttention && <div id="rental-attention-list" className={chatStyles.attentionList}>{notifications.map(n => <button key={n._id} type="button" onClick={() => {
          const target=n.bookingId??n.accountId;
          setAttentionError("");setSearch("");setStage(n.bookingId?"all":"general");setSelected(target);
          setPendingAttention({id:n._id,target,general:!n.bookingId});setNavigationRevision(v=>v+1);
          window.history.replaceState(null,"",ownerConversationUrl(n.bookingId?{bookingId:n.bookingId}:{accountId:n.accountId}));
        }} aria-busy={pendingAttention?.id===n._id} className={chatStyles.attentionItem}>
          <span className="block text-xs font-medium text-white/85">{n.title} · {n.renterName}</span><span className="mt-1 block text-[10px] text-[#d7b49b]">{RENTAL_STAGE_LABELS[n.rentalStage] ?? "General support"}</span><span className="mt-2 block text-[11px] leading-5 text-white/50">{n.body}</span>
        </button>)}</div>}
      </div>}
      {attentionError && <p role="alert" className="mt-2 text-xs leading-5 text-rose-200">{attentionError}</p>}
      <div className={chatStyles.tabs}>
        {[
          ["all", "All rentals"],
          ["unread", "Unread rentals"],
          ["general", "General support"],
          ["emails", "Emails"],
          ...RENTAL_STAGES.map((s) => [s, RENTAL_STAGE_LABELS[s]]),
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={stage === key}
            onClick={() => {
              setStage(key);
              setSelected(null);
            }}
            className={`whitespace-nowrap rounded-full px-3 py-2 text-xs ${stage === key ? "bg-white text-black" : "bg-white/[0.04] text-white/45 hover:text-white"}`}
          >
            {label}
            {key === "emails" && emailUnread > 0 && <span className="ml-2 rounded-full bg-sky-300/20 px-2 py-0.5 text-sky-100">{emailUnread}</span>}
            {((key === "unread"
              ? counts?.rentals
              : key === "general"
                ? counts?.general
                : 0) ?? 0) > 0 && (
              <span className="ml-2 opacity-60">
                {key === "unread" ? counts?.rentals : counts?.general}
              </span>
            )}
          </button>
        ))}
      </div>

          <input
            aria-label={isEmailStage ? "Search email conversations" : "Search rental conversations"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isEmailStage ? "Search loaded emails" : "Search loaded conversations"}
            className="mb-3 w-full rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-sm text-white outline-none"
          />
          <div className={chatStyles.conversationList}>
            {isEmailStage && emailInbox === undefined && <p className="p-6 text-center text-sm text-white/35">Loading emails…</p>}
            {isEmailStage && emailInbox && !emailInbox.authorized && <p role="alert" className="p-6 text-center text-sm text-rose-100/60">Email inbox access is unavailable.</p>}
            {isEmailStage && visibleEmails.map((thread) => (
              <button
                key={thread._id}
                aria-current={selectedEmail === thread._id}
                onClick={() => { setSelected(null); setSelectedEmail(thread._id); }}
                className={`w-full rounded-2xl border p-3 text-left ${selectedEmail === thread._id ? "border-sky-300/35 bg-sky-300/[0.09]" : "border-sky-300/10 bg-sky-300/[0.025] hover:bg-sky-300/[0.06]"}`}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/20 bg-sky-300/[0.08] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-sky-100"><span aria-hidden="true">✉</span> Email</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {thread.status === "human_requested" && <span className="rounded-full border border-rose-300/25 bg-rose-300/[0.08] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-rose-100">Human requested · urgent</span>}
                    {(thread.unreadOwner ?? 0) > 0 && <span className="rounded-full bg-sky-200 px-2 py-0.5 text-[10px] font-semibold text-slate-950">{thread.unreadOwner}</span>}
                  </div>
                </div>
                <p className="truncate text-sm font-medium text-white/85">{thread.name || thread.email}</p>
                <p className="mt-1 truncate text-xs text-sky-100/65">{thread.subject || "Customer email"}</p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/45">{thread.lastText || "No message preview"}</p>
                <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-white/35">
                  <span>{thread.accountId ? "Renter profile linked" : "Email contact"}</span>
                  <time>{emailDate(thread.lastAt ?? thread.updatedAt)}</time>
                </div>
              </button>
            ))}
            {!isEmailStage && visible.map((r) => (
              <button
                key={r._id}
                aria-current={focus?._id === r._id}
                onClick={() => setSelected(r._id)}
                className={`rounded-2xl border p-3 text-left ${focus?._id === r._id ? "border-accent-400/25 bg-accent-500/[0.06]" : "border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04]"}`}
              >
                <div className="flex gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]">
                    <SmartImage fit="contain"
                      src={r.items[0]?.heroImage}
                      fallbackSources={r.items[0]?.imageSources}
                      alt=""
                      className="h-full w-full"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white/85">
                      {r.name || r.guestEmail || "Guest renter"}
                    </p>
                    <p className="mt-1 truncate text-xs text-white/45">
                      {rentalTitle(r.items[0]?.title ?? "General support")}
                    </p>
                  </div>
                  {r.unreadOwner > 0 && (
                    <span className="h-fit rounded-full bg-accent-500 px-2 py-0.5 text-[10px] text-white">
                      {r.unreadOwner}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-white/35">
                  <span>{r.status === "support" ? "Support" : rentalStageLabel(r)}</span>
                  <span>
                    {r.start ? rentalDate(r.start, r.end) : "Account support"}
                  </span>
                </div>
                <p className="mt-2 truncate text-xs text-white/40">
                  {r.lastMessage ??
                    (r.accountId
                      ? "Conversation ready"
                      : "Renter account not created yet")}
                </p>
              </button>
            ))}
            {!isEmailStage && status === "CanLoadMore" && (
              <button
                onClick={() => loadMore(50)}
                className="rounded-full border border-white/10 p-3 text-xs text-white/50"
              >
                Load older rentals
              </button>
            )}
            {isEmailStage && emailInbox?.authorized && !visibleEmails.length && (
              <p className="p-6 text-center text-sm text-white/30">No email conversations found.</p>
            )}
            {!isEmailStage && !visible.length && status !== "LoadingFirstPage" && (
              <p className="p-6 text-center text-sm text-white/30">
                No conversations in this stage.
              </p>
            )}
          </div>
        </aside>
        <div className={selectedAny ? "min-w-0" : "hidden min-w-0 lg:block"}>
          {selectedAny && <button
            onClick={() => {setSelected(null);setSelectedEmail(null);window.history.replaceState(null,"",ownerConversationUrl({}));}}
            className="mb-3 text-xs text-white/65 lg:hidden"
          >
            ← {isEmailStage ? "All emails" : "All rental conversations"}{notifications.length>0?` · ${notifications.length>=30?"30+":notifications.length} notifications`:""}
          </button>}
        {isEmailStage ? (
          selectedEmail ? <EmailConversationPanel token={token} threadId={selectedEmail} onOpenRenterChat={(accountId) => { setStage("general"); setSelectedEmail(null); setSelected(accountId); }} /> : (
            <div className="flex min-h-[450px] items-center justify-center rounded-3xl border border-sky-300/10 text-sm text-sky-100/35">Choose an email to read and reply.</div>
          )
        ) : focus ? (
          <>
            <RentalConversation
              key={focus._id}
              token={token}
              admin
              openRevision={focusRevision+navigationRevision}
              bookingId={focus.status === "support" ? undefined : focus._id}
              accountId={focus.accountId ?? undefined}
              title={rentalTitle(focus.items[0]?.title ?? "General support")}
              stage={focus.status}
              stageLabel={focus.status === "support" ? "Support" : rentalStageLabel(focus)}
              bookingSummary={{image: focus.items[0]?.heroImage, imageSources: focus.items[0]?.imageSources, dates: focus.start ? rentalDate(focus.start, focus.end) : "Account support", count: focus.items.length}}
              escalated={focus.escalated}
              tools={
                focus.status !== "support" ? (
                  <><div className={chatStyles.rentalContext}><p className={chatStyles.eyebrow}>{rentalStageLabel(focus)}</p><h5>{rentalDate(focus.start, focus.end)}</h5><RentalKit items={focus.items} compact expanded /><p className="mt-4 text-xs text-white/55">Rental total <strong className="float-right text-white">{formatGbp(focus.total)}</strong></p></div><details className={chatStyles.operationDetails}><summary>Manage this rental</summary><RentalOrderTools key={focus._id} token={token} bookingId={focus._id} /><AdminDroneLicence key={`licence-${focus._id}`} token={token} bookingId={focus._id} /></details></>
                ) : undefined
              }
            />
          </>
        ) : (
          <div className="flex min-h-[450px] items-center justify-center rounded-3xl border border-white/[0.06] text-sm text-white/30">
            {selected ? (stage === "general" ? generalDirect : direct) === undefined ? "Opening conversation…" : "This conversation is unavailable. Choose another conversation." : "Choose a rental to start."}
          </div>
        )}
        </div>
      </div>
    </section>
  );
}
