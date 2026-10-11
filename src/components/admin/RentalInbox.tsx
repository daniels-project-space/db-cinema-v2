"use client";
import { RentalKit } from "@/components/rentals/RentalKit";
import { RentalOrderTools } from "./RentalOrderTools";
import { AdminDroneLicence } from "@/components/rentals/DroneLicence";
import { useEffect, useRef, useState } from "react";
import { useQuery, usePaginatedQuery, useMutation } from "convex/react";
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
  const rentals = usePaginatedQuery(
    api.rentalChat.adminPage,
    stage === "general"
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
      setStage("all");
      setSearch("");
    } else if (focusAccountId) {
      setSelected(focusAccountId);
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
        (stage === "all" ||
          stage === "general" ||
          (stage === "unread" && r.unreadOwner > 0) ||
          r.status === stage) &&
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
  const focus = selected
    ? (rows.find((r) => r._id === selected) ?? (stage === "general" ? generalDirect : direct))
    : visible[0];
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
            {unread ? `${unread} unread messages` : "You're up to date"}
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
            aria-label="Search rental conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search loaded conversations"
            className="mb-3 w-full rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-sm text-white outline-none"
          />
          <div className={chatStyles.conversationList}>
            {visible.map((r) => (
              <button
                key={r._id}
                aria-current={focus?._id === r._id}
                onClick={() => setSelected(r._id)}
                className={`rounded-2xl border p-3 text-left ${focus?._id === r._id ? "border-accent-400/25 bg-accent-500/[0.06]" : "border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04]"}`}
              >
                <div className="flex gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]">
                    <SmartImage
                      src={r.items[0]?.heroImage}
                      fallbackSources={r.items[0]?.imageSources}
                      alt=""
                      className="h-full w-full"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white/85">
                      {"accountNeedsReview" in r && r.accountNeedsReview ? "Account needs review" : r.name || r.guestEmail || "Guest renter"}
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
                  {"accountNeedsReview" in r && r.accountNeedsReview ? "Associated account is unavailable" : r.lastMessage ??
                    (r.accountId
                      ? "Conversation ready"
                      : "Renter account not created yet")}
                </p>
              </button>
            ))}
            {status === "CanLoadMore" && (
              <button
                onClick={() => loadMore(50)}
                className="rounded-full border border-white/10 p-3 text-xs text-white/50"
              >
                Load older rentals
              </button>
            )}
            {!visible.length && status !== "LoadingFirstPage" && (
              <p className="p-6 text-center text-sm text-white/30">
                No conversations in this stage.
              </p>
            )}
          </div>
        </aside>
        <div className={selected ? "min-w-0" : "hidden min-w-0 lg:block"}>
          {selected && <button
            onClick={() => {setSelected(null);window.history.replaceState(null,"",ownerConversationUrl({}));}}
            className="mb-3 text-xs text-white/65 lg:hidden"
          >
            ← All rental conversations{notifications.length>0?` · ${notifications.length>=30?"30+":notifications.length} notifications`:""}
          </button>}
        {focus ? (
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
                  <><RentalOrderTools key={focus._id} token={token} bookingId={focus._id} /><AdminDroneLicence key={`licence-${focus._id}`} token={token} bookingId={focus._id} /><details className="mt-3"><summary className="cursor-pointer text-xs text-white/55">Kit · {focus.items.length} listings</summary><div className="mt-3"><RentalKit items={focus.items} compact /></div></details></>
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
