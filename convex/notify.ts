"use node";

import { createHash } from "node:crypto";
import {rentalEmail,emailRows,emailMoney,emailEscape} from "../shared/rentalEmail";
import { CONTACT_EMAIL } from "../src/lib/site";
import { rentalSecurityEmailRows, rentalSecurityEmailNote } from "../shared/rentalSecurityEmail";
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { sendMail } from "./lib/mailer";
import { sendRentalContextEmail } from "./lib/rentalContextEmail";
import { CANCELLATION_CREDIT_DAYS } from "../src/lib/cancellationPolicy";
import { bookingStockLines } from "../shared/rentalWindow";
import { LEO_SUPPORT_PHONE, pickupMapAvailable, TRAFALGAR_PICKUP_INSTRUCTIONS } from "../shared/pickupLocation";
import { WATERSTONES_MAP_URL } from "./lib/pickupMap";
import { bookingVerificationExpired, verificationExpired, verificationValidUntil, verificationWindowClosed } from "../shared/verificationProgress";
import { customerDiditFailureNote } from "../shared/diditFailureReason";
import { renterRentalActionReady } from "./lib/renterRentalActionGate";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function telegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
    });
  } catch {
    /* best-effort */
  }
}

/** Thin shim over the shared Resend transport (convex/lib/mailer.ts), which
 * records delivery failures. The signature stays stable for existing callers. */
async function email(
  to: string,
  subject: string,
  html: string,
  attachments?: Array<{ filename: string; path: string }>,
  /** Overrides the owner address — used to thread Gaffer follow-up replies. */
  replyToOverride?: string,
  deliveryKey?: string,
  prepareOnly=false,
) {
  const payload={to,subject,html,attachments,replyTo:replyToOverride,deliveryKey};
  return prepareOnly ? payload : sendMail(payload);
}

export const bookingOwnerAlert = internalAction({
  args: {bookingId:v.id("bookings")},
  handler: async(ctx,{bookingId})=>{
    const b:any=await ctx.runQuery(internal.bookings.get,{bookingId});
    if(!b||!b.guestEmail||!["confirmed","active"].includes(b.status))return;
    const lines = b.lineItems
      .map(
        (li: any) =>
          `• ${li.title} (${day(li.start)}→${day(li.end)}) £${li.lineTotal}`,
      )
      .join("\n");
    await telegram(
      `🎬 <b>New booking</b>\n${b.guestEmail}\n${b.fulfilment}\n${lines}\n<b>£${b.total}</b> (incl £${b.depositAmount} refundable security payment; £${b.depositHoldAmount ?? 0} separate card hold)`,
    );
  },
});

export const paidVerificationEmail = internalAction({
  args: { prepareOnly:v.optional(v.boolean()), deliveryKey:v.optional(v.string()), bookingId:v.id("bookings"), reminder:v.boolean() },
  handler: async (ctx,{bookingId,deliveryKey,prepareOnly,reminder}) => {
    const b:any=await ctx.runQuery(internal.bookings.get,{bookingId});
    if(!b?.guestEmail || b.status!=="pending_verification" || !b.checkoutPaidAt || ["verified","rejected"].includes(b.idVerifyStatus) || b.cancellationDecision || b.returnDecision || verificationWindowClosed(b))return null;
    const app=process.env.APP_URL??"https://dbcinemarentals.com";
    const url=`${app}/account/verification/${encodeURIComponent(bookingId)}`;
    const reviewPending=["manual_review","processing"].includes(b.idVerifyStatus);
    const title=reviewPending
      ? reminder?"Your rental verification is still being checked":"Payment received — verification in progress"
      : reminder?"Reminder: complete your rental checks":"Payment received — complete your rental checks";
    const rows:Array<[string,string]>=b.lineItems.map((li:any)=>[`${li.title} · ${day(li.start)} to ${day(li.end)}`,emailMoney(li.lineTotal)]);
    rows.push(["Payment received",emailMoney(b.total)]);
    const body=reviewPending
      ? "Payment received. Your checks are in review; no action is needed unless we contact you."
      : "Payment received. Complete verification before handover; this rental is not confirmed yet.";
    return email(b.guestEmail,title,rentalEmail({title,preview:reviewPending?"Your verification is still in progress.":"Your rental still needs verification and approval.",url,button:reviewPending?"Check verification progress":"Complete verification",body:`<p>${body}</p>${emailRows(rows)}<p>If asked to sign in, use the email address from checkout.</p>`}),undefined,undefined,deliveryKey,prepareOnly);
  },
});

