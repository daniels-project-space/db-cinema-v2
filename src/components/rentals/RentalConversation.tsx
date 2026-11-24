"use client";
import { ChatAttachmentPreview } from "./ChatAttachmentPreview";
import styles from "./RentalConversation.module.css";
import { CHAT_ATTACHMENT_ACCEPT, CHAT_ATTACHMENT_HELP, CHAT_ATTACHMENT_LIMIT, CHAT_TEXT_LIMIT, isChatAttachmentNameMatched, isChatAttachmentType, isChatImageType, isConvertiblePhoneImage } from "../../../shared/chatAttachmentPolicy";
import { SmartImage } from "@/components/SmartImage";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalAdditionApproval } from "./RentalAdditionApproval";
import {RentalPricePanel} from "./RentalPricePanel";
import { rentalTitle } from "@/lib/rentalPresentation";
import { SavedCardCharges } from "./SavedCardCharges";
import { RENTAL_STAGE_LABELS } from "@/lib/rentalPresentation";
import { ChatAvatar, GafferIcon } from "./ChatIdentity";
import { RentalCreditOffer } from "./RentalCreditOffer";
import { BookingReview } from "@/components/account/BookingReview";
import { RentalExtensionPanel } from "./RentalExtensionPanel";
import { RentalVerificationSummary } from "./RentalVerificationSummary";
import { RentalDeliveryQuoteApproval } from "./RentalDeliveryQuoteApproval";
import { AttachmentAdminControls } from "./AttachmentAdminControls";
import { RentalSwapApproval } from "./RentalSwapApproval";
import { createCleanChatImage } from "@/lib/chatImageCopy";
import { attachmentRetryKey, clearAttachmentRetryKey } from "@/lib/chatAttachmentRetry";
import { HumanHandoffOffer } from "./HumanHandoffOffer";
import { GafferExtensionOfferCard } from "./GafferExtensionOfferCard";
import { ChatAperture } from "./ChatAperture";
import { ChatErrorBoundary } from "./ChatErrorBoundary";
import { createClientRequestId } from "@/lib/clientRequestId";
import { approvedCheckoutCartPath, approvedGearListingPath, approvedStripeCheckoutUrl, removeRedundantBusinessEmailLines, resolveRentalChatLink } from "@/lib/chatLinks";
import { BUSINESS_CONTACT_EMAIL } from "../../../shared/businessEmail";
import { renterFacingError } from "@/lib/renterFacingError";
import { EmailLink } from "@/components/EmailLink";
import { FormattedChatMessage, type FormattedChatLinkResolver } from "@/components/chat/FormattedChatMessage";
import { dismissChatNotificationOffer, isChatNotificationOfferDismissed } from "@/lib/chatNotificationOffer";
import { AutomatedRentalMessageCard } from "./AutomatedRentalMessageCard";

type RentalConversationProps = {
  token: string;
  bookingId?: string;
  accountId?: string;
  admin?: boolean;
  title: string;
  stage: string;
  stageLabel?: string;
  verificationWindowClosed?: boolean;
  escalated?: boolean;
  tools?: React.ReactNode;
  adminActions?: React.ReactNode;
  openRevision?: number;
  bookingSummary?: { heading?: string; items?: { index?: number; title: string; qty: number; heroImage?: string | null; imageSources?: string[] }[]; dates: string; count: number; handover?: string };
  handoverDetails?: { phone: string; pickupAddress?: string | null; returnAddress?: string | null; pickupInstructions?: string | null; fulfilment: "pickup" | "delivery" };
  workspaceIdentity?: { name?: string | null; phone?: string | null; photo?: string | null; privatePortrait?: React.ReactNode; membershipLabel?: string | null; encoreLabel?: string | null; verified?: boolean };
  renterWorkspace?: boolean;
  starred?: boolean;
  starDisabled?: boolean;
  onStar?: () => void;
};

function mapsDirectionsHref(address?: string | null) {
  const destination = address?.trim();
  if (!destination || destination.length > 240) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function ChatMessageText({ text, allowAdminNavigation = false }: { text: string; allowAdminNavigation?: boolean }) {
  const displayText = removeRedundantBusinessEmailLines(text, BUSINESS_CONTACT_EMAIL);
  const resolveLink: FormattedChatLinkResolver = (rawUrl, suppliedLabel) =>
    resolveRentalChatLink(rawUrl, suppliedLabel, { allowAdminNavigation });
  return <FormattedChatMessage text={displayText} resolveLink={resolveLink} tone="rental" />;
}

function hasDedicatedMessageCard(meta: any, admin: boolean) {
  if (meta?.kind === "attachment") return typeof meta.attachmentId === "string" && meta.attachmentId.length > 0;
  if (meta?.kind === "extension_request" || meta?.kind === "extension_payment") {
    return Array.isArray(meta.items) && meta.items.length > 0;
  }
  if (meta?.kind === "late_extension_offer") return true;
  if (!admin && meta?.kind === "delivery_quote") return typeof meta.quoteId === "string" && meta.quoteId.length > 0;
  if (!admin && (meta?.kind === "rental_item_swap" || meta?.type === "rental_item_swap")) return typeof meta.swapId === "string" && meta.swapId.length > 0;
  return false;
}

export function LateExtensionOffer({ token, meta, admin }: { token: string; meta: any; admin: boolean }) {
  const validAmount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const validCustom = meta.customFee == null || typeof meta.customFee.description === "string" && validAmount(meta.customFee.amountPence);
  const valid = typeof meta.requestId === "string" && meta.requestId.length > 0 && typeof meta.fingerprint === "string" && /^[a-f0-9]{64}$/.test(meta.fingerprint) && typeof meta.amount === "number" && Number.isFinite(meta.amount) && meta.amount > 0 && [meta.latePence, meta.extensionPence, meta.discountPence].every(validAmount) && validCustom && meta.discountPence <= meta.extensionPence && Math.round(meta.amount * 100) === meta.latePence + meta.extensionPence - meta.discountPence + (meta.customFee?.amountPence ?? 0) && Number.isSafeInteger(meta.targetEnd) && Number.isFinite(new Date(meta.targetEnd).getTime()) && typeof meta.returnTime === "string" && Array.isArray(meta.items) && meta.items.length > 0 && meta.items.every((item: any) => typeof item?.title === "string" && Number.isSafeInteger(item.qty) && item.qty > 0 && (item.imageSources == null || Array.isArray(item.imageSources)));
  return <section data-testid="late-extension-offer" aria-label="Late rental extension offer" className="mt-3 max-w-3xl overflow-hidden rounded-[26px] border border-white/20 bg-[radial-gradient(ellipse_at_100%_100%,rgba(169,111,49,.2),transparent_42%),linear-gradient(145deg,#292a2c,#17181b_48%,#1c1b1b)] p-4 shadow-[inset_0_1px_rgba(255,255,255,.1),0_16px_40px_rgba(0,0,0,.25)] sm:p-6">
    <div className="text-center"><ChatAperture /><p className="mt-1 text-[10px] font-semibold uppercase tracking-[.15em] text-amber-100/70">Rental update</p><h4 className="mt-2 text-xl font-semibold tracking-tight text-white">Extra time for your kit</h4></div>
    {valid ? <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">{meta.items.map((item: any, index: number) => <article key={`${item.lineIndex ?? index}`} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3">
        <SmartImage fit="contain" src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={`${item.title} listing photo`} className="h-16 w-[68px] shrink-0 rounded-xl bg-white/[0.025]" /><div className="min-w-0"><p className="break-words text-xs font-semibold text-white/90">{item.qty}× {rentalTitle(item.title)}</p><p className="mt-1 text-[11px] text-white/65">Return {new Date(meta.targetEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · {meta.returnTime} London</p></div>
      </article>)}</div>
      <dl className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-white/75"><div className="flex justify-between gap-3"><dt>Overdue rental time</dt><dd>£{(meta.latePence / 100).toFixed(2)}</dd></div><div className="flex justify-between gap-3"><dt>Additional extension</dt><dd>£{(meta.extensionPence / 100).toFixed(2)}</dd></div>{meta.discountPence > 0 && <div className="flex justify-between gap-3 text-emerald-200"><dt>Extension savings</dt><dd>−£{(meta.discountPence / 100).toFixed(2)}</dd></div>}{typeof meta.customFee?.description === "string" && validAmount(meta.customFee.amountPence) && meta.customFee.amountPence > 0 && <div className="flex justify-between gap-3"><dt className="break-words">{meta.customFee.description}</dt><dd>£{(meta.customFee.amountPence / 100).toFixed(2)}</dd></div>}</dl>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-100/20 bg-white/[.05] px-4 py-3"><span className="text-xs text-white/75">Amount to pay</span><strong className="text-xl font-semibold text-amber-100">£{meta.amount.toFixed(2)}</strong></div>
      <p className="mt-3 text-xs leading-relaxed text-white/70">The original return time remains in place until payment succeeds.</p>
      {!admin && <LateExtensionAccept token={token} requestId={meta.requestId} fingerprint={meta.fingerprint} />}
    </> : <p role="status" className="mt-3 text-xs text-amber-100/75">Offer details are unavailable. Please ask the team for an updated offer.</p>}
  </section>;
}

function LateExtensionAccept({ token, requestId, fingerprint }: { token: string; requestId: string; fingerprint: string }) {
  const accept = useAction((api as any).rentalExtensionPayments.acceptLateAndPay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function pay() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await accept({ token, requestId, expectedFingerprint: fingerprint });
      const url = approvedStripeCheckoutUrl(result?.url);
      if (!url) throw new Error("The secure payment link is unavailable. Please ask the team for help.");
      window.location.assign(url);
    } catch (failure) {
      setError(renterFacingError(failure, "Could not open payment. Please try again."));
      setBusy(false);
    }
  }
  return <><button type="button" data-testid="late-extension-accept" onClick={() => void pay()} disabled={busy} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ffda90] to-[#c99452] px-4 py-2 text-sm font-semibold text-[#17120d] disabled:opacity-50">{busy ? "Opening secure payment…" : "Accept and pay securely"}</button>{error && <p role="alert" className="mt-2 text-xs text-amber-100/80">{error}</p>}</>;
}

