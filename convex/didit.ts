"use node";

import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const sessionApi = "https://verification.didit.me/v3/session/";

function config() {
  const apiKey = process.env.DIDIT_API_KEY;
  const workflowId = process.env.DIDIT_WORKFLOW_ID;
  const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET;
  const environment = process.env.DIDIT_ENVIRONMENT;
  const applicationId = process.env.DIDIT_APPLICATION_ID;
  if (!apiKey || !workflowId || !webhookSecret || !applicationId || !["sandbox", "live"].includes(environment ?? ""))
    throw new Error("Automatic verification is temporarily unavailable. Please contact us before paying.");
  return { apiKey, workflowId, webhookSecret, environment, applicationId };
}

/** Create or reopen the one booking-bound Didit workflow. Only the paid renter can
 * receive its hosted URL; the API key never reaches the browser. */
export const bookingSession = action({
  args: {
    bookingId: v.id("bookings"),
    accountToken: v.optional(v.string()),
    checkoutSessionId: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ url: string }> => {
    const cfg = config();
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
    if (!booking || booking.verificationProvider !== "didit" || !["confirmed", "active"].includes(booking.status) ||
        !["required", "processing", "requires_input"].includes(booking.idVerifyStatus ?? "required"))
      throw new Error("This booking is not ready for verification.");
    let authorized = false;
    if (a.accountToken) {
      const acct: any = await ctx.runQuery(internal.accounts._byToken, { token: a.accountToken });
      authorized = !!acct && acct.email?.trim().toLowerCase() === booking.guestEmail?.trim().toLowerCase();
    }
    if (!authorized && a.checkoutSessionId) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error("Payment service unavailable");
      const session = await new Stripe(key).checkout.sessions.retrieve(a.checkoutSessionId);
      authorized = session.payment_status === "paid" && session.metadata?.bookingId === a.bookingId;
    }
    if (!authorized) throw new Error("Please sign in to verify this booking.");

    const res = await fetch(sessionApi, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey },
      body: JSON.stringify({
        workflow_id: cfg.workflowId,
        vendor_data: `dbc-booking-${a.bookingId}`,
        language: "en",
        contact_details: { email: booking.guestEmail, send_notification_emails: false },
      }),
    });
    if (!res.ok) throw new Error("Verification could not start. Please try again.");
    const result: { session_id?: string; url?: string; workflow_id?: string } = await res.json();
    if (!result.session_id || result.workflow_id !== cfg.workflowId || !result.url ||
        !/^https:\/\/verify\.didit\.me\/(?:[a-z-]+\/)?session\/[A-Za-z0-9_-]+$/.test(result.url))
      throw new Error("Verification provider returned an invalid session.");
    const saved: boolean = await ctx.runMutation(internal.bookings.setDiditSession, {
      bookingId: a.bookingId, sessionId: result.session_id,
    });
    if (!saved) throw new Error("Verification session could not be attached to the booking.");
    return { url: result.url };
  },
});

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function allApproved(items: unknown): boolean {
  return Array.isArray(items) && items.length > 0 && items.every((item) => item?.status === "Approved");
}

/** Didit v3 webhooks sign the complete canonical JSON with X-Signature-V2.
 * A top-level Approved alone is insufficient: every required ID, selfie and
 * address feature must have its own Approved decision. */
export const webhook = internalAction({
  args: { body: v.string(), signature: v.string(), timestamp: v.string() },
  handler: async (ctx, { body, signature, timestamp }): Promise<boolean> => {
    let cfg: ReturnType<typeof config>;
    try { cfg = config(); } catch { return false; }
    if (body.length > 1_000_000 || !/^[a-f0-9]{64}$/i.test(signature) || !/^\d{10}$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    let event: any;
    try { event = JSON.parse(body); } catch { return false; }
    const signed = JSON.stringify(canonical(event));
    const expected = createHmac("sha256", cfg.webhookSecret).update(signed, "utf8").digest();
    const actual = Buffer.from(signature, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || event.timestamp !== Number(timestamp)) return false;
    if (event.webhook_type !== "status.updated" && event.webhook_type !== "data.updated") return true;
    if (event.environment !== cfg.environment || event.application_id !== cfg.applicationId ||
        event.workflow_id !== cfg.workflowId || event.session_kind === "business") return false;
    if (typeof event.vendor_data !== "string" || !event.vendor_data.startsWith("dbc-booking-") ||
        typeof event.session_id !== "string" || typeof event.event_id !== "string" ||
        !Number.isSafeInteger(event.created_at)) return false;
    const bookingId = event.vendor_data.slice("dbc-booking-".length);
    const rawStatus = event.status;
    let status: "processing" | "manual_review" | "verified" | "requires_input" | "rejected";
    let poaPostcodes: string[] = [];
    if (rawStatus === "Approved") {
      const d = event.decision;
      status = d?.status === "Approved" && allApproved(d.id_verifications) &&
        allApproved(d.liveness_checks) && allApproved(d.face_matches) && allApproved(d.poa_verifications)
        ? "verified" : "manual_review";
      if (status === "verified") poaPostcodes = d.poa_verifications.map((poa: any) =>
        String(poa.poa_parsed_address?.postal_code ?? poa.poa_formatted_address ?? poa.poa_address ?? ""));
    } else if (rawStatus === "In Review") status = "manual_review";
    else if (["Resubmitted", "Abandoned", "Expired"].includes(rawStatus)) status = "requires_input";
    else if (rawStatus === "Declined" || rawStatus === "Kyc Expired") status = "rejected";
    else if (rawStatus === "Not Started" || rawStatus === "In Progress") status = "processing";
    else return true;
    const note = status === "manual_review" && rawStatus === "Approved"
      ? "A required identity, selfie or address check did not pass. We will review it."
      : rawStatus === "Expired" ? "The verification link expired. Start a new check before handover."
      : rawStatus === "Abandoned" ? "The verification was not completed. Start a new check before handover."
      : status === "requires_input" ? "Please complete the requested document step." : undefined;
    try {
      return await ctx.runMutation(internal.bookings.setDiditResult, {
        bookingId: bookingId as any,
        sessionId: event.session_id,
        eventId: event.event_id,
        eventAt: event.created_at * 1000,
        status,
        providerStatus: rawStatus,
        note,
        poaPostcodes,
      });
    } catch { return false; }
  },
});