export const bookingAlert = internalAction({
  args: { prepareOnly:v.optional(v.boolean()), deliveryKey:v.optional(v.string()), bookingId: v.id("bookings") },
  handler: async (ctx, { prepareOnly, deliveryKey, bookingId }) => {
    const b: any = await ctx.runQuery(internal.bookings.get, { bookingId });
    // Kept for old internal callers. Never email from a paid-but-unverified,
    // stale or expired approval; live confirmation notices use verificationEmail.
    if (!b||!b.guestEmail||!renterRentalActionReady(b)||b.idVerifyStatus!=="verified"||bookingVerificationExpired(b)) return null;
    const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
    const url=`${app}/account?rental=${encodeURIComponent(bookingId)}#chat`;
    const rows:Array<[string,string]>=b.lineItems.map((li:any)=>[`${li.title} · ${day(li.start)} to ${day(li.end)}`,emailMoney(li.lineTotal)]);
    rows.push(["Payment received",emailMoney(b.total)],...rentalSecurityEmailRows(b));
    return email(b.guestEmail,"Your rental is confirmed",rentalEmail({title:"Your rental is confirmed",preview:"Payment and verification are complete. Your invoice and pickup details are in the approval email.",url,button:"Ask Gaffer about your rental",body:`<p>Thanks for renting with DB Cinema. Your payment and verification are complete, and this rental is confirmed.</p>${emailRows(rows)}${rentalSecurityEmailNote(b)?`<p>${rentalSecurityEmailNote(b)}</p>`:""}<p>Your invoice and any pickup details are in the verification approval email.</p><p>Questions about your booking or its equipment? Ask Gaffer in your rental conversation. Sign in with your checkout email if prompted.</p>`}),undefined,undefined,deliveryKey,prepareOnly);
  },
});

/** Emails a waitlisted renter when their item frees up for their requested dates. */
export const waitlistEmail = internalAction({
  args: { email: v.string(), title: v.string(), slug: v.string(), start: v.number(), end: v.number() },
  handler: async (ctx, a): Promise<boolean> => {
    const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
    const esc = (s:string) => s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
    const url=`${app}/gear/${encodeURIComponent(a.slug)}?start=${day(a.start)}&end=${day(a.end)}`;
    return sendMail({to:a.email,subject:`${a.title} is available for your dates`,html:`<h2>Your availability alert</h2><p><b>${esc(a.title)}</b> is available for ${day(a.start)} – ${day(a.end)}. This alert does not reserve the item; prices and stock are checked again at checkout.</p><p><a href="${url}">Review and book</a></p><p><a href="${app}/account#plans">Manage alerts</a></p>`});
  },
});

