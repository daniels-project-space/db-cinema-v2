"use client";
import styles from "./RentalConversation.module.css";
import { WATERSTONES_MAP_URL } from "../../../shared/pickupLocation";
import { CHAT_IMAGE_ACCEPT, CHAT_IMAGE_HELP, CHAT_IMAGE_LIMIT, isChatImageType } from "../../../shared/chatAttachmentPolicy";
import { SmartImage } from "@/components/SmartImage";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalAdditionApproval } from "./RentalAdditionApproval";
import {RentalPricePanel} from "./RentalPricePanel";
import { RentalExtensionPanel } from "./RentalExtensionPanel";
import { rentalTitle } from "@/lib/rentalPresentation";
import { SavedCardCharges } from "./SavedCardCharges";
import { RENTAL_STAGE_LABELS } from "@/lib/rentalPresentation";
import { ChatAvatar, GafferIcon } from "./ChatIdentity";
import { RentalCreditOffer } from "./RentalCreditOffer";
import { BookingReview } from "@/components/account/BookingReview";
import { RentalVerificationSummary } from "./RentalVerificationSummary";
import { RentalDeliveryQuoteApproval } from "./RentalDeliveryQuoteApproval";
import { AttachmentAdminControls } from "./AttachmentAdminControls";
import { RentalSwapApproval } from "./RentalSwapApproval";
import { createCleanChatImage } from "@/lib/chatImageCopy";
import { HumanHandoffOffer } from "./HumanHandoffOffer";

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
  handoverDetails,
  workspaceIdentity: providedWorkspaceIdentity,
  renterWorkspace = false,
  starred = false,
  starDisabled = false,
  onStar,
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
  bookingSummary?: { items?: { title: string; qty: number; heroImage?: string | null; imageSources?: string[] }[]; dates: string; count: number };
  handoverDetails?: { phone: string; pickupAddress?: string | null; returnAddress?: string | null; pickupInstructions?: string | null; fulfilment: "pickup" | "delivery" };
  workspaceIdentity?: { name?: string | null; phone?: string | null; photo?: string | null; privatePortrait?: React.ReactNode; membershipLabel?: string | null; encoreLabel?: string | null; verified?: boolean };
  renterWorkspace?: boolean;
  starred?: boolean;
  starDisabled?: boolean;
  onStar?: () => void;
}) {
  const workspaceIdentity = admin ? providedWorkspaceIdentity : undefined;
  const thread = useQuery(api.rentalChat.messages, {
    token,
    bookingId: bookingId as any,
    accountId: accountId as any,
    admin,
    paginationOpts: { numItems: 50, cursor: null },
  });
  const renterPhone = admin ? workspaceIdentity?.phone ?? (thread && "renter" in thread ? thread.renter?.phone : null) : null;
  const dialablePhone = renterPhone?.replace(/[^\d+]/g, "");
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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const checkAttachmentsAvailability = useAction(api.chatAttachments.availability);
  const [attachmentsAvailable, setAttachmentsAvailable] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [cleanCandidate, setCleanCandidate] = useState<File | null>(null);
  const composer = useRef<HTMLElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const attachmentKeys = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      void checkAttachmentsAvailability({ token, admin, bookingId: bookingId as any, accountId: accountId as any })
        .then(ready => { if (active) setAttachmentsAvailable(ready === true); })
        .catch(() => { if (active) setAttachmentsAvailable(false); })
        .finally(() => { pending = false; });
    };
    refresh();
    const interval = window.setInterval(refresh, 5 * 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [checkAttachmentsAvailability, token, admin, bookingId, accountId]);
  useEffect(() => {
    const prefill = (event: Event) => {
      const nextText = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof nextText !== "string" || !nextText.trim()) return;
      setText(nextText.slice(0, 2000));
      requestAnimationFrame(() => composer.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    };
    window.addEventListener("dbc:prefill-rental-message", prefill);
    return () => window.removeEventListener("dbc:prefill-rental-message", prefill);
  }, []);
  useEffect(() => { if (cleanCandidate) composer.current?.scrollIntoView({ block: "end" }); }, [cleanCandidate]);
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
    resume = useMutation(api.chat.resumeGaffer),
    handler = useMutation(api.rentalChat.setHandler);
  const [handoffBusy, setHandoffBusy] = useState(false);
  useEffect(() => { setHandoffBusy(false); }, [bookingId, accountId]);
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
  const pinnedToLatest = useRef(true);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const useReply = (value: string) => {setText(value);composerInput.current?.focus();};
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
    setEmojiOpen(false);
    setError(null);
    setDrafts(null);
    setBusy(false);
    setAttachmentBusy(false);
    setCleanCandidate(null);
    attachmentKeys.current.clear();
    setDrafting(false);
    setVisible(null);
    pinnedToLatest.current = true;
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
  }, [thread?.page[0]?._id, bookingId, accountId, token, admin, read, visible]);
  useEffect(() => {
    if (pinnedToLatest.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [thread?.page[0]?._id, scopeKey]);
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
  function attachmentUrl(extra: Record<string, string>) {
    const origin = process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site");
    if (!origin) throw Error("Attachments are unavailable.");
    const params = new URLSearchParams({ ...(bookingId ? { bookingId } : {}), ...(accountId ? { accountId } : {}), ...(admin ? { admin: "1" } : {}), ...extra });
    return `${origin}/chat-attachment?${params}`;
  }
  async function uploadAttachment(file?: File, clean = false) {
    if (!file || attachmentBusy || !attachmentsAvailable) return;
    const requestedScope = scope.current;
    setAttachmentBusy(true); setError(null); setCleanCandidate(null);
    try {
      if (!file.size || file.size > CHAT_IMAGE_LIMIT || !isChatImageType(file.type)) throw Error(CHAT_IMAGE_HELP);
      const upload = clean ? await createCleanChatImage(file) : file;
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await upload.arrayBuffer()))).map(part => part.toString(16).padStart(2, "0")).join("");
      if (scope.current !== requestedScope) return;
      const fingerprint = JSON.stringify([upload.name, upload.type, digest]);
      const key = attachmentKeys.current.get(fingerprint) ?? crypto.randomUUID().replace(/-/g, "");
      attachmentKeys.current.set(fingerprint, key);
      const response = await fetch(attachmentUrl({ key }), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": upload.type, "X-Chat-Filename": encodeURIComponent(upload.name.slice(0, 120)) }, body: upload });
      if (!response.ok) throw Error(response.status === 409 ? "The file is still processing. Please try again shortly." : "The attachment could not be sent. Please try again.");
      if (scope.current === requestedScope) attachmentKeys.current.delete(fingerprint);
    } catch (e) { if (scope.current === requestedScope) { setError(e instanceof Error ? e.message : "The attachment could not be sent."); if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) setCleanCandidate(file); } }
    finally { if (scope.current === requestedScope) setAttachmentBusy(false); }
  }
  async function downloadAttachment(id: string, name: string) {
    if (attachmentBusy) return;
    const requestedScope = scope.current;
    setAttachmentBusy(true); setError(null);
    try {
      const response = await fetch(attachmentUrl({ download: id }), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw Error("The attachment is unavailable.");
      const blob = await response.blob();
      if (scope.current !== requestedScope) return;
      const objectUrl = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = objectUrl; link.download = name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) { if (scope.current === requestedScope) setError(e instanceof Error ? e.message : "The attachment is unavailable."); }
    finally { if (scope.current === requestedScope) setAttachmentBusy(false); }
  }
  async function handoff() {
    if (handoffBusy) return;
    const requestedScope = scope.current;
    setHandoffBusy(true);
    setError(null);
    try {
      if (admin)
        await handler({
          token,
          bookingId: bookingId as any,
          accountId: accountId as any,
          gaffer: thread?.escalated ?? escalated,
        });
      else if (thread?.escalated ?? escalated) await resume({ token, bookingId: bookingId as any });
      else throw Error("Gaffer must offer a team handoff before it can be requested.");
    } catch (e: any) {
      if (scope.current === requestedScope) setError(e.message);
    } finally {
      if (scope.current === requestedScope) setHandoffBusy(false);
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
  const firstRenterIndex = messages.findIndex(message => message.sender === "renter" && message.text?.trim());
  const firstGafferReply = !admin && (thread?.isDone || older?.isDone) && firstRenterIndex >= 0
    ? messages.slice(firstRenterIndex + 1).find(message => message.sender === "bot" && message.text?.trim())
    : undefined;
  const invitationId = firstGafferReply?._id ? String(firstGafferReply._id) : null;
  const invitationAccount = !admin && thread && "notificationScope" in thread ? thread.notificationScope : null;
  const [notificationDeviceStatus, setNotificationDeviceStatus] = useState<"unknown" | "active" | "inactive">("unknown");
  useEffect(() => {
    if (admin) return;
    const receive = (event: Event) => {
      const status = (event as CustomEvent).detail;
      if (status === "active" || status === "inactive" || status === "unknown") setNotificationDeviceStatus(status);
    };
    window.addEventListener("dbc:renter-notification-status", receive);
    window.dispatchEvent(new Event("dbc:request-renter-notification-status"));
    return () => window.removeEventListener("dbc:renter-notification-status", receive);
  }, [admin, token]);
  const [notificationInvitation, setNotificationInvitation] = useState<{ id: string; visible: boolean } | null>(null);
  useEffect(() => {
    if (!invitationId || !invitationAccount || notificationDeviceStatus !== "inactive") { setNotificationInvitation(null); return; }
    let dismissed = false;
    try { dismissed = localStorage.getItem("dbc_chat_notification_offer:" + invitationAccount) === "dismissed"; } catch {}
    setNotificationInvitation({ id: invitationId, visible: !dismissed });
  }, [invitationId, invitationAccount, notificationDeviceStatus]);
  useEffect(() => {
    if (notificationInvitation?.visible && pinnedToLatest.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [notificationInvitation]);
  function dismissNotificationInvitation(openSettings: boolean) {
    if (!invitationId || !invitationAccount) return;
    try { localStorage.setItem("dbc_chat_notification_offer:" + invitationAccount, "dismissed"); } catch {}
    setNotificationInvitation({ id: invitationId, visible: false });
    if (openSettings) window.dispatchEvent(new Event("dbc:open-renter-notifications"));
  }
  function openGafferGearHelp() {
    const rental = bookingId
      ? `About my rental: ${title.slice(0, 48)}${bookingSummary?.dates ? ` (${bookingSummary.dates.slice(0, 32)})` : ""}.`
      : "I'm in my account support chat.";
    const prompt = `${rental} Help me choose extra gear or answer booking questions from my account. For gear: live item cards, a quote and availability check. Ask for missing dates and pickup/return times. Don’t change a booking; a basket is not a reservation.`;
    window.dispatchEvent(new CustomEvent("dbc:open-gaffer-chat", { detail: { prompt, bookingId } }));
  }
  const teamHandling = thread?.escalated ?? escalated;
  const latestConversationMessage = [...messages].reverse().find(message => message.sender === "renter" || message.sender === "bot" || message.sender === "owner");
  const hasExtensionOffer = !admin && latestConversationMessage?.sender === "bot" && Array.isArray(latestConversationMessage.meta?.extensionOffer?.items) && latestConversationMessage.meta.extensionOffer.items.length > 0;
  const workspacePresentation = !!workspaceIdentity || (!admin && renterWorkspace);
  const replyState = thread && "replyState" in thread ? thread.replyState : null;
  return (
    <section
      ref={container}
      data-conversation-scope={bookingId ? `rental:${bookingId}` : `support:${accountId ?? "self"}`}
      data-role={admin ? "admin" : "renter"}
      className={`${styles.conversation} ${tools && admin ? styles.withTools : ""} ${workspacePresentation ? styles.workspace : ""}`}
    >
      <header className={styles.header}>
        <div className={styles.identity}>
          {workspaceIdentity ? <div className={styles.workspaceAvatar} data-testid={admin ? "admin-chat-avatar" : undefined} data-verified={workspaceIdentity.verified === true}>
            <ChatAvatar sender={admin ? "renter" : "owner"} name={workspaceIdentity.name ?? (thread && "renter" in thread ? thread.renter?.name : null)} photo={workspaceIdentity.photo ?? (thread && "renter" in thread ? thread.renter?.photo : null)} />
            {!workspaceIdentity.photo && !(thread && "renter" in thread && thread.renter?.photo) && workspaceIdentity.privatePortrait}
            {workspaceIdentity.verified && <span className={styles.verifiedCheck} role="img" aria-label="Verification current"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 8 2.5 2.5L12 5"/></svg></span>}
          </div> : admin ? <ChatAvatar sender="renter" name={thread && "renter" in thread ? thread.renter?.name : null} photo={thread && "renter" in thread ? thread.renter?.photo : null} /> : <ChatAvatar sender="owner" />}
          <div><p className={styles.eyebrow}>{admin ? "Rental conversation" : "Your rental team"}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h3 data-testid={workspaceIdentity ? "admin-chat-profile-name" : undefined}>{workspaceIdentity?.name || (admin && thread && "renter" in thread ? thread.renter?.name || "Guest renter" : "DB Cinema Rentals")}</h3>
              {admin && thread && "caseArchivedAt" in thread && thread.caseArchivedAt && <span data-testid="case-chat-archive" className="rounded-full border border-amber-200/20 bg-amber-100/[.06] px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-100/80">Case archive</span>}
              {workspaceIdentity?.phone && <span data-testid="admin-chat-phone" className={styles.workspacePhone}>{workspaceIdentity.phone}</span>}
            </div>
            {workspaceIdentity && <div className={styles.identityBadges}>{workspaceIdentity.membershipLabel && <span>{workspaceIdentity.membershipLabel}</span>}{workspaceIdentity.encoreLabel && <span>{workspaceIdentity.encoreLabel}</span>}</div>}
            {!workspaceIdentity && <p className={styles.supportStatus}><span />{teamHandling ? "Team handling your conversation" : "Gaffer available · team can join"}</p>}
            {!admin && teamHandling && <p className="mt-1 max-w-sm text-xs leading-relaxed text-white/45">The team has your enquiry. Add any other details here; replies will appear in this conversation.</p>}
          </div>
        </div>
        <div className={styles.headerActions}>{workspaceIdentity && onStar && <button type="button" onClick={onStar} disabled={starDisabled} aria-pressed={starred} aria-label={starred ? "Remove customer from starred" : "Star customer"} className={styles.starButton}><svg viewBox="0 0 24 24" fill={starred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5Z"/></svg></button>}{renterPhone && dialablePhone && /^\+?\d+$/.test(dialablePhone) && <a className={workspaceIdentity ? styles.workspaceCall : styles.phone} href={`tel:${dialablePhone}`} aria-label={`Call ${workspaceIdentity?.name || (thread && "renter" in thread ? thread.renter?.name : null) || "renter"} at ${renterPhone}`} title={renterPhone}>{workspaceIdentity ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 3h3l2 5-2 1.5a14 14 0 0 0 6.5 6.5l1.5-2 5 2v3a2 2 0 0 1-2 2C10.2 20.5 3.5 13.8 3 5a2 2 0 0 1 2-2Z" /></svg> : <>{renterPhone} <span aria-hidden="true">·</span></>}<span className={workspaceIdentity ? styles.workspaceCallLabel : undefined}>Call</span></a>}
        {workspaceIdentity ? <details className={styles.headerMenu}><summary aria-label="Conversation actions" title="Conversation actions">•••</summary><div><p>{teamHandling ? "Team handling this conversation" : "Gaffer is available"}</p><button type="button" onClick={handoff} disabled={handoffBusy} className={styles.handoff}>{handoffBusy ? "Updating…" : teamHandling ? "Hand to Gaffer" : "Take over"}</button></div></details> : (admin || teamHandling) && <button onClick={handoff} disabled={handoffBusy} className={styles.handoff}>
          {handoffBusy ? "Updating…" : admin ? teamHandling ? "Hand to Gaffer" : "Take over" : "Get back to Gaffer"}
        </button>}</div>
      </header>
      {!admin && handoverDetails && <section className={styles.handoverDetails} data-testid="renter-handover-details" aria-label="Confirmed collection and contact details">
        <div className={styles.handoverLocations}>
          {handoverDetails.pickupAddress && handoverDetails.returnAddress && handoverDetails.pickupAddress === handoverDetails.returnAddress
            ? <div><span>{handoverDetails.fulfilment === "delivery" ? "Delivery & return" : "Pickup & return"}</span><strong>{handoverDetails.pickupAddress}</strong></div>
            : <>{handoverDetails.pickupAddress && <div><span>{handoverDetails.fulfilment === "delivery" ? "Delivery to" : "Pickup"}</span><strong>{handoverDetails.pickupAddress}</strong></div>}{handoverDetails.returnAddress && <div><span>Return / drop-off</span><strong>{handoverDetails.returnAddress}</strong></div>}</>}
          {handoverDetails.pickupInstructions && <p>{handoverDetails.pickupInstructions}</p>}
        </div>
        <a href={`tel:${handoverDetails.phone.replace(/[^\d+]/g, "")}`} aria-label={`Call Leo at ${handoverDetails.phone}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 3h3l2 5-2 1.5a14 14 0 0 0 6.5 6.5l1.5-2 5 2v3a2 2 0 0 1-2 2C10.2 20.5 3.5 13.8 3 5a2 2 0 0 1 2-2Z" /></svg><span>Call Leo</span><strong>{handoverDetails.phone}</strong></a>
      </section>}
      <div className={`management-conversation-main ${styles.main}`}>
      {(!workspaceIdentity || bookingId) && <div className={styles.bookingStrip}>
        <div>{!workspaceIdentity && <h4>{title}</h4>}<p>{bookingSummary ? `${bookingSummary.dates} · ${bookingSummary.count} ${bookingSummary.count === 1 ? "listing" : "listings"}` : bookingId ? "Messages, collection and return" : "Account support and enquiries"}</p></div>
        <span className={styles.stage}>{stageLabel ?? RENTAL_STAGE_LABELS[stage] ?? stage}</span>
        {bookingId && admin && workspaceIdentity && !tools && <details className={styles.workspaceRentalDetails}><summary aria-label="Verification, extension and price controls">Controls</summary><div><RentalVerificationSummary bookingId={bookingId} token={token} admin /><RentalExtensionPanel key={bookingId} token={token} bookingId={bookingId} admin /><RentalPricePanel key={`price-${bookingId}`} token={token} bookingId={bookingId} admin /></div></details>}
      </div>}
      {!admin && <div className="mt-3 flex flex-wrap items-center gap-2">
        {!teamHandling && <button type="button" data-testid="rental-gaffer-gear-help" onClick={openGafferGearHelp} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200/20 bg-white/[0.055] px-3 text-left text-xs text-emerald-50/90 shadow-[inset_0_1px_0_#ffffff0a] backdrop-blur-xl transition hover:border-emerald-200/35 hover:bg-emerald-200/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/60">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden="true"><path d="m12 3 1.2 5.8L19 10l-5.8 1.2L12 17l-1.2-5.8L5 10l5.8-1.2L12 3Z"/><path d="m19 15 .6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6L19 15Z"/></svg>
          <span>Ask Gaffer about gear, dates or a quote</span>
        </button>}
        <button type="button" aria-label="Notification settings" className="min-h-10 rounded-xl border border-white/10 px-3 text-xs text-white/60 transition hover:border-white/20 hover:text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40" onClick={() => window.dispatchEvent(new Event("dbc:open-renter-notifications"))}><span className="hidden sm:inline">Notification settings</span><span className="sm:hidden">Alerts</span></button>
      </div>}
      {bookingId && (!admin || !tools) && !workspaceIdentity && <RentalVerificationSummary bookingId={bookingId} token={token} admin={admin}/>}
      {!admin && bookingId && (
        <RentalAdditionApproval token={token} bookingId={bookingId} />
      )}
      {bookingId && (!admin || !tools) && !workspaceIdentity && <RentalExtensionPanel key={bookingId} token={token} bookingId={bookingId} admin={admin} showTrigger={!hasExtensionOffer} />}
      {bookingId && (!admin || !tools) && !workspaceIdentity && <RentalPricePanel key={`price-${bookingId}`} token={token} bookingId={bookingId} admin={admin}/>}
      {!admin && bookingId && <SavedCardCharges token={token} bookingId={bookingId} />}
      {tools && !admin && <div className={styles.renterControls} data-testid="renter-chat-controls" aria-label="Rental actions">{tools}</div>}
      <div
        ref={body}
        className={`management-conversation-messages ${styles.messages}`}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinnedToLatest.current = element.scrollHeight - element.clientHeight - element.scrollTop < 64;
        }}
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
              {admin ? "No messages yet." : "A home for your rental."}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/40">
              {admin
                ? "Send a reply to start the conversation. Replies here stay with this renter’s account or selected rental."
                : "Ask about your kit, collection or return. Gaffer knows this order, and the team can join when needed."}
            </p>
          </div>
        ) : (
          <>
          {messages.map((m, index) => {
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
                  <p className="whitespace-pre-wrap break-words">{m.meta?.kind === "review_invitation" ? m.text.replace(/\s*\[Leave your rental review\]\([^)]*\)/, "") : m.text}</p>
                  {m.meta?.kind === "extension_request" && Array.isArray(m.meta.items) && m.meta.items.length > 0 && <section data-testid="extension-request-chat-card" aria-label="Rental extension request" className="mt-3 overflow-hidden rounded-2xl border border-sky-200/15 bg-gradient-to-br from-sky-200/[0.09] via-white/[0.035] to-transparent p-3 shadow-[inset_0_1px_0_#ffffff0b] backdrop-blur-xl">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-sky-100/55">Rental change</p><h4 className="mt-1 text-sm font-semibold text-white/90">Extension request</h4></div><span className="rounded-full border border-amber-200/15 bg-amber-200/[0.06] px-2 py-1 text-[10px] text-amber-100/75">Awaiting approval</span></div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">{m.meta.items.map((item: any, itemIndex: number) => <article key={`${m._id}-extension-request-${item.lineIndex ?? itemIndex}`} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-2">
                      <SmartImage fit="contain" src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={`${item.title} listing photo`} className="h-12 w-14 shrink-0 rounded-lg bg-white/[0.025]" />
                      <div className="min-w-0 flex-1"><p className="truncate text-xs text-white/80">{item.qty}× {rentalTitle(item.title)}</p><p className="mt-0.5 text-[10px] text-white/40">Return {new Date(item.end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · {m.meta.returnTime} London</p></div>
                    </article>)}</div>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-2"><span className="text-[11px] text-white/50">{m.meta.extraDays} extra day{m.meta.extraDays === 1 ? "" : "s"}{m.meta.benefitSaving > 0 ? ` · ${m.meta.benefitLabel} saves £${Number(m.meta.benefitSaving).toFixed(2)}` : ""}</span><strong className="text-base font-semibold text-white">£{Number(m.meta.amount).toFixed(2)}</strong></div>
                    <p className="mt-2 text-[10px] leading-relaxed text-white/40">Original return times apply until approved and paid.</p>
                  </section>}
                  {m.meta?.kind === "extension_payment" && Array.isArray(m.meta.items) && m.meta.items.length > 0 && <section data-testid="extension-payment-chat-card" aria-label="Approved rental extension payment" className="mt-3 overflow-hidden rounded-2xl border border-emerald-200/15 bg-gradient-to-br from-emerald-200/[0.09] via-white/[0.035] to-transparent p-3 shadow-[inset_0_1px_0_#ffffff0b] backdrop-blur-xl">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-100/55">Approved rental change</p><h4 className="mt-1 text-sm font-semibold text-white/90">Confirm extra time</h4></div><span className="rounded-full border border-emerald-200/15 bg-emerald-200/[0.06] px-2 py-1 text-[10px] text-emerald-100/75">Ready to pay</span></div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">{m.meta.items.map((item: any, itemIndex: number) => <article key={`${m._id}-extension-payment-${item.lineIndex ?? itemIndex}`} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-2">
                      <SmartImage fit="contain" src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={`${item.title} listing photo`} className="h-12 w-14 shrink-0 rounded-lg bg-white/[0.025]" />
                      <div className="min-w-0 flex-1"><p className="truncate text-xs text-white/80">{item.qty}× {rentalTitle(item.title)}</p><p className="mt-0.5 text-[10px] text-white/40">Return {new Date(item.end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · {m.meta.returnTime} London</p></div>
                    </article>)}</div>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-2"><span className="text-[11px] text-white/50">{m.meta.extraDays} extra day{m.meta.extraDays === 1 ? "" : "s"}{m.meta.benefitSaving > 0 ? ` · ${m.meta.benefitLabel} saves £${Number(m.meta.benefitSaving).toFixed(2)}` : ""}</span><strong className="text-base font-semibold text-white">£{Number(m.meta.amount).toFixed(2)}</strong></div>
                    <p className="mt-2 text-[10px] leading-relaxed text-white/40">Your original return time stays in place until payment succeeds. Payment link expires in 24 hours.</p>
                    {m.meta.url && <a data-testid="extension-payment-chat-link" href={m.meta.url} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-100 px-4 py-2 text-xs font-semibold text-emerald-950">Pay securely &amp; confirm</a>}
                  </section>}
                  {m.sender === "bot" && Array.isArray(m.meta?.catalogueItems) && m.meta.catalogueItems.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Gaffer gear suggestions">
                    {m.meta.catalogueItems.slice(0, 4).map((item: any) => <article key={`${m._id}-${item.slug}`} data-testid="gaffer-catalogue-card" className="min-w-0 rounded-xl border border-white/10 bg-white/[0.035] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
                      <SmartImage fit="cover" src={item.heroImage ?? item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={item.title} className="mb-3 aspect-[16/9] w-full rounded-lg" />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><span className="text-[10px] uppercase tracking-[0.16em] text-white/45">{item.category}</span><h4 className="mt-1 break-words text-sm font-medium text-white/90">{item.title}</h4></div>
                        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] ${item.availability === "available" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : item.availability === "unavailable" ? "border-amber-300/20 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/[0.04] text-white/55"}`}>
                          {item.availability === "available" ? "Open for dates" : item.availability === "unavailable" ? "No extra stock" : item.availability === "times_required" ? "Times needed" : item.availability === "dates_required" ? "Dates needed" : "Check dates"}
                        </span>
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <p className="min-w-0 text-xs text-white/55">{item.total != null ? <><strong className="text-sm font-semibold text-white/90">£{Number(item.total).toFixed(2)}</strong><span className="ml-1">for {item.days} day{item.days === 1 ? "" : "s"}</span></> : item.daily != null ? `From £${Number(item.daily).toFixed(2)} / day` : "Choose dates for a quote"}</p>
                        <a data-testid="gaffer-catalogue-card-link" href={`/gear/${encodeURIComponent(item.slug)}`} className="shrink-0 rounded-full border border-accent-300/20 bg-accent-300/[0.08] px-3 py-1.5 text-xs text-accent-100 transition hover:border-accent-200/40 hover:bg-accent-300/[0.14]">View &amp; add</a>
                      </div>
                    </article>)}
                    <p className="sm:col-span-2 text-[10px] leading-relaxed text-white/35">Availability is a live check, not a reservation. Hire-rate estimates exclude delivery and checkout adjustments.</p>
                  </div>}
                  {m.sender === "bot" && Array.isArray(m.meta?.extensionOffer?.items) && m.meta.extensionOffer.items.length > 0 && <section data-testid="gaffer-extension-card" aria-label="Extension options for your rental" className="mt-3 overflow-hidden rounded-2xl border border-sky-200/15 bg-gradient-to-br from-sky-200/[0.09] via-white/[0.035] to-transparent p-3 shadow-[inset_0_1px_0_#ffffff0b] backdrop-blur-xl">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-sky-100/55">Your rental · extension</p><h4 className="mt-1 text-sm font-semibold text-white/90">Check extra time</h4></div><span className="rounded-full border border-sky-200/15 bg-sky-200/[0.07] px-2 py-1 text-[10px] text-sky-100/75">Live stock check</span></div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">{m.meta.extensionOffer.items.slice(0, 4).map((item: any) => <div key={`${m._id}-extension-${item.index}`} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-2">
                      <SmartImage src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={item.title} className="h-11 w-11 shrink-0 rounded-lg" />
                      <div className="min-w-0"><p className="truncate text-xs text-white/80">{item.qty}× {rentalTitle(item.title)}</p><p className="mt-0.5 text-[10px] text-white/40">Original return {new Date(item.end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}{item.returnTime ? ` · ${item.returnTime}` : ""}</p></div>
                    </div>)}</div>
                    {m.meta.extensionOffer.items.length > 4 && <p className="mt-2 text-[10px] text-white/40">+{m.meta.extensionOffer.items.length - 4} more items in this rental</p>}
                    <p className="mt-3 text-[11px] leading-relaxed text-white/55">Choose days and items for a live total. Anything not selected stays due at its original time.</p>
                    {!admin && <button type="button" data-testid="gaffer-extension-open" onClick={() => window.dispatchEvent(new Event("dbc:open-rental-extension"))} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl border border-sky-100/20 bg-sky-100/[0.12] px-3.5 text-xs font-medium text-sky-50 transition hover:bg-sky-100/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100/60">Check availability & total</button>}
                  </section>}
                  {!admin && !teamHandling && m.sender === "bot" && m._id === latestConversationMessage?._id && m.meta?.offerHuman === true && <HumanHandoffOffer key={`${scopeKey}:${m._id}`} onRequest={async () => { await human({ token, bookingId: bookingId as any, offerMessageId: m._id as any }); }} />}
                  {m.meta?.kind === "attachment" && m.meta.attachmentId && <button type="button" disabled={attachmentBusy} onClick={() => void downloadAttachment(m.meta.attachmentId, m.meta.name || "attachment")} className="mt-3 rounded-full border border-current/20 px-3 py-1 text-xs disabled:opacity-40">Download attachment</button>}
                  {admin && m.meta?.kind === "attachment" && m.meta.attachmentId && <AttachmentAdminControls key={m.meta.attachmentId} token={token} id={m.meta.attachmentId}/>}
                  {m.sender === "system" && m.meta?.kind === "verification_update" && m.meta?.status === "verified" && m.meta?.pickupMap === true && <a href={WATERSTONES_MAP_URL} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block rounded-full border border-current/20 px-3 py-1 text-xs">Open Waterstones, Trafalgar Square in Google Maps ↗</a>}
                  {m.meta?.kind === "full_credit_offer" && !admin && <RentalCreditOffer token={token} offerId={m.meta.offerId} />}
                  {m.meta?.kind === "review_invitation" && !admin && bookingId && <BookingReview key={bookingId} bookingId={bookingId} token={token} inline />}
                  {m.meta?.kind === "delivery_quote" && !admin && m.meta.quoteId && <RentalDeliveryQuoteApproval token={token} quoteId={m.meta.quoteId} />}
                  {!admin && bookingId && (m.meta?.kind === "rental_item_swap" || m.meta?.type === "rental_item_swap") && m.meta.swapId && <RentalSwapApproval key={m.meta.swapId} token={token} bookingId={bookingId} swapId={m.meta.swapId}/>}
                  {m.meta?.kind === "paylink" && (
                    <a
                      href={m.meta.url}
                      className="mt-3 inline-block rounded-full border border-current/20 px-3 py-1 text-xs"
                    >
                      Review payment · £{m.meta.amount}
                    </a>
                  )}
                  {workspacePresentation && <time className={styles.bubbleTime} dateTime={new Date(m.at).toISOString()}>{new Date(m.at).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit"})}</time>}
                </div>
                </div>
                </div>
              </div>
              {!admin && notificationDeviceStatus === "inactive" && notificationInvitation?.id === String(m._id) && notificationInvitation.visible && <div className={styles.notificationCard} aria-label="Chat notifications">
                <span className={styles.notificationIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 8a6 6 0 0 0-12 0v5l-2 3v1h16v-1l-2-3V8ZM9 20h6"/><path d="M18.5 3v3m-1.5-1.5h3"/></svg></span>
                <div className={styles.notificationCopy}><strong>Stay in the loop</strong><p>Get chat and booking updates. On iPhone or iPad, add DB Cinema to your Home Screen first.</p><div><button type="button" onClick={() => dismissNotificationInvitation(true)}>Turn on notifications</button><button type="button" onClick={() => dismissNotificationInvitation(false)}>Not now</button></div></div>
              </div>}
              </Fragment>
            );
          })}
          </>
        )}
        {bookingSummary?.items?.length ? <section className={styles.rentalItemsCard} data-testid="rental-items-in-chat" aria-label="Items in this rental">
          <div className={styles.rentalItemsHeading}><strong>Items in this rental</strong><span>{bookingSummary.items.length} {bookingSummary.items.length === 1 ? "listing" : "listings"}</span></div>
          <div className={styles.rentalItemsGrid} data-count={bookingSummary.items.length}>
            {bookingSummary.items.map((item, index) => {
              const imageSources = item.imageSources?.length
                ? item.imageSources
                : item.heroImage
                  ? [item.heroImage]
                  : [];
              return <article className={styles.rentalItem} key={`${item.title}-${index}`} data-rental-item-title={item.title}>
              {imageSources.length ? <SmartImage fit="contain" src={imageSources[0]} fallbackSources={imageSources.slice(1)} alt={`${item.title} listing photo`} className={styles.rentalItemPhoto} /> : <div className={styles.rentalItemPhotoUnavailable}>Listing photo unavailable</div>}
              <div className={styles.rentalItemCopy}><strong>{item.title}</strong><span>Qty {item.qty}</span></div>
            </article>;
            })}
          </div>
        </section> : null}
      </div>
      <footer ref={composer} className={styles.composer}>
        {admin && replyState && <p className={styles.replyStatus} data-waiting={replyState.awaitingTeam || replyState.awaitingReply} role="status">{replyState.awaitingTeam ? "Renter is waiting for the team" : replyState.awaitingReply ? "Renter is waiting for a reply" : "No unanswered renter message"}{(replyState.awaitingTeam || replyState.awaitingReply) && replyState.renterAt && <span>Since {new Date(replyState.renterAt).toLocaleString("en-GB", {timeZone:"Europe/London",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})} · London time</span>}</p>}
        {admin && <div className="mb-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={suggest} disabled={drafting} className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-200 disabled:opacity-50"><GafferIcon className="h-4 w-4" />{drafting ? "Drafting…" : "Suggest replies"}</button>
            {thread && "quickReplies" in thread && thread.quickReplies?.map((reply) => <button key={reply.label} type="button" onClick={() => useReply(reply.text)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60">{reply.label}</button>)}
          </div>
          {drafts && drafts.messageId === (thread?.page[0]?._id ?? null) && <div className="flex snap-x gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible" aria-label="Suggested replies">
            {drafts.drafts.map((draft, index) => <button key={index} type="button" onClick={() => useReply(draft.text)} className="w-[85%] shrink-0 snap-start rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] p-3 text-left sm:w-auto">
              <span className="text-xs font-medium text-emerald-200">{draft.label}</span><p className="mt-1 line-clamp-4 text-xs leading-relaxed text-white/60">{draft.text}</p><span className="mt-2 block text-[10px] text-white/30">Use draft · review before sending</span>
            </button>)}
          </div>}
        </div>}
        {error && (
          <p role="alert" className="mb-3 text-xs text-rose-300">
            {error}
          </p>
        )}
        {cleanCandidate && attachmentsAvailable && <div className={styles.cleanOption}><div className={styles.cleanOptionHeader}><span className={styles.cleanOptionIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3 4.5 6v5.5c0 4.4 2.8 7.7 7.5 9.5 4.7-1.8 7.5-5.1 7.5-9.5V6L12 3Z"/><path d="m8.8 12 2.1 2.1 4.4-4.4"/><path d="M18.2 2.7v3m-1.5-1.5h3"/></svg></span><strong>Send a clean copy</strong><button type="button" aria-label="Dismiss cleaned image option" onClick={() => setCleanCandidate(null)}>×</button></div><p>PNG copy removes metadata. Colours may change. Your original stays on your device.</p><button type="button" disabled={attachmentBusy} onClick={() => void uploadAttachment(cleanCandidate, true)} className={styles.cleanOptionAction}>Send cleaned PNG copy</button></div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className={styles.composeForm}
        >
          <input ref={attachmentInput} type="file" accept={CHAT_IMAGE_ACCEPT} aria-label="Choose a JPG, PNG or WebP image" className="sr-only" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; void uploadAttachment(file); }} />
          <button type="button" disabled={!attachmentsAvailable || attachmentBusy} onClick={() => attachmentInput.current?.click()} aria-label={attachmentsAvailable ? "Attach an image, JPG, PNG or WebP up to 10 MB" : "Image attachments temporarily unavailable"} title={attachmentsAvailable ? CHAT_IMAGE_HELP : "Image attachments temporarily unavailable"} className={`rounded-2xl border border-white/15 px-3 text-sm text-white/70 disabled:opacity-40 ${styles.attachButton}`}>{attachmentBusy ? "…" : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 12.5 6.8-6.8a3.5 3.5 0 0 1 5 5l-8.3 8.3a5 5 0 0 1-7-7l8-8"/><path d="m7.5 15 8-8"/></svg>}</button>
          <textarea
            ref={composerInput}
            aria-label="Message"
            value={text}
            maxLength={2000}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Message…"
            className="min-h-11 flex-1 resize-none rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-accent-400/50"
          />
          {workspacePresentation && <div className={styles.emojiControl} onKeyDown={event => { if (event.key === "Escape") { setEmojiOpen(false); composerInput.current?.focus(); } }}>
            <button type="button" className={styles.emojiToggle} aria-label="Add an emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(open => !open)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14c.7 1.6 2 2.4 4 2.4s3.3-.8 4-2.4M8.5 9h.01M15.5 9h.01" strokeLinecap="round" strokeWidth="2"/></svg></button>
            {emojiOpen && <div className={styles.emojiPicker} role="group" aria-label="Choose an emoji">{["😊", "👍", "🎬", "❤️", "🙏", "✨"].map(emoji => <button type="button" key={emoji} aria-label={`Insert ${emoji}`} onClick={() => { const input = composerInput.current; const start = input?.selectionStart ?? text.length; const end = input?.selectionEnd ?? start; const fits = text.length - (end - start) + emoji.length <= 2000; if (fits) setText(current => current.slice(0, start) + emoji + current.slice(end)); setEmojiOpen(false); requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(fits ? start + emoji.length : start, fits ? start + emoji.length : end); }); }}>{emoji}</button>)}</div>}
          </div>}
          <button
            disabled={busy || !text.trim()}
            aria-label="Send message"
            className={`rounded-2xl bg-accent-500 px-4 py-3 text-sm font-medium text-white disabled:opacity-40 ${styles.sendButton}`}
          >
            {busy ? "…" : workspacePresentation ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M21 3 3 10l7 3 3 8 8-18ZM10 13l11-10"/></svg> : "Send"}
          </button>
        </form>
      </footer>
      </div>
      {tools && admin && (
        <aside aria-label="Rental management controls" className={`management-conversation-tools ${styles.tools}`}><div className={styles.toolsHeading}><p className={styles.eyebrow}>Operations</p><h4>Booking details</h4></div>{tools}{bookingId && <><details className={styles.operationDetails}><summary>Verification progress</summary><RentalVerificationSummary bookingId={bookingId} token={token} admin /></details><details className={styles.operationDetails}><summary>Rental price</summary><RentalPricePanel token={token} bookingId={bookingId} admin /></details><details className={styles.operationDetails}><summary>Extension requests</summary><RentalExtensionPanel token={token} bookingId={bookingId} admin /></details></>}</aside>
      )}
    </section>
  );
}