export function RentalConversation(props: RentalConversationProps) {
  return <ChatErrorBoundary key={`${props.admin ? "admin" : "renter"}:${props.bookingId ?? props.accountId ?? "general"}`}><RentalConversationContent {...props} /></ChatErrorBoundary>;
}

function RentalConversationContent({
  token,
  bookingId,
  accountId,
  admin = false,
  title,
  stage,
  stageLabel,
  verificationWindowClosed = false,
  escalated = false,
  tools,
  adminActions,
  openRevision = 0,
  bookingSummary,
  handoverDetails,
  workspaceIdentity: providedWorkspaceIdentity,
  renterWorkspace = false,
  starred = false,
  starDisabled = false,
  onStar,
}: RentalConversationProps) {
  const workspaceIdentity = admin ? providedWorkspaceIdentity : undefined;
  const thread = useQuery(api.rentalChat.messages, {
    token,
    bookingId: bookingId as any,
    accountId: accountId as any,
    admin,
    paginationOpts: { numItems: 50, cursor: null },
  });
  const latestRenterMessage = admin && thread && "page" in thread
    ? thread.page.find((message: any) => message.sender === "renter")
    : null;
  const emailReplyContext = latestRenterMessage?.meta?.channel === "email" &&
    typeof latestRenterMessage.meta.emailThreadId === "string" &&
    typeof latestRenterMessage.meta.emailMessageId === "string"
    ? {
        threadId: latestRenterMessage.meta.emailThreadId,
        emailMessageId: latestRenterMessage.meta.emailMessageId,
        chatMessageId: latestRenterMessage._id,
      }
    : null;
  const emailThreadStatus = useQuery(api.emailInbox.adminThread, admin && emailReplyContext
    ? { token, threadId: emailReplyContext.threadId as any }
    : "skip");
  const emailReplyDeliveryStatus = admin && emailReplyContext && emailThreadStatus?.authorized
    ? emailThreadStatus.replyDeliveryStatus
    : null;
  const emailReplyStatusLoading = !!(admin && emailReplyContext && emailThreadStatus === undefined);
  const extensionPaymentRequestIdsInChat = thread && "page" in thread
    ? thread.page.flatMap((message: any) => message.meta?.kind === "extension_payment" && typeof message.meta.requestId === "string" ? [message.meta.requestId] : [])
    : [];
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
  const [draftReadyKey, setDraftReadyKey] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const checkAttachmentsAvailability = useAction(api.chatAttachments.availability);
  const [attachmentsAvailable, setAttachmentsAvailable] = useState(false);
  const [attachmentsAvailabilityChecked, setAttachmentsAvailabilityChecked] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentFeedback, setAttachmentFeedback] = useState<"checking" | "pending" | "rejected" | "unavailable" | null>(null);
  const [attachmentRetry, setAttachmentRetry] = useState<{ file: File; clean: boolean; prepared?: File } | null>(null);
  const [cleanCandidate, setCleanCandidate] = useState<File | null>(null);
  const composer = useRef<HTMLElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const attachmentKeys = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    let pending = false;
    setAttachmentsAvailable(false);
    setAttachmentsAvailabilityChecked(false);
    const refresh = () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      void checkAttachmentsAvailability({ token, admin, bookingId: bookingId as any, accountId: accountId as any })
        .then(ready => { if (active) { setAttachmentsAvailable(ready === true); setAttachmentsAvailabilityChecked(true); } })
        .catch(() => { if (active) { setAttachmentsAvailable(false); setAttachmentsAvailabilityChecked(true); } })
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
  const sendEmailOwnerReply = useAction(api.emailInbox.sendChatOwnerReply);
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<{ messageId: string | null; drafts: { label: string; text: string }[] } | null>(null);
  const emailReplyAttempt = useRef<{ key: string; context: string; text: string } | null>(null);
  const renterMessageAttempt = useRef<{ scope: string; text: string; requestId: string } | null>(null);
  const ownerMessageAttempt = useRef<{ scope: string; text: string; requestId: string } | null>(null);
  const scopeKey = JSON.stringify([token, admin, bookingId ?? null, accountId ?? null]);
  const draftStorageKey = accountId
    ? `dbc-chat-draft-v1:${admin ? "admin" : "renter"}:${encodeURIComponent(accountId)}:${encodeURIComponent(bookingId ?? "support")}`
    : bookingId
      ? `dbc-chat-draft-v1:${admin ? "admin" : "renter"}:booking:${encodeURIComponent(bookingId)}`
      : null;
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
    let restoredDraft = "";
    if (draftStorageKey) {
      try {
        restoredDraft = window.sessionStorage.getItem(draftStorageKey) ?? "";
      } catch {}
    }
    setText(restoredDraft.slice(0, 2000));
    setDraftReadyKey(draftStorageKey);
    setEmojiOpen(false);
    setError(null);
    setDrafts(null);
    setBusy(false);
    setAttachmentBusy(false);
    setAttachmentFeedback(null);
    setAttachmentRetry(null);
    setCleanCandidate(null);
    attachmentKeys.current.clear();
    setDrafting(false);
    setVisible(null);
    pinnedToLatest.current = true;
    lastRead.current = "";
  }, [scopeKey, draftStorageKey]);
  useEffect(() => {
    if (!draftStorageKey || draftReadyKey !== draftStorageKey) return;
    try {
      if (text) window.sessionStorage.setItem(draftStorageKey, text.slice(0, 2000));
      else window.sessionStorage.removeItem(draftStorageKey);
    } catch {}
  }, [text, draftStorageKey, draftReadyKey]);
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
  async function submit() {
    if (!text.trim() || busy) return;
    const requestedScope = scope.current;
    const submitted = text.trim();
    setBusy(true);
    setError(null);
    try {
      if (admin) {
        if (emailReplyContext) {
          const contextKey = `${emailReplyContext.threadId}:${emailReplyContext.emailMessageId}:${emailReplyContext.chatMessageId}`;
          let attempt = emailReplyAttempt.current;
          if (!attempt || attempt.context !== contextKey || attempt.text !== submitted) {
            attempt = { key: createClientRequestId(), context: contextKey, text: submitted };
            emailReplyAttempt.current = attempt;
          }
          const result = await sendEmailOwnerReply({
            token,
            threadId: emailReplyContext.threadId as any,
            emailMessageId: emailReplyContext.emailMessageId as any,
            chatMessageId: emailReplyContext.chatMessageId as any,
            replyId: attempt.key,
            text: submitted,
          });
          if (result.uncertain) throw new Error("Delivery unclear — check before sending again.");
          if (!result.ok) throw new Error(result.busy ? "This email reply is already being sent. Wait a moment, then refresh." : "The email reply could not be confirmed.");
          emailReplyAttempt.current = null;
        } else {
          let attempt = ownerMessageAttempt.current;
          if (!attempt || attempt.scope !== scopeKey || attempt.text !== submitted) {
            attempt = { scope: scopeKey, text: submitted, requestId: createClientRequestId() };
            ownerMessageAttempt.current = attempt;
          }
          await sendOwner({
            token,
            bookingId: bookingId as any,
            accountId: accountId as any,
            text: submitted,
            requestId: attempt.requestId,
          });
          ownerMessageAttempt.current = null;
        }
      } else {
        let attempt = renterMessageAttempt.current;
        if (!attempt || attempt.scope !== scopeKey || attempt.text !== submitted) {
          attempt = { scope: scopeKey, text: submitted, requestId: createClientRequestId() };
          renterMessageAttempt.current = attempt;
        }
        await sendRenter({
          token,
          bookingId: bookingId as any,
          text: submitted,
          requestId: attempt.requestId,
        });
        renterMessageAttempt.current = null;
      }
      if (scope.current === requestedScope) setText(current => current.trim() === submitted ? "" : current);
    } catch (e: any) {
      if (scope.current === requestedScope) setError(admin ? e.message ?? "Message could not be sent." : renterFacingError(e, "Message could not be sent. Please try again."));
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
  async function uploadAttachment(file?: File, clean = false, prepared?: File) {
    if (!file || attachmentBusy || !attachmentsAvailable) return;
    const requestedScope = scope.current;
    setAttachmentBusy(true); setError(null); setCleanCandidate(null); setAttachmentFeedback("checking"); setAttachmentRetry(null);
    let upload = prepared ?? file;
    try {
      const phoneImage = isConvertiblePhoneImage(file.type, file.name);
      const supportedType = isChatAttachmentType(file.type) || phoneImage;
      const matchingExtension = phoneImage || isChatAttachmentNameMatched(file.name, file.type);
      if (!file.size || file.size > CHAT_ATTACHMENT_LIMIT || !supportedType || !matchingExtension || file.type === "text/plain" && file.size > CHAT_TEXT_LIMIT || clean && !isChatImageType(file.type)) {
        if (scope.current === requestedScope) { setAttachmentFeedback(null); setError(CHAT_ATTACHMENT_HELP); }
        return;
      }
      const sourceDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map(part => part.toString(16).padStart(2, "0")).join("");
      const scopeDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(requestedScope.key)))).map(part => part.toString(16).padStart(2, "0")).join("");
      if (scope.current !== requestedScope) return;
      if (!prepared && (clean || phoneImage)) {
        try {
          upload = await createCleanChatImage(file, phoneImage ? "converted" : "cleaned");
        } catch {
          if (scope.current === requestedScope) {
            setAttachmentFeedback(null);
            setAttachmentRetry(null);
            setError(phoneImage ? "Your browser could not read this phone photo. Save or share it as a JPG or PNG and try again." : "The clean image copy could not be prepared. Choose another photo and try again.");
          }
          return;
        }
      }
      if (scope.current !== requestedScope) return;
      const fingerprint = JSON.stringify([sourceDigest, clean]);
      let storage: Storage | null = null;
      try { storage = window.sessionStorage; } catch {}
      const key = attachmentKeys.current.get(fingerprint) ?? attachmentRetryKey(storage, scopeDigest, sourceDigest, clean, () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map(byte => byte.toString(16).padStart(2, "0")).join(""));
      attachmentKeys.current.set(fingerprint, key);
      const response = await fetch(attachmentUrl({ key }), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": upload.type, "X-Chat-Filename": encodeURIComponent(upload.name.slice(0, 120)) }, body: upload });
      if (!response.ok) {
        if (scope.current !== requestedScope) return;
        if (response.status === 409) { setAttachmentFeedback("pending"); setAttachmentRetry({ file, clean, prepared: upload }); return; }
        if (response.status === 422) { setAttachmentFeedback("rejected"); if (!clean && isChatImageType(file.type)) setCleanCandidate(file); return; }
        if (response.status === 503) { setAttachmentFeedback("unavailable"); setAttachmentRetry({ file, clean, prepared: upload }); return; }
        setAttachmentFeedback(null);
        setError(response.status === 413 || response.status === 415 ? CHAT_ATTACHMENT_HELP : "The attachment could not be sent. Check the rental and try again.");
        return;
      }
      if (scope.current === requestedScope) { attachmentKeys.current.delete(fingerprint); clearAttachmentRetryKey(storage, scopeDigest, sourceDigest, clean, key); setAttachmentFeedback(null); }
    } catch (e) { if (scope.current === requestedScope) { setAttachmentFeedback("unavailable"); setAttachmentRetry({ file, clean, prepared: upload }); setError(admin ? e instanceof Error ? e.message : "The attachment could not be sent." : renterFacingError(e, "The attachment could not be sent. Please try again.")); } }
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
      if (scope.current === requestedScope) setError(admin ? e.message : renterFacingError(e, "The team request could not be updated. Please try again."));
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
      if (scope.current === requestedScope) setError(admin ? e.message ?? "Drafts unavailable." : renterFacingError(e, "Gaffer suggestions are unavailable. Please try again."));
    } finally { if (scope.current === requestedScope) setDrafting(false); }
  }
  const messages = [
    ...new Map(
      [...history, ...(thread?.page ?? [])].map((m) => [m._id, m]),
    ).values(),
  ].sort((a, b) => a.at - b.at);
  const invitationId = !admin && thread?.notificationPromptMessageId
    ? String(thread.notificationPromptMessageId)
    : null;
  const invitationAccount = !admin && thread && "notificationScope" in thread ? thread.notificationScope : null;
  const [notificationDeviceStatus, setNotificationDeviceStatus] = useState<"unknown" | "active" | "inactive" | "unavailable">("unknown");
  const [notificationPlatform, setNotificationPlatform] = useState<"ios" | "android" | "other">("other");
  useEffect(() => {
    const agent = navigator.userAgent;
    const isIPad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    setNotificationPlatform(/iPhone|iPad|iPod/i.test(agent) || isIPad ? "ios" : /Android/i.test(agent) ? "android" : "other");
  }, []);
  useEffect(() => {
    if (admin) return;
    const receive = (event: Event) => {
      const status = (event as CustomEvent).detail;
      if (status === "active" || status === "inactive" || status === "unknown" || status === "unavailable") setNotificationDeviceStatus(status);
      if (status === "active" && invitationAccount) {
        setNotificationInvitation(current => current ? { ...current, visible: false } : current);
      }
    };
    window.addEventListener("dbc:renter-notification-status", receive);
    window.dispatchEvent(new Event("dbc:request-renter-notification-status"));
    return () => window.removeEventListener("dbc:renter-notification-status", receive);
  }, [admin, token, invitationAccount]);
  const [notificationInvitation, setNotificationInvitation] = useState<{ id: string; visible: boolean } | null>(null);
  useEffect(() => {
    if (!invitationId || !invitationAccount || notificationDeviceStatus !== "inactive") { setNotificationInvitation(null); return; }
    const dismissed = isChatNotificationOfferDismissed(String(invitationAccount));
    setNotificationInvitation({ id: invitationId, visible: !dismissed });
  }, [invitationId, invitationAccount, notificationDeviceStatus]);
  function scrollLatestAndNotificationIntoView() {
    const scroller = body.current;
    if (!scroller || (!pinnedToLatest.current && !notificationInvitation?.visible)) return;
    const renderedMessages = scroller.querySelectorAll<HTMLElement>("[data-message-id]");
    const latestMessage = renderedMessages.item(renderedMessages.length - 1);
    if (!latestMessage) {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    const viewport = scroller.getBoundingClientRect();
    const latestBounds = latestMessage.getBoundingClientRect();
    const invitation = scroller.querySelector<HTMLElement>('[aria-label="Chat notifications"]');
    const rentalItems = scroller.querySelector<HTMLElement>('[data-testid="rental-items-in-chat"]');
    const renterActions = !admin ? scroller.querySelector<HTMLElement>('[data-testid="renter-chat-controls"]') : null;
    const invitationBounds = invitation?.getBoundingClientRect();
    const targetBottom = invitationBounds ? invitationBounds.bottom + 3 : renterActions?.getBoundingClientRect().bottom ?? rentalItems?.getBoundingClientRect().bottom ?? latestBounds.bottom;
    const needed = invitationBounds
      ? invitationBounds.top < viewport.top + 2
        ? invitationBounds.top - viewport.top - 2
        : Math.max(0, targetBottom - viewport.bottom)
      : Math.max(0, targetBottom - viewport.bottom);
    const keepLatestVisible = Math.max(0, latestBounds.top - viewport.top);
    scroller.scrollTop += invitation ? needed : renterActions || rentalItems ? needed : Math.min(needed, keepLatestVisible);
    if (!admin && workspacePresentation) {
      const contentScroller = scroller.parentElement;
      const contentBounds = contentScroller?.getBoundingClientRect();
      const composerTop = composer.current?.getBoundingClientRect().top;
      const messagesBottom = scroller.getBoundingClientRect().bottom;
      const safeBottom = Math.min(contentBounds?.bottom ?? composerTop ?? messagesBottom, composerTop ?? messagesBottom) - 2;
      if (contentScroller && getComputedStyle(contentScroller).overflowY !== "visible" && messagesBottom > safeBottom) {
        contentScroller.scrollTop += messagesBottom - safeBottom;
      }
    }

    // On narrow account workspaces, the latest rental card can pin the scroll
    // position while leaving the oldest bubble only partly visible under the
    // profile header. Keep the newest content in view, but snap that clipped
    // bubble fully above the scrollport so it never reads as header overlap.
    if (admin && workspaceIdentity && window.matchMedia("(max-width: 600px)").matches) {
      const oldestMessage = renderedMessages.item(0);
      if (oldestMessage) {
        const scrollportTop = scroller.getBoundingClientRect().top;
        const oldestBounds = oldestMessage.getBoundingClientRect();
        if (oldestBounds.top < scrollportTop && oldestBounds.bottom > scrollportTop) {
          scroller.dataset.chatClearance = "true";
          const scrollClearance = oldestBounds.bottom - scrollportTop + 4;
          scroller.scrollTop += scrollClearance;
        }
      }
    }
  }
  useEffect(() => {
    const scroller = body.current;
    if (!scroller) return;
    let frame = 0;
    const keepLatestVisible = () => {
      if (!pinnedToLatest.current && !notificationInvitation?.visible) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scrollLatestAndNotificationIntoView);
    };
    const observer = new ResizeObserver(keepLatestVisible);
    const observedMessages = new WeakSet<Element>();
    const observeMessages = () => {
      for (const child of Array.from(scroller.children)) {
        if (observedMessages.has(child)) continue;
        observedMessages.add(child);
        observer.observe(child);
      }
    };
    const contentObserver = new MutationObserver(() => {
      observeMessages();
      keepLatestVisible();
    });
    contentObserver.observe(scroller, { childList: true });
    observer.observe(scroller);
    if (scroller.parentElement) observer.observe(scroller.parentElement);
    observeMessages();
    if (!admin) {
      const renterControls = scroller.parentElement?.querySelector<HTMLElement>('[data-testid="renter-chat-controls"]');
      if (renterControls) observer.observe(renterControls);
    }
    keepLatestVisible();
    return () => {
      cancelAnimationFrame(frame);
      contentObserver.disconnect();
      observer.disconnect();
    };
  }, [thread?.page[0]?._id, scopeKey, notificationInvitation?.id, notificationInvitation?.visible]);
  useEffect(() => {
    if (notificationInvitation?.visible) scrollLatestAndNotificationIntoView();
  }, [notificationInvitation]);
  function dismissNotificationInvitation(openSettings: boolean) {
    if (!invitationId || !invitationAccount) return;
    if (openSettings) {
      window.dispatchEvent(new Event("dbc:open-renter-notifications"));
      return;
    }
    dismissChatNotificationOffer(String(invitationAccount));
    pinnedToLatest.current = true;
    setNotificationInvitation({ id: invitationId, visible: false });
  }
  function scrollToConversationEnd() {
    requestAnimationFrame(() => {
      const scroller = body.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
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
  const latestExtensionOffer = latestConversationMessage?.meta?.extensionOffer;
  const hasExtensionOffer = !admin && latestConversationMessage?.sender === "bot" && !!latestExtensionOffer && [latestExtensionOffer.items, latestExtensionOffer.availableItems, latestExtensionOffer.unavailableItems].some((items: any) => Array.isArray(items) && items.length > 0);
  const workspacePresentation = !!workspaceIdentity || (!admin && renterWorkspace);
  const pickupDirectionsHref = mapsDirectionsHref(handoverDetails?.pickupAddress);
  const returnDirectionsHref = mapsDirectionsHref(handoverDetails?.returnAddress);
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
        <div className={styles.headerActions}>
          {workspaceIdentity && adminActions}
          {!admin && <div className={styles.renterHeaderShortcuts}>
            {!teamHandling && <button type="button" data-testid="rental-gaffer-gear-help" aria-label="Ask Gaffer about gear, dates or a quote" title="Ask Gaffer about gear, dates or a quote" onClick={openGafferGearHelp} className={styles.renterHeaderShortcut}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 1.2 5.8L19 10l-5.8 1.2L12 17l-1.2-5.8L5 10l5.8-1.2L12 3Z"/><path d="m19 15 .6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6L19 15Z"/></svg><span className={styles.renterHeaderShortcutText}>Ask Gaffer</span>
            </button>}
            {!notificationInvitation?.visible && <button type="button" data-testid="renter-notification-settings" aria-label="Notification settings" title="Notification settings" onClick={() => window.dispatchEvent(new Event("dbc:open-renter-notifications"))} className={styles.renterHeaderShortcut}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0v5l-2 3v1h16v-1l-2-3V8ZM9 20h6"/></svg><span className={styles.renterHeaderShortcutText}>Alerts</span>
            </button>}
          </div>}
          {workspaceIdentity && onStar && <button type="button" onClick={onStar} disabled={starDisabled} aria-pressed={starred} aria-label={starred ? "Remove customer from starred" : "Star customer"} className={styles.starButton}><svg viewBox="0 0 24 24" fill={starred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5Z"/></svg></button>}{renterPhone && dialablePhone && /^\+?\d+$/.test(dialablePhone) && <a className={workspaceIdentity ? styles.workspaceCall : styles.phone} href={`tel:${dialablePhone}`} aria-label={`Call ${workspaceIdentity?.name || (thread && "renter" in thread ? thread.renter?.name : null) || "renter"} at ${renterPhone}`} title={renterPhone}>{workspaceIdentity ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 3h3l2 5-2 1.5a14 14 0 0 0 6.5 6.5l1.5-2 5 2v3a2 2 0 0 1-2 2C10.2 20.5 3.5 13.8 3 5a2 2 0 0 1 2-2Z" /></svg> : <>{renterPhone} <span aria-hidden="true">·</span></>}<span className={workspaceIdentity ? styles.workspaceCallLabel : undefined}>Call</span></a>}
        {workspaceIdentity ? <details className={styles.headerMenu}><summary aria-label="Conversation actions" title="Conversation actions">•••</summary><div><p>{teamHandling ? "Team handling this conversation" : "Gaffer is available"}</p><button type="button" onClick={handoff} disabled={handoffBusy} className={styles.handoff}>{handoffBusy ? "Updating…" : teamHandling ? "Hand to Gaffer" : "Take over"}</button></div></details> : (admin || teamHandling) && <button onClick={handoff} disabled={handoffBusy} className={styles.handoff}>
          {handoffBusy ? "Updating…" : admin ? teamHandling ? "Hand to Gaffer" : "Take over" : "Get back to Gaffer"}
        </button>}</div>
      </header>
      {!admin && handoverDetails && <section className={styles.handoverDetails} data-testid="renter-handover-details" aria-label="Confirmed collection and contact details">
        <div className={styles.handoverLocations}>
          {handoverDetails.pickupAddress && handoverDetails.returnAddress && handoverDetails.pickupAddress === handoverDetails.returnAddress
            ? <div><span>{handoverDetails.fulfilment === "delivery" ? "Delivery & return" : "Pickup & return"}</span><strong>{handoverDetails.pickupAddress}</strong>{pickupDirectionsHref && <a data-testid="renter-handover-map-link" href={pickupDirectionsHref} target="_blank" rel="noopener noreferrer" aria-label="Directions to pickup and return in Google Maps">Directions ↗</a>}</div>
            : <>{handoverDetails.pickupAddress && <div><span>{handoverDetails.fulfilment === "delivery" ? "Delivery to" : "Pickup"}</span><strong>{handoverDetails.pickupAddress}</strong>{pickupDirectionsHref && <a data-testid="renter-handover-map-link" href={pickupDirectionsHref} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${handoverDetails.fulfilment === "delivery" ? "delivery" : "pickup"} in Google Maps`}>Directions ↗</a>}</div>}{handoverDetails.returnAddress && <div><span>Return / drop-off</span><strong>{handoverDetails.returnAddress}</strong>{returnDirectionsHref && <a data-testid="renter-handover-return-map-link" href={returnDirectionsHref} target="_blank" rel="noopener noreferrer" aria-label="Directions to the return location in Google Maps">Directions ↗</a>}</div>}</>}
          {handoverDetails.pickupInstructions && <p>{handoverDetails.pickupInstructions}</p>}
        </div>
        <a href={`tel:${handoverDetails.phone.replace(/[^\d+]/g, "")}`} aria-label={`Call Leo at ${handoverDetails.phone}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 3h3l2 5-2 1.5a14 14 0 0 0 6.5 6.5l1.5-2 5 2v3a2 2 0 0 1-2 2C10.2 20.5 3.5 13.8 3 5a2 2 0 0 1 2-2Z" /></svg><span>Call Leo</span><strong>{handoverDetails.phone}</strong></a>
      </section>}
      <div className={`management-conversation-main ${styles.main}`}>
      <div className={styles.mainContent}>
      {(!workspaceIdentity || bookingId) && <div className={styles.bookingStrip}>
        <div>{!workspaceIdentity && <h4>{title}</h4>}<p>{bookingSummary ? `${bookingSummary.dates} · ${bookingSummary.count} ${bookingSummary.count === 1 ? "listing" : "listings"}` : bookingId ? "Messages, collection and return" : "Account support and enquiries"}</p>{bookingSummary?.handover && <p>{bookingSummary.handover}</p>}</div>
        <span className={styles.stage}>{stageLabel ?? RENTAL_STAGE_LABELS[stage] ?? stage}</span>
        {bookingId && admin && workspaceIdentity && !tools && <details className={styles.workspaceRentalDetails}><summary aria-label="Extension and price controls">Controls</summary><div><RentalExtensionPanel key={bookingId} token={token} bookingId={bookingId} admin /><RentalPricePanel key={`price-${bookingId}`} token={token} bookingId={bookingId} admin /></div></details>}
      </div>}
      {bookingId && (!admin || !tools) && !workspaceIdentity && <RentalVerificationSummary bookingId={bookingId} token={token} admin={admin}/>}
      {!admin && bookingId && (
        <RentalAdditionApproval token={token} bookingId={bookingId} />
      )}
      {bookingId && (!admin || !tools) && !workspaceIdentity && <RentalExtensionPanel key={bookingId} token={token} bookingId={bookingId} admin={admin} showTrigger={!hasExtensionOffer} paymentRequestsInChat={extensionPaymentRequestIdsInChat} />}
      {bookingId && (!admin || !tools) && !workspaceIdentity && <RentalPricePanel key={`price-${bookingId}`} token={token} bookingId={bookingId} admin={admin}/>}
      {!admin && bookingId && <SavedCardCharges token={token} bookingId={bookingId} />}
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
            const verificationCard = m.sender === "system" && !admin && Boolean(bookingId) && m.meta?.kind === "verification_update" && ["processing", "verified", "manual_review", "requires_input", "rejected"].includes(m.meta?.status);
            const standaloneHandoffMessage = !admin && m.sender === "bot" && m.meta?.offerHuman === true && /^\s*(?:i can ask (?:the )?team to help|would you like (?:me to )?ask (?:the )?team to help|would you like (?:our )?team to join(?: the conversation)?|want (?:our )?team to join)[?.!\s]*$/i.test(m.text);
            const confirmationCard = m.sender === "system" && m.meta?.kind === "booking_confirmation" && (m.meta.stage === "confirmed" || m.meta.stage === "active");
            const reminderCard = m.sender === "system" && m.meta?.kind === "rental_chat_reminder" && ["pickup", "return", "halfway"].includes(m.meta.reminderKind);
            const decisionCard = m.sender === "system" && m.meta?.type === "rental_change_decision" && ["dates", "items", "delivery", "handover", "cancel", "refund", "extension"].includes(m.meta.requestKind) && ["approved", "declined", "closed"].includes(m.meta.outcome ?? m.meta.decision);
            const dedicatedMessageCard = confirmationCard || decisionCard || reminderCard || hasDedicatedMessageCard(m.meta, admin);
            const decisionRequestNames: Record<string, string> = { dates: "Date change", items: "Kit change", delivery: "Delivery", handover: "Pickup / return time", cancel: "Cancellation", refund: "Refund request", extension: "Extension" };
            const decisionOutcome = m.meta?.outcome ?? m.meta?.decision;
            const decisionStatus = decisionOutcome === "closed" ? "Closed · unchanged" : decisionOutcome === "declined" ? "Declined" : m.meta?.requestKind === "refund" ? "Follow-up only" : ["delivery", "items"].includes(m.meta?.requestKind) ? "Quote next" : "Arrange next";
            const decisionTone = decisionOutcome === "declined" || decisionOutcome === "closed" ? "attention" : "neutral";
            const paymentUrl = approvedStripeCheckoutUrl(m.meta?.url);
            const checkoutCartPath = approvedCheckoutCartPath(m.meta?.path);
            return (<Fragment key={m._id}>
              {date !== previousDate && <p className="management-conversation-date self-stretch text-center text-[10px] text-white/40"><span>{date}</span></p>}
              <div
                data-message-id={m._id}
                data-sender={m.sender}
                data-mine={mine}
                className={`management-conversation-message ${styles.message}`}
              >
                <div className={`management-conversation-message-row flex max-w-full items-start gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                {!(m.sender === "system" && !admin) && <ChatAvatar key={`${m.sender}-${thread && "renter" in thread ? thread.renter?.photo : ""}`} sender={m.sender} name={thread && "renter" in thread ? thread.renter?.name : null} photo={thread && "renter" in thread ? thread.renter?.photo : null} />}
                <div className={styles.messageContent}>
                  <div className={styles.messageMeta}><strong>{label}</strong><time dateTime={new Date(m.at).toISOString()}>{new Date(m.at).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit"})}</time></div>
                <div
                  className={`management-conversation-message-copy min-w-0 max-w-full rounded-2xl border px-4 py-3 text-sm leading-relaxed ${m.sender === "bot" ? "border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-50" : m.sender === "owner" ? "border-accent-300/25 bg-accent-500/15 text-orange-50" : m.sender === "system" ? "border-dashed border-sky-200/20 bg-sky-300/[0.04] text-sky-100/70" : "border-violet-300/20 bg-violet-300/10 text-violet-50"}`}
                  style={dedicatedMessageCard ? { border: 0, background: "transparent", padding: 0 } : undefined}
                >
                  {!verificationCard && !standaloneHandoffMessage && !dedicatedMessageCard && <ChatMessageText text={m.meta?.kind === "review_invitation" ? m.text.replace(/\s*\[Leave your rental review\]\([^)]*\)/, "") : m.text} allowAdminNavigation={admin && m.sender === "owner"} />}
                  {confirmationCard && <AutomatedRentalMessageCard eyebrow="Rental update" title={m.meta.stage === "active" ? "Your rental is on hire" : "Your booking is confirmed"} status={m.meta.stage === "active" ? "On hire" : "Confirmed"} tone="success" kind="confirmation" items={Array.isArray(m.meta.items) ? m.meta.items : []} itemCount={m.meta.itemCount}><ChatMessageText text={m.text} allowAdminNavigation={admin} /></AutomatedRentalMessageCard>}
                  {reminderCard && <AutomatedRentalMessageCard eyebrow="Rental reminder" title={m.meta.reminderKind === "pickup" ? "Scheduled handover" : m.meta.reminderKind === "return" ? "Scheduled return" : "Rental check-in"} status={m.meta.reminderKind === "halfway" ? "Check-in" : "Scheduled"} tone="neutral" kind="reminder"><ChatMessageText text={m.text} /></AutomatedRentalMessageCard>}
                  {decisionCard && <AutomatedRentalMessageCard eyebrow="Request update" title={decisionRequestNames[m.meta.requestKind] ?? "Rental request"} status={decisionStatus} tone={decisionTone} kind="decision" detailKind={m.meta.requestKind === "refund" ? "refund" : ["dates", "handover"].includes(m.meta.requestKind) ? "reschedule" : undefined}><ChatMessageText text={m.text} allowAdminNavigation={admin} /></AutomatedRentalMessageCard>}
                  {dedicatedMessageCard && m.sender === "system" && (m.meta?.kind === "delivery_quote" || m.meta?.kind === "rental_item_swap" || m.meta?.type === "rental_item_swap") && <details data-testid="structured-message-details" className="mt-2 rounded-xl border border-white/[0.08] bg-black/15 px-3 py-2 text-[10px] text-white/55"><summary className="cursor-pointer font-medium text-white/75">Message details</summary><div className="mt-2 leading-relaxed"><ChatMessageText text={m.text} /></div></details>}
                  {m.sender === "system" && !admin && bookingId && m.meta?.kind === "verification_update" && m.meta?.status === "processing" && (verificationWindowClosed ? <section data-testid="verification-window-closed-card" aria-label="Verification window passed" className="mt-1 overflow-hidden rounded-2xl border border-amber-200/20 bg-[radial-gradient(ellipse_at_top_left,rgba(252,211,77,.12),transparent_62%),linear-gradient(135deg,rgba(255,255,255,.07),rgba(255,255,255,.025))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_16px_36px_rgba(0,0,0,.2)] backdrop-blur-2xl">
                    <div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-200/20 bg-amber-200/[.07] text-amber-100" aria-hidden="true"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6"/><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-amber-100/65">Verification</p><h4 className="mt-1 text-sm font-semibold text-white/90">Window passed</h4><p className="mt-1 text-xs leading-relaxed text-white/55">Online verification is closed for this rental. Message the team for next steps.</p></div></div>
                    <button type="button" data-testid="verification-window-closed-reply" onClick={() => { composerInput.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); composerInput.current?.focus(); }} className="mt-3 inline-flex min-h-[45px] w-full items-center justify-center rounded-xl border border-amber-100/20 bg-amber-100/[.08] px-3 py-2 text-xs font-medium text-amber-50">Message the team</button>
                  </section> : <section data-testid="verification-continue-card" aria-label="Continue rental verification" className="mt-1 overflow-hidden rounded-2xl border border-[#dfbd91]/20 bg-[radial-gradient(ellipse_at_top_left,rgba(219,174,122,.16),transparent_62%),linear-gradient(135deg,rgba(255,255,255,.07),rgba(255,255,255,.025))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_16px_36px_rgba(0,0,0,.2)] backdrop-blur-2xl">
                    <div className="flex items-center gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#e5c69f]/20 bg-[#e5c69f]/[.07] text-[#e7c59c]" aria-hidden="true">
                        <svg viewBox="0 0 40 40" className="h-7 w-7 overflow-visible" fill="none">
                          <path d="M4 20s5.7-10 16-10 16 10 16 10-5.7 10-16 10S4 20 4 20Z" stroke="currentColor" strokeWidth="1.7" />
                          <circle cx="20" cy="20" r="6.2" stroke="currentColor" strokeWidth="1.5" />
                          <circle cx="20" cy="20" r="2.4" fill="currentColor" className={styles.verificationEyeIris} />
                          <circle cx="22.4" cy="17.6" r="1" fill="white" fillOpacity=".9" />
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#e7c59c]/65">Verification</p>
                        <h4 className="mt-1 text-sm font-semibold text-white/90">Continue with Didit</h4>
                        <p className="mt-1 text-xs leading-relaxed text-white/55">Your rental is paid, but not confirmed yet.</p>
                      </div>
                    </div>
                    <a data-testid="verification-continue-link" href={`/account/verification/${encodeURIComponent(bookingId)}`} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#f1d0a5]/20 bg-gradient-to-r from-[#e8c39a] to-[#c99769] px-4 py-2 text-xs font-semibold text-[#21170e] shadow-[0_8px_20px_rgba(201,151,105,.16)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8c39a]">
                      Open verification <span aria-hidden="true">↗</span>
                    </a>
                  </section>)}
                  {m.sender === "system" && !admin && bookingId && m.meta?.kind === "verification_update" && ["verified", "manual_review", "requires_input", "rejected"].includes(m.meta?.status) && <section data-testid={`verification-${m.meta.status}-card`} aria-label="Verification update" className={`mt-1 overflow-hidden rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_16px_36px_rgba(0,0,0,.2)] backdrop-blur-2xl ${m.meta.status === "verified" ? "border-emerald-200/20 bg-[radial-gradient(ellipse_at_top_left,rgba(110,231,183,.14),transparent_62%),linear-gradient(135deg,rgba(255,255,255,.07),rgba(255,255,255,.025))]" : "border-amber-200/20 bg-[radial-gradient(ellipse_at_top_left,rgba(252,211,77,.12),transparent_62%),linear-gradient(135deg,rgba(255,255,255,.07),rgba(255,255,255,.025))]"}`}>
                    <div className="flex items-center gap-3">
                      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${m.meta.status === "verified" ? "border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100" : "border-amber-200/20 bg-amber-200/[.07] text-amber-100"}`} aria-hidden="true">
                        {m.meta.status === "verified" ? <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" /><path d="m7.5 12.2 3 3 6-6.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : m.meta.status === "manual_review" ? <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" /><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg> : <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none"><path d="M7 3.8h7l4 4v12.4H7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 4v4h4M9.5 13h6M9.5 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/55">Verification</p>
                        <h4 className="mt-1 text-sm font-semibold text-white/90">{m.meta.status === "verified" ? "Approved" : m.meta.status === "manual_review" ? "Team review" : m.meta.status === "rejected" ? "Not approved" : verificationWindowClosed ? "Window passed" : "One more step"}</h4>
                        <p className="mt-1 text-xs leading-relaxed text-white/55">{m.meta.status === "verified" ? m.meta.supportPhone && handoverDetails ? m.meta.handoverMode === "pickup" ? "Your collection details are in the booking." : "Your delivery details are in the booking." : "Approval passed. We’re confirming your rental." : m.meta.status === "manual_review" ? "We’ll update you here." : m.meta.status === "rejected" ? "Message the team in this chat to discuss next steps." : verificationWindowClosed ? "Online verification is closed for this rental. Message the team for next steps." : "Didit needs updated information."}</p>
                      </div>
                    </div>
                    {(m.meta.status === "verified" || m.meta.status === "requires_input" || m.meta.status === "rejected") && <div className="mt-3 flex flex-wrap gap-2">
                      {m.meta.status === "verified" && handoverDetails?.fulfilment === "pickup" && !!handoverDetails.pickupAddress && typeof m.meta.pickupMapUrl === "string" && /^https:\/\/www\.google\.com\/maps\/search\//.test(m.meta.pickupMapUrl) && <a href={m.meta.pickupMapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-emerald-100/20 bg-emerald-100/[.08] px-3 py-2 text-xs font-medium text-emerald-50">Open pickup map ↗</a>}
                      {m.meta.status === "verified" && typeof m.meta.supportPhone === "string" && m.meta.supportPhone === handoverDetails?.phone && /^\+[\d ()-]{8,20}$/.test(m.meta.supportPhone) && <a href={`tel:${m.meta.supportPhone.replace(/[^+\d]/g, "")}`} aria-label={`Call Leo at ${m.meta.supportPhone}`} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[.05] px-3 py-2 text-xs font-medium text-white/80"><span>Call Leo</span><span className="text-[10px] text-white/55">{m.meta.supportPhone}</span></a>}
                      {m.meta.status === "requires_input" && (verificationWindowClosed
                        ? <button type="button" data-testid="verification-expired-reply" onClick={() => { composerInput.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); composerInput.current?.focus(); }} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-100/20 bg-amber-100/[.08] px-3 py-2 text-xs font-medium text-amber-50">Message the team</button>
                        : <a data-testid="verification-resubmit-link" href={`/account/verification/${encodeURIComponent(bookingId)}`} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-amber-100/20 bg-amber-100/[.08] px-3 py-2 text-xs font-medium text-amber-50">Continue verification ↗</a>)}
                      {m.meta.status === "rejected" && <button type="button" data-testid="verification-rejected-reply" onClick={() => { composerInput.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); composerInput.current?.focus(); }} className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-amber-100/20 bg-amber-100/[.08] px-3 py-2 text-xs font-medium text-amber-50">Reply in this chat</button>}
                    </div>}
                    {m.meta.status === "rejected" && <details data-testid="verification-rejected-details" className="mt-3 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-white/55"><summary className="cursor-pointer font-medium text-white/75">Read full message</summary><p className="mt-2 whitespace-pre-wrap leading-relaxed">{m.text}</p></details>}
                  </section>}
                  {m.meta?.kind === "extension_request" && Array.isArray(m.meta.items) && m.meta.items.length > 0 && <section data-testid="extension-request-chat-card" aria-label="Rental extension request" className="mt-3 overflow-hidden rounded-2xl border border-sky-200/15 bg-gradient-to-br from-sky-200/[0.09] via-white/[0.035] to-transparent p-3 shadow-[inset_0_1px_0_#ffffff0b] backdrop-blur-xl">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-sky-100/55">Rental change</p><h4 className="mt-1 text-sm font-semibold text-white/90">Extension request</h4></div><span className="rounded-full border border-amber-200/15 bg-amber-200/[0.06] px-2 py-1 text-[10px] text-amber-100/75">Awaiting approval</span></div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">{m.meta.items.map((item: any, itemIndex: number) => <article key={`${m._id}-extension-request-${item.lineIndex ?? itemIndex}`} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-2">
                      <SmartImage fit="contain" src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={`${item.title} listing photo`} className="h-12 w-14 shrink-0 rounded-lg bg-white/[0.025]" />
                      <div className="min-w-0 flex-1"><p className="truncate text-xs text-white/80">{item.qty}× {rentalTitle(item.title)}</p><p className="mt-0.5 text-[10px] text-white/40">Return {new Date(item.end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · {m.meta.returnTime} London</p></div>
                    </article>)}</div>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-2"><span className="text-[11px] text-white/50">{m.meta.extraDays} extra day{m.meta.extraDays === 1 ? "" : "s"}{m.meta.benefitSaving > 0 ? ` · ${m.meta.benefitLabel} saves £${Number(m.meta.benefitSaving).toFixed(2)}` : ""}</span><strong className="text-base font-semibold text-white">£{Number(m.meta.amount).toFixed(2)}</strong></div>
                    <p className="mt-2 text-[10px] leading-relaxed text-white/40">Original return times apply until approved and paid.</p>
                  </section>}
                  {m.meta?.kind === "extension_payment" && Array.isArray(m.meta.items) && m.meta.items.length > 0 && <section data-testid="extension-payment-chat-card" aria-label="Approved rental extension payment" className="mt-3 max-w-3xl overflow-hidden rounded-[26px] border border-white/20 bg-[radial-gradient(ellipse_at_100%_100%,rgba(169,111,49,.2),transparent_42%),linear-gradient(145deg,#292a2c,#17181b_48%,#1c1b1b)] p-4 shadow-[inset_0_1px_rgba(255,255,255,.1),0_16px_40px_rgba(0,0,0,.25)] sm:p-6">
                    <div className="text-center"><ChatAperture /><p className="mt-1 text-[10px] font-semibold uppercase tracking-[.15em] text-amber-100/70">Approved rental change</p><h4 className="mt-2 text-xl font-semibold tracking-tight text-white">Confirm extra time</h4><span className="mt-2 inline-flex rounded-full border border-amber-100/20 bg-amber-100/[.06] px-3 py-1 text-[11px] text-amber-50/85">Ready to pay</span></div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">{m.meta.items.map((item: any, itemIndex: number) => <article key={`${m._id}-extension-payment-${item.lineIndex ?? itemIndex}`} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <SmartImage fit="contain" src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={`${item.title} listing photo`} className="h-16 w-[68px] shrink-0 rounded-xl bg-white/[0.025]" />
                      <div className="min-w-0 flex-1"><p className="break-words text-xs font-semibold text-white/90">{item.qty}× {rentalTitle(item.title)}</p><p className="mt-1 text-[11px] leading-relaxed text-white/65">Return {new Date(item.end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · {m.meta.returnTime} London</p></div>
                    </article>)}</div>
                    {m.meta.lateBreakdown && [m.meta.lateBreakdown.latePence, m.meta.lateBreakdown.extensionPence, m.meta.lateBreakdown.discountPence].every((value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) && <dl data-testid="late-extension-payment-breakdown" className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-white/75">
                      <div className="flex justify-between gap-3"><dt>Overdue rental time</dt><dd>£{(m.meta.lateBreakdown.latePence / 100).toFixed(2)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>Additional extension</dt><dd>£{(m.meta.lateBreakdown.extensionPence / 100).toFixed(2)}</dd></div>
                      {m.meta.lateBreakdown.discountPence > 0 && <div className="flex justify-between gap-3 text-emerald-200"><dt>Extension savings</dt><dd>−£{(m.meta.lateBreakdown.discountPence / 100).toFixed(2)}</dd></div>}
                      {typeof m.meta.lateBreakdown.customFee?.description === "string" && Number.isSafeInteger(m.meta.lateBreakdown.customFee?.amountPence) && m.meta.lateBreakdown.customFee.amountPence > 0 && <div className="flex justify-between gap-3"><dt className="break-words">{m.meta.lateBreakdown.customFee.description}</dt><dd>£{(m.meta.lateBreakdown.customFee.amountPence / 100).toFixed(2)}</dd></div>}
                    </dl>}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-100/20 bg-gradient-to-r from-white/[.07] to-amber-100/[.04] px-4 py-3"><span className="text-xs leading-relaxed text-white/75">{m.meta.lateBreakdown ? "Amount to pay" : <>{m.meta.extraDays} extra day{m.meta.extraDays === 1 ? "" : "s"}{m.meta.benefitSaving > 0 ? ` · ${m.meta.benefitLabel} saves £${Number(m.meta.benefitSaving).toFixed(2)}` : ""}</>}</span><strong className="text-xl font-semibold text-amber-100">£{Number(m.meta.amount).toFixed(2)}</strong></div>
                    <p className="mt-3 text-xs leading-relaxed text-white/70">Your original return time stays in place until payment succeeds. Payment link expires in 24 hours.</p>
                    {paymentUrl ? <a data-testid="extension-payment-chat-link" href={paymentUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ffda90] to-[#c99452] px-4 py-2 text-sm font-semibold text-[#17120d] shadow-[inset_0_1px_rgba(255,255,255,.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100">Pay securely &amp; confirm</a> : <p role="status" className="mt-3 text-[11px] text-amber-100/75">Payment link unavailable · ask us here for a new link.</p>}
                  </section>}
                  {m.meta?.kind === "late_extension_offer" && <LateExtensionOffer token={token} meta={m.meta} admin={admin} />}
                  {m.sender === "bot" && Array.isArray(m.meta?.catalogueItems) && m.meta.catalogueItems.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Gaffer gear suggestions">
                    {m.meta.catalogueItems.slice(0, 4).map((item: any) => {
                      const listingPath = approvedGearListingPath(item.slug);
                      const availabilityLabel = !listingPath ? "Listing unavailable" : item.availability === "available" ? "Open for dates" : item.availability === "unavailable" ? "No extra stock" : item.availability === "times_required" ? "Times needed" : item.availability === "dates_required" ? "Dates needed" : "Check dates";
                      const availabilityClass = !listingPath ? "border-white/10 bg-white/[0.04] text-white/55" : item.availability === "available" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : item.availability === "unavailable" ? "border-amber-300/20 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/[0.04] text-white/55";
                      return <article key={`${m._id}-${item.slug ?? item.title}`} data-testid="gaffer-catalogue-card" className="min-w-0 rounded-xl border border-white/10 bg-white/[0.035] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
                      <SmartImage fit="cover" src={item.heroImage ?? item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={item.title} className="mb-3 aspect-[16/9] w-full rounded-lg" />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><span className="text-[10px] uppercase tracking-[0.16em] text-white/45">{item.category}</span><h4 className="mt-1 break-words text-sm font-medium text-white/90">{item.title}</h4></div>
                        <span data-testid="gaffer-catalogue-availability" className={`shrink-0 rounded-full border px-2 py-1 text-[10px] ${availabilityClass}`}>
                          {availabilityLabel}
                        </span>
                      </div>
                      {listingPath && <div className="mt-3 flex items-end justify-between gap-3">
                        <p className="min-w-0 text-xs text-white/55">{item.memberTotal != null ? <><span className="block text-[10px] uppercase tracking-[0.12em] text-emerald-100/65">Member price</span><strong className="text-sm font-semibold text-white/90">£{Number(item.memberTotal).toFixed(2)}</strong><span className="ml-1">for {item.days} day{item.days === 1 ? "" : "s"}</span><span className="block text-[10px] text-white/45">Standard £{Number(item.total).toFixed(2)} · saves £{Number(item.memberSaving).toFixed(2)}</span></> : item.total != null ? <><strong className="text-sm font-semibold text-white/90">£{Number(item.total).toFixed(2)}</strong><span className="ml-1">for {item.days} day{item.days === 1 ? "" : "s"}</span></> : item.daily != null ? `From £${Number(item.daily).toFixed(2)} / day` : "Choose dates for a quote"}</p>
                      <a data-testid="gaffer-catalogue-card-link" href={listingPath} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-accent-300/20 bg-accent-300/[0.08] px-3 text-xs text-accent-100 transition hover:border-accent-200/40 hover:bg-accent-300/[0.14]">View &amp; add</a>
                      </div>}
                    </article>;
                    })}
                    <p className="sm:col-span-2 text-[10px] leading-relaxed text-white/35">Availability is a live check, not a reservation. Member savings are shown when eligible; delivery and other checkout adjustments are separate.</p>
                  </div>}
                  {m.meta?.kind === "checkout_cart" && checkoutCartPath && Array.isArray(m.meta.items) && m.meta.items.length > 0 && <section data-testid="customer-checkout-cart-card" aria-label="Rental kit checkout link" className="mt-3 w-full max-w-xl overflow-hidden rounded-2xl border border-accent-200/15 bg-[linear-gradient(145deg,rgba(232,195,154,.09),rgba(255,255,255,.035)_45%,rgba(0,0,0,.18))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,.06)] backdrop-blur-xl sm:p-4">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[.16em] text-accent-100/55">Your gear selection</p><h4 className="mt-1 text-sm font-semibold text-white/90">Ready to review</h4></div><span className="rounded-full border border-white/10 bg-black/15 px-2 py-1 text-[10px] text-white/55">{m.meta.items.length} item{m.meta.items.length === 1 ? "" : "s"}</span></div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{m.meta.items.slice(0, 4).map((item: any, index: number) => <article key={`${m._id}-checkout-item-${index}`} className="min-w-0 overflow-hidden rounded-xl border border-white/[.08] bg-black/15">
                      <SmartImage fit="cover" src={item.heroImage ?? item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={item.title ?? "Rental listing"} className="aspect-[4/3] w-full bg-white/[.025]" />
                      <p className="line-clamp-2 px-2 py-1.5 text-[10px] leading-snug text-white/70">{item.title}</p>
                    </article>)}</div>
                    {m.meta.items.length > 4 && <p className="mt-2 text-[10px] text-white/45">+{m.meta.items.length - 4} more listing{m.meta.items.length - 4 === 1 ? "" : "s"}</p>}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">{typeof m.meta.total === "number" && Number.isFinite(m.meta.total) ? <p className="text-xs text-white/55">Indicative gear total <strong className="ml-1 text-sm text-white/90">£{m.meta.total.toFixed(2)}</strong></p> : <p className="text-xs text-white/50">Add dates for a price</p>}<a data-testid="customer-checkout-cart-link" href={checkoutCartPath} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#e8c39a] to-[#c99769] px-4 py-2 text-xs font-semibold text-[#21170e] shadow-[0_8px_20px_rgba(201,151,105,.16)] transition hover:brightness-105">Review kit &amp; checkout <span aria-hidden="true">↗</span></a></div>
                    <p className="mt-2 text-[10px] leading-relaxed text-white/35">Exact times, delivery and payment are confirmed at checkout. This link does not reserve stock.</p>
                  </section>}
                  {m.sender === "bot" && m.meta?.extensionOffer && [m.meta.extensionOffer.items, m.meta.extensionOffer.availableItems, m.meta.extensionOffer.unavailableItems].some((items: any) => Array.isArray(items) && items.length > 0) && <GafferExtensionOfferCard offer={m.meta.extensionOffer} bookingItems={bookingSummary?.items?.map((item,index)=>({...item,index:item.index??index}))} legacy={!m.meta.extensionOffer.quoteStatus && !m.meta.extensionOffer.availableIndexes && !m.meta.extensionOffer.unavailableItems} interactive={!admin} />}
                  {!admin && !teamHandling && m.sender === "bot" && m._id === latestConversationMessage?._id && m.meta?.offerHuman === true && <HumanHandoffOffer key={`${scopeKey}:${m._id}`} onRequest={async () => { await human({ token, bookingId: bookingId as any, offerMessageId: m._id as any }); }} />}
                  {m.meta?.kind === "attachment" && m.meta.attachmentId && <ChatAttachmentPreview key={`${scopeKey}:${m.meta.attachmentId}`} token={token} id={m.meta.attachmentId} name={m.meta.name || "attachment"} contentType={typeof m.meta.contentType === "string" ? m.meta.contentType : undefined} bookingId={bookingId} accountId={accountId} admin={admin} />}
                  {admin && m.meta?.kind === "attachment" && m.meta.attachmentId && <AttachmentAdminControls key={m.meta.attachmentId} token={token} id={m.meta.attachmentId}/>}
                  {m.meta?.kind === "full_credit_offer" && !admin && <RentalCreditOffer token={token} offerId={m.meta.offerId} />}
                  {m.meta?.kind === "review_invitation" && !admin && bookingId && <BookingReview key={bookingId} bookingId={bookingId} token={token} inline />}
                  {m.meta?.kind === "delivery_quote" && !admin && m.meta.quoteId && <RentalDeliveryQuoteApproval token={token} quoteId={m.meta.quoteId} />}
                  {!admin && bookingId && (m.meta?.kind === "rental_item_swap" || m.meta?.type === "rental_item_swap") && m.meta.swapId && <RentalSwapApproval key={m.meta.swapId} token={token} bookingId={bookingId} swapId={m.meta.swapId}/>}
                  {m.meta?.kind === "paylink" && paymentUrl && (
                    <a
                      href={paymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="chat-paylink-button"
                      className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-100/20 bg-emerald-100/[.08] px-4 py-2 text-xs font-semibold text-emerald-50"
                    >
                      Review payment · £{m.meta.amount}
                    </a>
                  )}
                  {m.meta?.kind === "paylink" && !paymentUrl && <p role="alert" className="mt-2 text-[11px] text-amber-100/75">Secure payment link unavailable · ask us here for a new link.</p>}
                  {workspacePresentation && <time className={styles.bubbleTime} dateTime={new Date(m.at).toISOString()}>{new Date(m.at).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit"})}</time>}
                </div>
                </div>
                </div>
              </div>
              {!admin && notificationDeviceStatus === "inactive" && notificationInvitation?.id === String(m._id) && notificationInvitation.visible && <div className={styles.notificationCard} aria-label="Chat notifications">
                <span className={styles.notificationIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 8a6 6 0 0 0-12 0v5l-2 3v1h16v-1l-2-3V8ZM9 20h6"/><path d="M18.5 3v3m-1.5-1.5h3"/></svg></span>
                <div className={styles.notificationCopy}><strong>Chat alerts</strong><p><span className={styles.notificationDesktop}>Open setup, then choose Enable notifications for this device.</span><span className={styles.notificationMobile}>{notificationPlatform === "ios" ? <>iPhone: Safari → <svg className={styles.notificationShareIcon} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg> Share → <svg className={styles.notificationAddIcon} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg> Add to Home Screen</> : notificationPlatform === "android" ? "Android: Chrome ⋮ → Install app" : "Browser menu ⋮ → Install app"}</span></p><div><button type="button" onClick={() => dismissNotificationInvitation(true)}>Open setup</button><button type="button" onClick={() => dismissNotificationInvitation(false)}>Not now</button></div></div>
              </div>}
              </Fragment>
            );
          })}
          </>
        )}
        {bookingSummary?.items?.length ? <section className={styles.rentalItemsCard} data-testid="rental-items-in-chat" aria-label="Items in this rental">
          <div className={styles.rentalItemsHeading}><strong>{renterWorkspace ? `Your kit · ${bookingSummary.dates}` : bookingSummary.heading ?? "Items in this rental"}</strong><span>{renterWorkspace ? stageLabel ?? stage : `${bookingSummary.items.length} ${bookingSummary.items.length === 1 ? "listing" : "listings"}`}</span></div>
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
        {tools && !admin && <details className={styles.renterControls} data-testid="renter-chat-controls" aria-label="Rental actions" onToggle={(event) => { if (event.currentTarget.open) scrollToConversationEnd(); }} onClick={scrollToConversationEnd}>
          <summary data-testid="renter-chat-controls-summary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="11" cy="18" r="1" fill="currentColor"/></svg>
            <span>Rental actions</span>
            <svg className={styles.renterControlsChevron} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
          </summary>
          <div className={styles.renterControlsContent}>{tools}</div>
        </details>}
      </div>
      </div>
      <footer ref={composer} data-testid={!admin ? "renter-chat-composer" : undefined} className={styles.composer}>
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
          <div role="alert" data-testid="renter-chat-error" className="mb-3 grid gap-2 rounded-xl border border-rose-200/15 bg-rose-200/[0.045] px-3 py-2.5 text-xs text-rose-100/90">
            <span>{error}</span>
            {!admin && <div className="flex flex-wrap gap-2"><a href="/contact" className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-3 text-[11px] font-medium text-white/80 transition hover:bg-white/[0.08]">Contact form</a><EmailLink label="Email support" subject="DB Cinema support request" className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-3 text-[11px] font-medium text-white/80 transition hover:bg-white/[0.08]" /></div>}
          </div>
        )}
        {attachmentsAvailabilityChecked && !attachmentsAvailable && <p role="status" data-testid="chat-attachments-unavailable" className="mb-2 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs text-white/55">File sharing is temporarily unavailable.</p>}
        {attachmentFeedback && <div role={attachmentFeedback === "rejected" ? "alert" : "status"} aria-live={attachmentFeedback === "rejected" ? "assertive" : "polite"} data-testid="chat-attachment-upload-status" className={`mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${attachmentFeedback === "rejected" ? "border-rose-200/20 bg-rose-200/[.05] text-rose-100/85" : "border-white/10 bg-white/[.035] text-white/65"}`}>
          <span>{attachmentFeedback === "checking" ? "Checking this file securely…" : attachmentFeedback === "pending" ? "Still checking. Nothing was shared yet." : attachmentFeedback === "rejected" ? "This file could not pass security checks. It was not shared." : "Security checks are temporarily unavailable. Nothing was shared."}</span>
          {attachmentRetry && <button type="button" data-testid="chat-attachment-retry" disabled={attachmentBusy} onClick={() => void uploadAttachment(attachmentRetry.file, attachmentRetry.clean, attachmentRetry.prepared)} className="min-h-9 rounded-full border border-white/15 px-3 font-medium text-white/80 transition hover:bg-white/[.08] disabled:opacity-50">{attachmentFeedback === "pending" ? "Check again" : "Retry upload"}</button>}
        </div>}
        {admin && emailReplyContext && <p data-testid="email-chat-reply-routing" role="status" className="mb-2 text-[11px] text-sky-200/80">Email thread · your reply will be emailed and saved here.</p>}
        {admin && emailReplyContext && emailReplyStatusLoading && <p role="status" className="mb-2 rounded-xl border border-sky-200/20 bg-sky-200/[0.06] px-3 py-2 text-xs text-sky-100/80">Checking the last email delivery…</p>}
        {admin && emailReplyContext && emailReplyDeliveryStatus && <p role="alert" data-testid="email-delivery-unclear" className="mb-2 rounded-xl border border-amber-200/25 bg-amber-200/[0.08] px-3 py-2 text-xs leading-5 text-amber-50">{emailReplyDeliveryStatus === "uncertain" ? "Delivery unclear — check before sending again. The earlier email may have reached the renter, so this email reply is paused." : "An email reply is already sending. Wait before trying again."}</p>}
        {cleanCandidate && attachmentsAvailable && <div className={styles.cleanOption} data-testid="clean-copy-option"><div className={styles.cleanOptionHeader}><span className={styles.cleanOptionIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3 4.5 6v5.5c0 4.4 2.8 7.7 7.5 9.5 4.7-1.8 7.5-5.1 7.5-9.5V6L12 3Z"/><path d="m8.8 12 2.1 2.1 4.4-4.4"/><path d="M18.2 2.7v3m-1.5-1.5h3"/></svg></span><strong>Try a clean copy</strong><button type="button" aria-label="Dismiss cleaned image option" onClick={() => setCleanCandidate(null)}>×</button></div><p>Removes photo metadata. Colours may shift; original stays unchanged.</p><button data-testid="clean-copy-send" type="button" disabled={attachmentBusy} onClick={() => void uploadAttachment(cleanCandidate, true)} className={styles.cleanOptionAction}>Send clean PNG</button></div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className={styles.composeForm}
        >
          {attachmentsAvailable && <>
            <input ref={attachmentInput} type="file" accept={CHAT_ATTACHMENT_ACCEPT} aria-label="Choose a supported chat image or TXT file" className="sr-only" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; void uploadAttachment(file); }} />
            <button data-testid="chat-attachment-button" type="button" disabled={attachmentBusy} onClick={() => attachmentInput.current?.click()} aria-label={CHAT_ATTACHMENT_HELP} title={CHAT_ATTACHMENT_HELP} className={`rounded-2xl border border-white/15 px-3 text-sm text-white/70 disabled:opacity-40 ${styles.attachButton}`}>{attachmentBusy ? "…" : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 12.5 6.8-6.8a3.5 3.5 0 0 1 5 5l-8.3 8.3a5 5 0 0 1-7-7l8-8"/><path d="m7.5 15 8-8"/></svg>}</button>
          </>}
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
            placeholder="Type a message…"
            className="min-h-11 flex-1 resize-none rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-accent-400/50"
          />
          {workspacePresentation && <div className={styles.emojiControl} onKeyDown={event => { if (event.key === "Escape") { setEmojiOpen(false); composerInput.current?.focus(); } }}>
            <button type="button" className={styles.emojiToggle} aria-label="Add an emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(open => !open)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14c.7 1.6 2 2.4 4 2.4s3.3-.8 4-2.4M8.5 9h.01M15.5 9h.01" strokeLinecap="round" strokeWidth="2"/></svg></button>
            {emojiOpen && <div className={styles.emojiPicker} role="group" aria-label="Choose an emoji">{["😊", "👍", "🎬", "❤️", "🙏", "✨"].map(emoji => <button type="button" key={emoji} aria-label={`Insert ${emoji}`} onClick={() => { const input = composerInput.current; const start = input?.selectionStart ?? text.length; const end = input?.selectionEnd ?? start; const fits = text.length - (end - start) + emoji.length <= 2000; if (fits) setText(current => current.slice(0, start) + emoji + current.slice(end)); setEmojiOpen(false); requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(fits ? start + emoji.length : start, fits ? start + emoji.length : end); }); }}>{emoji}</button>)}</div>}
          </div>}
          <button
            disabled={busy || !text.trim() || !!(admin && emailReplyContext && (emailReplyStatusLoading || emailReplyDeliveryStatus))}
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