/** Emails the renter when their ID-verification status changes (verified / needs-retry). */
export const verificationEmail = internalAction({
  args: { prepareOnly:v.optional(v.boolean()), deliveryKey:v.optional(v.string()), bookingId: v.id("bookings"), status: v.string() },
  handler: async (ctx, { prepareOnly, deliveryKey, bookingId, status }):Promise<any> => {
    const b: any = await ctx.runQuery(internal.bookings.get, { bookingId });
    const pendingResolution=b?.status==="pending_verification"&&!!b.checkoutPaidAt&&status!=="verified"&&!verificationWindowClosed(b);
    if (!b || !b.guestEmail || b.idVerifyStatus!==status || (!["confirmed","active"].includes(b.status)&&!pendingResolution) || status === "verified" && verificationExpired(b)) return null;
    if (status === "verified" && !renterRentalActionReady(b)) return null;
    const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
    const url=`${app}/account/verification/${encodeURIComponent(bookingId)}`;
    const verificationExpiry = status === "verified" ? verificationValidUntil(b) : null;
    const verificationExpiryLabel = verificationExpiry != null
      ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" }).format(new Date(verificationExpiry))
      : null;
    const messages:Record<string,{title:string;body:string;button:string}>={
      verified:{title:"Your rental is confirmed",body:`Payment and verification passed. Your verification approval is valid for 90 days from approval, until ${verificationExpiryLabel ?? "the expiry date shown in your account"}. Eligible future rentals on this account can reuse it, so you will not need to verify again during that period.`,button:"Open your rental"},
      manual_review:{title:"Your verification is in review",body:"Your checks need a team review. No action is needed; we’ll contact you if we need anything else.",button:"View verification progress"},
      rejected:{title:"Your verification needs attention",body:`${customerDiditFailureNote(b.verificationNote) || "The automated checks could not approve your documents."} Use the button to review what to do next.`,button:"View your verification"},
      processing:{title:"Your verification is processing",body:"Your checks are still processing. You can follow their progress in your rental.",button:"View verification progress"},
      requires_input:{title:"Complete your verification",body:"Your check needs another try. Open your rental to see which documents need updating.",button:"Continue verification"},
      canceled:{title:"Continue your verification",body:"Your verification session was cancelled. Open your rental to continue the required checks.",button:"Continue verification"},
    };
    const message=messages[status];if(!message)return null;
    let detail="",attachments: Array<{filename:string;content:string}>|undefined;
    if(status==="verified"){
      if(b.fulfilment==="pickup"){
        const settings:any=await ctx.runQuery(internal.settings.pickupAddress,{});
        const rows:Array<[string,string]>=bookingStockLines(b).map((line:any)=>[line.title,`${day(line.start)} · ${line.pickupTime ?? "time to be confirmed"}`]);
        const exactPickup=pickupMapAvailable(settings?.businessAddress);
        const savedAddress=String(settings?.businessAddress??"");
        const instructionAlreadySaved=/meet.{0,80}outside\s+(?:the\s+)?waterstones/i.test(savedAddress);
        const meetingInstruction=exactPickup&&!instructionAlreadySaved?`<p>${emailEscape(TRAFALGAR_PICKUP_INSTRUCTIONS)}</p>`:"";
        detail=`<h2>Pickup details</h2>${settings?.businessAddress ? `<p>${emailEscape(savedAddress).replace(/\r?\n/g,"<br>")}</p>` : "<p>The team will confirm the pickup location in your rental conversation.</p>"}${meetingInstruction}${exactPickup ? `<p><a href="${emailEscape(WATERSTONES_MAP_URL)}">Open pickup point in Google Maps</a></p>` : ""}${emailRows(rows)}<p>All times are London local time.</p>`;
      }
      const leoPhoneHref=LEO_SUPPORT_PHONE.replace(/[^+\d]/g,"");
      detail+=`<p>Call Leo: <a href="tel:${emailEscape(leoPhoneHref)}">${emailEscape(LEO_SUPPORT_PHONE)}</a></p>`;
      const invoice:any=await ctx.runAction(internal.invoice.invoiceEmail,{bookingId,prepareOnly:true,deliveryKey});
      if(!invoice?.attachments?.length)throw Error("Verification invoice PDF is unavailable");
      attachments=invoice.attachments;
      detail+=`<p>Your rental invoice is attached as a PDF. Questions about your booking or its equipment? Ask Gaffer in your rental conversation. Sign in with your checkout email if prompted.</p>`;
    }
    const conversation=`${app}/account?rental=${encodeURIComponent(bookingId)}#chat`;
    const payload={to:b.guestEmail,subject:message.title,html:rentalEmail({title:message.title,preview:message.body,url:status==="verified"?conversation:url,button:status==="verified"?"Ask Gaffer about your rental":message.button,body:`<p>${emailEscape(message.body)}</p>${detail}`,helpText:"Need help? Open your rental conversation to message our team."}),attachments,deliveryKey};
    return prepareOnly?payload:sendMail(payload);
  },
});

export const verificationReviewAlert = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b: any = await ctx.runQuery(internal.bookings.get, { bookingId });
    if (!b) return;
    await sendMail({ to: CONTACT_EMAIL, subject: "Db Cinema verification needs human review",
      html: `<p>Booking ${bookingId} for ${String(b.guestEmail ?? "unknown").replace(/[&<>]/g, "")} is awaiting a human verification review.</p><p>${emailEscape(b.verificationNote ?? "Didit referred this verification for review.")}</p><p>Open the admin bookings panel to review it; do not hand over equipment until approved.</p>` });
  },
});

/** Emails the renter when their booking is cancelled (refund or store-credit summary). */
export const cancellationEmail = internalAction({
  args: { prepareOnly:v.optional(v.boolean()), deliveryKey:v.optional(v.string()), bookingId: v.id("bookings"), mode: v.string(), refundAmount: v.number(), creditAmount: v.number() },
  handler: async (ctx, { prepareOnly, deliveryKey, bookingId, mode, refundAmount, creditAmount }) => {
    const b: any = await ctx.runQuery(internal.bookings.get, { bookingId });
    if (!b || !b.guestEmail) return null;
    const app=process.env.APP_URL??"https://dbcinemarentals.com",url=`${app}/account?rental=${encodeURIComponent(bookingId)}#chat`;
    const rows:Array<[string,string]>=[];
    if(refundAmount>0)rows.push([mode==="no_refund"||mode==="credit"?"Separately refundable security to original payment method":"Refund to original payment method",emailMoney(refundAmount)]);
    if(creditAmount>0)rows.push([mode==="credit"?"Account credit added":"Account credit restored",emailMoney(creditAmount)]);
    const detail=mode==="credit"?`<p>Account credit is available for future rentals for ${CANCELLATION_CREDIT_DAYS} days. No rental cash refund is issued for the amount converted to credit. Any separately refundable security shown above is returned to the original payment method; bank processing times vary.</p>`:mode==="refund"?(refundAmount>0?"<p>Your refund is returned to the original payment method. Bank processing times vary.</p>":"<p>No cash refund is due under this cancellation.</p>"):mode==="no_refund"?`<p>No rental refund or account credit is due under the accepted terms. Any separately refundable security shown above is returned to the original payment method; bank processing times vary.</p>`:"<p>No payment was taken, so there is no payment to refund.</p>";
    return email(b.guestEmail,"Your DB Cinema booking is cancelled",rentalEmail({title:"Booking cancelled",preview:"Your cancellation and settlement summary.",url,button:"View cancellation",body:`<p>Your rental request has been cancelled.</p>${emailRows(rows)}${detail}<p>Any uncaptured card authorisation is released separately.</p>`}),undefined,undefined,deliveryKey,prepareOnly);
  },
});

/** Emails the renter when a reschedule/extend is applied. */
export const changeEmail = internalAction({
  args: { bookingId: v.id("bookings"), kind: v.string(), detail: v.optional(v.string()), expectedAccountId: v.optional(v.id("accounts")), expectedRecipientEmail: v.optional(v.string()), refundId: v.optional(v.id("rental_refunds")) },
  handler: async (ctx, { bookingId, kind, detail, expectedAccountId, expectedRecipientEmail, refundId }) => {
    const recipient: any = await ctx.runQuery(internal.rentalOperations.changeRecipient, { bookingId, ...(expectedAccountId ? { expectedAccountId } : {}), ...(expectedRecipientEmail !== undefined ? { expectedRecipientEmail } : {}) });
    if (!recipient) {
      if (refundId) await ctx.runMutation(internal.rentalOperations.alertRefundContactChange, { bookingId, refundId });
      return;
    }
    const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
    const subj = kind === "rescheduled" ? "Your Db Cinema rental has been rescheduled" : "Your Db Cinema rental was updated";
    const html = `<h2>Rental updated</h2><p>Your rental has been <b>${escape(kind)}</b>${detail ? ` — ${escape(detail)}` : ""}.</p><p>See it any time in <a href="${app}/account?rental=${encodeURIComponent(bookingId)}#chat">your account</a>.</p>`;
    const deliveryKey = createHash("sha256")
      .update(`${String(bookingId)}\n${recipient.email.trim().toLowerCase()}\n${kind}\n${detail ?? ""}`)
      .digest("hex");
    await sendRentalContextEmail(ctx, bookingId, `rental-change:${deliveryKey}`, {
      to: recipient.email,
      subject: subj,
      html,
    });
  },
});

export const timeChangeEmail = internalAction({
  args:{bookingId:v.id("bookings"),detail:v.string(),deliveryKey:v.string(),prepareOnly:v.boolean(),changeKind:v.optional(v.union(v.literal("pickup"),v.literal("return")))},
  handler:async(ctx,{bookingId,detail,deliveryKey,prepareOnly,changeKind}):Promise<any>=>{
    const recipient: {email:string}|null=await ctx.runQuery(internal.rentalOperations.changeRecipient,{bookingId});
    if(!recipient)return null;
    const app=process.env.APP_URL??"https://dbcinemarentals.com",url=`${app}/account?rental=${encodeURIComponent(bookingId)}#chat`;
    const label=changeKind==="return"?"return":"pickup";
    return email(recipient.email,`Your DB Cinema ${label} time changed`,rentalEmail({title:`${label==="return"?"Return":"Pickup"} time updated`,preview:`Please review your updated ${label} details.`,url,button:"View rental conversation",body:`<p>${emailEscape(detail)}</p><p>All times are London local time. Your agreed charges remain unchanged.</p>`}),undefined,undefined,deliveryKey,prepareOnly);
  },
});

/**
 * A team notification for a contact-form submission. The customer message and
 * all replies live in Admin → Messages → Emails so the conversation stays
 * tracked; replying to this notification is not a customer-reply path.
 */
export const contactAlert = internalAction({
  args: { name: v.string(), email: v.string(), message: v.string() },
  handler: async (ctx, a) => {
    const owner = CONTACT_EMAIL;
    const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
    await email(
      owner,
      `✉️ New request — ${a.name}`,
      `<h2>New request for the team</h2>
       <p><b>${esc(a.name)}</b> &lt;${esc(a.email)}&gt;</p>
       <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;border-left:3px solid #e0992f;padding:2px 0 2px 14px;margin:16px 0">${esc(a.message)}</pre>
       <p style="color:#888">Review this request in <a href="${app}/admin">Admin → Messages → Other requests</a>. If you need to email the applicant, open it as a conversation from there.</p>`,
      undefined,
    );
    await telegram(
      `✉️ <b>New contact message</b>\nFrom: ${a.name} (${a.email})\n\n${a.message}`,
    );
  },
});

export const contactAutoReply = internalAction({
  args: { contactId: v.id("contact_messages"), name: v.string(), email: v.string(), message: v.string(), attempt: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const attempt = a.attempt ?? 0;
    const baseUrl = (process.env.APP_URL ?? "https://dbcinemarentals.com").replace(/\/+$/, "");
    const secret = process.env.INBOUND_EMAIL_SECRET;
    let retryable = true;
    if (secret) {
      try {
        const response = await fetch(`${baseUrl}/api/email/inbound`, {
          method: "POST", signal: AbortSignal.timeout(175_000),
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({ source: "contact-form", contactId: a.contactId, name: a.name, email: a.email, message: a.message }),
        });
        const result: any = await response.json().catch(() => null);
        if (response.ok && (result?.replied === true || result?.duplicate === true)) {
          await ctx.runMutation(internal.contact.markAutoHandled, { id: a.contactId });
          return { ok: true, replied: result.replied === true };
        }
        retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        console.error("[contact] Gaffer delivery incomplete", response.status, "attempt", attempt + 1);
      } catch { console.error("[contact] Gaffer request failed, attempt", attempt + 1); }
    } else { retryable = false; console.error("[contact] Gaffer inbound authentication is not configured"); }
    if (retryable && attempt < 3) {
      await ctx.scheduler.runAfter([120_000, 300_000, 900_000][attempt], internal.notify.contactAutoReply, { ...a, attempt: attempt + 1 });
      return { ok: false, retrying: true };
    }
    await telegram(`🚨 <b>Contact enquiry needs attention</b>\nGaffer could not deliver an answer after ${attempt + 1} attempt(s). Contact ID: ${a.contactId}`);
    await email(CONTACT_EMAIL, "URGENT: Gaffer contact reply failed", `<p>Gaffer could not answer a contact enquiry. Review the admin email inbox.</p><p>Contact ID: ${esc(a.contactId)}</p>`, undefined, undefined, `contact-failed:${a.contactId}`);
    return { ok: false, escalated: true };
  },
});

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Team heads-up only; the durable email and its reply route live in emailInbox. */
export const gafferFollowUpSentAlert = internalAction({
  args: { to: v.string(), summary: v.string() },
  handler: async (_ctx, a) => {
    await telegram(`📨 <b>Gaffer follow-up sent</b>\nTo: ${esc(a.to)}\n\n${esc(a.summary.slice(0, 500))}`);
  },
});

/**
 * Retained for any already-scheduled legacy jobs. New follow-up replies are
 * handled by /api/email/inbound and must never be forwarded straight to the
 * owner without passing through Gaffer first.
 */
export const followUpReplyAlert = internalAction({
  args: { email: v.string(), body: v.string() },
  handler: async () => {
    console.warn("[email/follow-up] suppressed legacy owner-only reply alert; inbound messages must pass through Gaffer");
    return { ignored: "legacy owner-only routing disabled" as const };
  },
});

/** High-priority owner alert, sent only when an email customer explicitly asks for a human. */
export const emailHumanRequestAlert = internalAction({
  args: { email: v.string(), subject: v.string(), body: v.string(), inboundId: v.id("email_messages"), attempt: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const attempt = Math.max(1, Math.min(3, Math.floor(a.attempt ?? 1)));
    const subject = `URGENT: Human requested — ${a.subject.slice(0, 160)}`;
    const html = `<p><b>A customer requested a human reply.</b></p><p>From: ${esc(a.email)}<br/>Subject: ${esc(a.subject)}</p><blockquote>${esc(a.body).replace(/\n/g, "<br/>")}</blockquote>`;
    let delivered = false;
    try {
      delivered = await email(CONTACT_EMAIL, subject, html, undefined, undefined, `human-request:${a.inboundId}`) === true;
    } catch (error) {
      console.error("[email/human-alert] delivery attempt failed", String((error as any)?.message ?? error));
    }

    if (delivered) {
      await telegram(`🚨 <b>URGENT — customer requested a human</b>\nFrom: ${a.email}\nSubject: ${a.subject}\n\n${a.body.slice(0, 800)}`);
      return;
    }

    console.error(`[email/human-alert] business inbox delivery failed on attempt ${attempt}/3`);
    if (attempt < 3) {
      await ctx.runMutation(internal.emailInbox.scheduleHumanRequestAlertRetry, {
        email: a.email,
        subject: a.subject,
        body: a.body,
        inboundId: a.inboundId,
        failedAttempt: attempt,
      });
      await telegram(`🚨 <b>URGENT — human request email needs retry</b>\nFrom: ${a.email}\nSubject: ${a.subject}\nEmail delivery attempt ${attempt}/3 failed; retry scheduled.`);
      return;
    }

    await telegram(`🚨 <b>URGENT — human request email failed</b>\nFrom: ${a.email}\nSubject: ${a.subject}\nEmail delivery failed after 3 attempts.`);
  },
});

/** A lead from the Gaffer voice agent — emailed to the owner + Telegram. */
export const ownerLead = internalAction({
  args: {
    kind: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (_ctx, a) => {
    const owner = CONTACT_EMAIL;
    const who = `${a.name}${a.phone ? ` · ${a.phone}` : ""}${a.email ? ` · ${a.email}` : ""}`;
    await email(
      owner,
      `📞 Gaffer voice — ${a.kind}: ${a.name}`,
      `<h2>New ${a.kind} from the Gaffer phone line 🎬</h2>
       <p><b>${who}</b></p>
       <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px">${a.message}</pre>
       <p style="color:#888">Captured automatically by Gaffer (voice). Reply to follow up.</p>`,
    );
    await telegram(`📞 <b>Gaffer voice · ${a.kind}</b>\n${who}\n\n${a.message}`);
  },
});

/** Daily-ish reminders: pickup tomorrow / return today (email + Telegram). */
export const sendReminders = internalAction({
  args: {},
  handler: async (ctx) => {
    const feed: any[] = await ctx.runQuery(internal.bookings.remindersFeed, {});
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    let queued = 0;
    for (const b of feed) {
      const startDay = new Date(b.start).toISOString().slice(0, 10);
      const endDay = new Date(b.end).toISOString().slice(0, 10);

      if (startDay === tomorrow && !b.remindedPickup) {
        const result:any=await ctx.runMutation(internal.rentalEmailDelivery.queueReminder,{bookingId:b._id,kind:"pickup_reminder"});
        if(result?.queued){await telegram(`⏰ <b>Pickup reminder queued</b>\n${b.guestEmail} ${b.pickupTime ?? ""}\n${b.summary}`);queued++;}
      }
      if (endDay === today && !b.remindedReturn) {
        const result:any=await ctx.runMutation(internal.rentalEmailDelivery.queueReminder,{bookingId:b._id,kind:"return_reminder"});
        if(result?.queued){await telegram(`⏰ <b>Return reminder queued</b>\n${b.guestEmail} ${b.returnTime ?? ""}\n${b.summary}`);queued++;}
      }
    }
    return { checked: feed.length, queued };
  },
});

export const rentalReminderEmail=internalAction({args:{bookingId:v.id("bookings"),kind:v.union(v.literal("pickup"),v.literal("return")),deliveryKey:v.string(),prepareOnly:v.optional(v.boolean())},handler:async(ctx,{bookingId,kind,deliveryKey,prepareOnly})=>{
 const booking:any=await ctx.runQuery(internal.bookings.receiptContext,{bookingId});if(!booking?.guestEmail||!Array.isArray(booking.lineItems)||!booking.lineItems.length)return null;
 const pickup=kind==="pickup",event=pickup?(booking.fulfilment==="delivery"?"delivery":"pickup"):"return";
 const details=booking.lineItems.map((rentalLine:any)=>{
   const date=day(pickup?rentalLine.start:rentalLine.end);
   const time=pickup?(rentalLine.pickupTime??booking.pickupTime):(rentalLine.returnTime??booking.returnTime);
   return `${rentalLine.title} · ${date}${time?` at ${time}`:""}`;
 }).map(emailEscape).join("; ");
 const app=(process.env.APP_URL??"https://dbcinemarentals.com").replace(/\/+$/,"");
 const subject=pickup?"Your DB Cinema pickup is tomorrow 🎬":"Your DB Cinema return is due today";
 const body=pickup?`<p>Quick reminder — your rental ${emailEscape(event)} is <b>tomorrow</b>${booking.pickupTime?` at ${emailEscape(booking.pickupTime)}`:""}.</p><p>${details}</p><p>Windows: 09:00–22:00.</p>`:`<p>Reminder — your rental return is <b>due today</b>${booking.returnTime?` at ${emailEscape(booking.returnTime)}`:""}. Late returns are charged per extra day.</p><p>${details}</p>`;
 return email(booking.guestEmail,subject,rentalEmail({title:pickup?"Pickup tomorrow":"Return due today",preview:pickup?"Your rental pickup is tomorrow.":"Your rental return is due today.",url:`${app}/account?rental=${encodeURIComponent(bookingId)}#chat`,button:"Open rental conversation",body}),undefined,undefined,deliveryKey,prepareOnly);
}});

/** Forward a renter chat message to the owner/bot via Telegram. */
export const renterChat = internalAction({
  args: { email: v.string(), text: v.string(),bookingId:v.optional(v.id("bookings")) },
  handler: async (ctx, { email, text,bookingId }) => {
    const booking=bookingId?await ctx.runQuery(internal.bookings.get,{bookingId}):null;
    const esc=(text:string)=>text.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
    const origin=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
    await telegram(`💬 <b>Renter message</b>\nFrom: ${esc(email)}${booking?`\n${esc(booking.status)}`:""}\n\n${esc(text)}\n\n<a href="${origin}/admin${bookingId?`?rental=${bookingId}`:""}#messages">Open conversation</a>`);
  },
});
