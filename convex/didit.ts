"use node";

import { verificationChecks, securityReady } from "../shared/verificationProgress";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const sessionApi = "https://verification.didit.me/v3/session/";
const hostedSessionUrl = /^https:\/\/verify\.didit\.me\/(?:[a-z-]+\/)?session\/[A-Za-z0-9_-]+$/;

async function retrieveSession(apiKey: string, sessionId: string, bookingId: string, email: string): Promise<any> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) throw new Error("Invalid verification case ID.");
  const res = await fetch(`${sessionApi}${sessionId}/decision/`, { headers: { "x-api-key": apiKey } });
  if (!res.ok) throw new Error("Could not check the current verification decision. Please try again.");
  const session: any = await res.json();
  if (session.session_id !== sessionId || session.session_kind !== "user" ||
      session.vendor_data !== `dbc-booking-${bookingId}` ||
      session.contact_details?.email?.trim().toLowerCase() !== email.trim().toLowerCase())
    throw new Error("Verification case does not match this rental.");
  return session;
}

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
  handler: async (ctx, a): Promise<{ url: string | null; reused?: boolean }> => {
    const cfg = config();
    let booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
    if (!booking || booking.verificationProvider !== "didit" || !["confirmed", "active"].includes(booking.status) ||
        !["required", "processing", "requires_input"].includes(booking.idVerifyStatus ?? "required"))
      throw new Error("This booking is not ready for verification.");
    if (!securityReady(booking)) throw Error("Complete the rental payment and required card hold before verification.");
    let authorized = false;
    if (a.accountToken) {
      const acct: any = await ctx.runQuery(internal.accounts._byToken, { token: a.accountToken });
      authorized = !!acct?.email && belongsToRentalAccount(booking, acct);
    }
    if (!authorized && a.checkoutSessionId) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error("Payment service unavailable");
      const session = await new Stripe(key).checkout.sessions.retrieve(a.checkoutSessionId);
      authorized = session.status === "complete" && ["paid", "no_payment_required"].includes(session.payment_status) && session.metadata?.bookingId === a.bookingId && (!booking.stripeCheckoutSessionId || session.id === booking.stripeCheckoutSessionId);
    }
    if (!authorized) throw new Error("Please sign in to verify this booking.");

    if (!booking.diditSessionId && booking.idVerifyStatus === "required") {
      // Finish the eligible previous-check revalidation before starting a fresh upload workflow.
      await ctx.runAction(internal.didit.reuseVerification, { bookingId: a.bookingId });
      booking = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
      if (booking?.idVerifyStatus === "verified" && securityReady(booking)) return { url: null, reused: true };
      if (!booking || !securityReady(booking) || !["required", "processing", "requires_input"].includes(booking.idVerifyStatus ?? "required")) throw Error("The rental changed. Refresh its verification progress.");
    }
    if (booking.diditSessionId) {
      const existing = await retrieveSession(cfg.apiKey, booking.diditSessionId, String(a.bookingId), booking.guestEmail);
      if (existing.workflow_id !== cfg.workflowId) throw new Error("Verification workflow does not match this rental.");
      if (["Not Started", "In Progress", "Awaiting User", "Resubmitted"].includes(existing.status)) {
        if (typeof existing.session_url !== "string" || !hostedSessionUrl.test(existing.session_url))
          throw new Error("Verification provider returned an invalid link.");
        return { url: existing.session_url };
      }
      if (existing.status !== "Expired" && existing.status !== "Abandoned")
        throw new Error("This verification has a decision. Please refresh your rental status.");
    }
    const nameParts = String(booking.renterName ?? "").trim().split(/\s+/).filter(Boolean);
    const expectedDetails: Record<string, string> = {};
    if (nameParts.length) {
      expectedDetails.first_name = nameParts[0];
      if (nameParts.length > 1) expectedDetails.last_name = nameParts.slice(1).join(" ");
    }
    // The UK billing address is the address this rental must verify. Set only
    // PoA's country: renters can present an ID issued in a different country.
    if (/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i.test(booking.billingAddress ?? "")) {
      expectedDetails.address = booking.billingAddress;
      expectedDetails.poa_country = "GBR";
    }
    const res = await fetch(sessionApi, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey },
      body: JSON.stringify({
        workflow_id: cfg.workflowId,
        vendor_data: `dbc-booking-${a.bookingId}`,
        language: "en",
        expected_details: expectedDetails,
        ...(process.env.APP_URL ? { callback: new URL(`/account/verification/${a.bookingId}${a.checkoutSessionId ? `?session_id=${encodeURIComponent(a.checkoutSessionId)}` : ""}`, process.env.APP_URL).toString(), callback_method: "both" } : {}),
        contact_details: { email: booking.guestEmail, send_notification_emails: false },
      }),
    });
    if (!res.ok) throw new Error("Verification could not start. Please try again.");
    const result: { session_id?: string; url?: string; workflow_id?: string } = await res.json();
    if (!result.session_id || result.session_id === booking.diditSessionId ||
        result.workflow_id !== cfg.workflowId || !result.url ||
        !hostedSessionUrl.test(result.url))
      throw new Error("Verification provider returned an invalid session.");
    const saved: boolean = await ctx.runMutation(internal.bookings.setDiditSession, {
      bookingId: a.bookingId, sessionId: result.session_id, previousSessionId: booking.diditSessionId,
    });
    if (!saved) {
      const current: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
      if (current?.diditSessionId && securityReady(current)) {
        const attached = await retrieveSession(cfg.apiKey, current.diditSessionId, String(a.bookingId), current.guestEmail);
        if (attached.workflow_id === cfg.workflowId && ["Not Started", "In Progress", "Awaiting User", "Resubmitted"].includes(attached.status) && typeof attached.session_url === "string" && hostedSessionUrl.test(attached.session_url)) return { url: attached.session_url };
      }
      throw new Error("The rental changed while verification opened. Refresh its progress before continuing.");
    }
    return { url: result.url };
  },
});

/** Re-read the original decision; missing/changed results always fall back to a fresh check. */
export const reuseVerification = internalAction({
 args: { bookingId: v.id("bookings") },
 handler: async (ctx, { bookingId }) => {
  const candidate: any = await ctx.runQuery(internal.bookings.reuseVerificationCandidate, { bookingId });
  if (!candidate) return;
  try {
    const cfg = config();
    const report = await retrieveSession(cfg.apiKey, candidate.source.diditSessionId, String(candidate.source._id), candidate.source.guestEmail);
    if (report.workflow_id !== cfg.workflowId) return;
    const mapped = mapDecision(report.status, report);
    if (!mapped || mapped.status !== "verified" || !mapped.documentExpiresAt || mapped.documentExpiresAt <= Date.now()) {
      await ctx.runMutation(internal.bookings.revokeVerificationReuse, { sourceBookingId: candidate.source._id }); return;
    }
    await ctx.runMutation(internal.bookings.applyVerificationReuse, { bookingId, sourceBookingId: candidate.source._id, documentExpiresAt: mapped.documentExpiresAt, personKey: mapped.personKey });
  } catch { /* Outage or mismatched case requires the normal verification flow. */ }
 }
});

/** A human review changes the Didit case before updating the rental. The
 * provider records the review in its audit timeline and emits a signed webhook. */
export const adminReview = action({
  args: {
    token: v.string(), bookingId: v.id("bookings"),
    decision: v.union(v.literal("approve"), v.literal("resubmit"), v.literal("decline")),
    note: v.string(),
  },
  handler: async (ctx, { token, bookingId, decision, note }): Promise<void> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "didit.adminReview" });
    const reason = note.trim();
    if (reason.length < 5 || reason.length > 400) throw new Error("Record a 5–400 character review reason.");
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
    if (!booking || booking.verificationProvider !== "didit" || !booking.diditSessionId ||
        !["confirmed", "active"].includes(booking.status) ||
        !["manual_review", "rejected"].includes(booking.idVerifyStatus))
      throw new Error("Only a paid rental with a completed Didit case can be reviewed here.");
    const cfg = config();
    const session = await retrieveSession(cfg.apiKey, booking.diditSessionId, String(bookingId), booking.guestEmail);
    if (session.workflow_id !== cfg.workflowId) throw new Error("Verification workflow does not match this rental.");
    if (!["Approved", "Declined", "In Review", "Kyc Expired", "Abandoned", "Resubmitted"].includes(session.status))
      throw new Error("This verification is still in progress or expired; it cannot be manually decided.");
    if (decision === "approve" && !["Approved", "Declined", "In Review"].includes(session.status))
      throw new Error("Review a completed identity, selfie and address case before approving it.");

    const next = decision === "approve" ? "Approved" : decision === "decline" ? "Declined" : "Resubmitted";
    if (session.status !== next) {
      const body: Record<string, unknown> = { new_status: next, comment: `Db Cinema Rentals review: ${reason}` };
      if (decision === "resubmit") {
        const features = [
          ["id_verifications", "OCR"], ["liveness_checks", "LIVENESS"],
          ["face_matches", "FACE_MATCH"], ["poa_verifications", "PROOF_OF_ADDRESS"],
        ] as const;
        const needsRedo = features.flatMap(([field, feature]) =>
          (Array.isArray(session[field]) ? session[field] : [])
            .filter((item: any) => item?.status !== "Approved" && typeof item?.node_id === "string")
            .map((item: any) => ({ node_id: item.node_id, feature })));
        const addressOnly = (Array.isArray(session.poa_verifications) ? session.poa_verifications : [])
          .filter((item: any) => typeof item?.node_id === "string")
          .map((item: any) => ({ node_id: item.node_id, feature: "PROOF_OF_ADDRESS" }));
        body.nodes_to_resubmit = needsRedo.length ? needsRedo : addressOnly;
        if (!(body.nodes_to_resubmit as unknown[]).length)
          throw new Error("No document step is available to resubmit. Review the case in Didit Business Console.");
      }
      const res = await fetch(`${sessionApi}${booking.diditSessionId}/update-status/`, {
        method: "PATCH", headers: { "content-type": "application/json", "x-api-key": cfg.apiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Didit did not accept the review decision. Refresh the case and try again.");
      const updated: { session_id?: string } = await res.json();
      if (updated.session_id !== booking.diditSessionId)
        throw new Error("Didit returned a different case. Check the provider decision before continuing.");
    }
    const saved: boolean = await ctx.runMutation(internal.bookings.setDiditManualReview, {
      bookingId, sessionId: booking.diditSessionId, decision, note: reason, personKey: mapDecision(session.status, session)?.personKey,
    });
    if (!saved) throw new Error("The rental changed during review. Check its current status and the Didit case.");
  },
});

/** Read the current provider decision for an authenticated, visible rental.
 * Browser-supplied results are never accepted. Webhooks remain authoritative,
 * and this closes the progress gap when a callback is delayed or missed. */
export const refreshProgress = action({
  args: { bookingId: v.id("bookings"), accountToken: v.optional(v.string()), checkoutSessionId: v.optional(v.string()), admin: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{status: string}> => {
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
    let authorized = false;
    if (a.admin && a.accountToken) {
      await ctx.runMutation(internal.adminAuth.assertAdminInternal, {token: a.accountToken, fn: "didit.refreshProgress"});
      authorized = true;
    } else if (a.accountToken) {
      const account: any = await ctx.runQuery(internal.accounts._byToken, {token: a.accountToken});
      authorized = !!booking && !!account && belongsToRentalAccount(booking, account);
    }
    // The completed session is an existing bearer capability on the success
    // page; it must be the exact session already bound by Stripe fulfilment.
    if (!authorized && a.checkoutSessionId && booking?.stripeCheckoutSessionId === a.checkoutSessionId && ["confirmed", "active"].includes(booking.status)) authorized = true;
    if (!authorized || !booking) throw Error("Sign in to view this rental's verification.");
    if (!["confirmed", "active"].includes(booking.status)) return {status: "closed"};
    if (booking.verificationProvider !== "didit" || !booking.diditSessionId) return {status: "not_started"};
    const claimed = await ctx.runMutation(internal.bookings.claimDiditProgressRefresh, {bookingId:a.bookingId, sessionId:booking.diditSessionId});
    if (!claimed) return {status: "unchanged"};
    const cfg = config();
    const report = await retrieveSession(cfg.apiKey, booking.diditSessionId, String(a.bookingId), booking.guestEmail);
    if (report.workflow_id !== cfg.workflowId) throw Error("Verification workflow does not match this rental.");
    const mapped = mapDecision(report.status, report);
    if (!mapped) throw Error("Unknown verification status.");
    // Polling is for progress, not a synthetic new document event on every
    // tick. Signed data.updated webhooks and full reconciliation still capture
    // document changes; identical progress must not reset a completed archive.
    if (booking.idVerifyStatus === mapped.status && (["identity", "selfie", "address"] as const).every(key => booking.verificationChecks?.[key] === mapped.checks[key]) &&
        (booking.verificationNote ?? null) === (mapped.note ?? null) && (booking.documentExpiresAt ?? null) === (mapped.documentExpiresAt ?? null) &&
        (!mapped.personKey || booking.renterPersonKey === mapped.personKey)) return {status: "unchanged"};
    const saved = await ctx.runMutation(internal.bookings.setDiditResult, {
      bookingId: a.bookingId, sessionId: booking.diditSessionId,
      eventId: `progress-${booking.diditSessionId}-${Date.now()}`, eventAt: Date.now(), providerStatus: report.status, ...mapped,
    });
    if (!saved) throw Error("The verification session changed. Refresh this rental.");
    return {status: "updated"};
  },
});

/** Webhook delivery is normally immediate. Re-read a bounded set of open
 * rentals hourly so a missed callback cannot leave verification stuck. */
export const reconcileOpenSessions = internalAction({
  args: {},
  handler: async (ctx) => {
    const candidates = await ctx.runQuery(internal.bookings.diditReconcileCandidates, {});
    if (!candidates.length) return;
    const cfg = config();
    let failures = 0;
    for (let i = 0; i < candidates.length; i += 5) {
      await Promise.all(candidates.slice(i, i + 5).map(async (candidate) => {
        try {
          const report = await retrieveSession(cfg.apiKey, candidate.sessionId,
            String(candidate.bookingId), candidate.email);
          if (report.workflow_id !== cfg.workflowId)
            throw new Error("Verification workflow does not match this rental.");
          const mapped = mapDecision(report.status, report);
          if (!mapped) throw new Error("Unknown verification status.");
          const saved = await ctx.runMutation(internal.bookings.setDiditResult, {
            bookingId: candidate.bookingId,
            sessionId: candidate.sessionId,
            eventId: `reconcile-${candidate.sessionId}-${Date.now()}`,
            eventAt: Date.now(),
            providerStatus: report.status,
            ...mapped,
          });
          if (!saved) throw new Error("Verification session changed during reconciliation.");
        } catch {
          failures++;
        } finally {
          await ctx.runMutation(internal.bookings.markDiditReconciled, {
            bookingId: candidate.bookingId, sessionId: candidate.sessionId, attemptedAt: Date.now(),
          });
        }
      }));
    }
    if (failures) throw new Error(`${failures} rental verification case(s) could not be reconciled.`);
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

function mapDecision(rawStatus: unknown, decision: any): {
  status: "processing" | "manual_review" | "verified" | "requires_input" | "rejected";
  note?: string;
  poaPostcodes: string[];
  documentExpiresAt?: number;
  personKey?: string;
  checks: ReturnType<typeof verificationChecks>;
} | null {
  let status: "processing" | "manual_review" | "verified" | "requires_input" | "rejected";
  let poaPostcodes: string[] = [];
  if (rawStatus === "Approved") {
    status = decision?.status === "Approved" && allApproved(decision.id_verifications) &&
      allApproved(decision.liveness_checks) && allApproved(decision.face_matches) &&
      allApproved(decision.poa_verifications) ? "verified" : "manual_review";
    if (status === "verified") poaPostcodes = decision.poa_verifications.map((poa: any) =>
      String(poa.poa_parsed_address?.postal_code ?? poa.poa_formatted_address ?? poa.poa_address ?? ""));
  } else if (rawStatus === "In Review") status = "manual_review";
  else if (["Resubmitted", "Abandoned", "Expired", "Awaiting User"].includes(String(rawStatus))) status = "requires_input";
  else if (rawStatus === "Declined" || rawStatus === "Kyc Expired") status = "rejected";
  else if (rawStatus === "Not Started" || rawStatus === "In Progress") status = "processing";
  else return null;
  let note = status === "manual_review" && rawStatus === "Approved"
    ? "A required identity, selfie or address check did not pass. We will review it."
    : rawStatus === "Expired" ? "The verification link expired. Start a new check before handover."
    : rawStatus === "Abandoned" ? "The verification was not completed. Start a new check before handover."
    : status === "requires_input" ? "Please complete the requested document step." : undefined;
  const expiries = (Array.isArray(decision?.id_verifications) ? decision.id_verifications : [])
    .map((item: any) => /^\d{4}-\d{2}-\d{2}$/.test(item.expiration_date ?? "") ? Date.parse(`${item.expiration_date}T00:00:00Z`) : NaN);
  const documentExpiresAt = expiries.length && expiries.every(Number.isFinite) ? Math.min(...expiries) : undefined;
  // Use provider-attested biographical identity across emails; never store raw DOB or ID numbers.
  const identities = (Array.isArray(decision?.id_verifications) ? decision.id_verifications : [])
    .filter((item: any) => item.status === "Approved" && /^\d{4}-\d{2}-\d{2}$/.test(item.date_of_birth ?? "") && typeof item.full_name === "string" && item.full_name.trim());
  const keys = identities.map((item: any) => JSON.stringify([item.full_name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "), item.date_of_birth]));
  const secret = process.env.INVOICE_SECRET;
  const personKey = secret && keys.length && new Set(keys).size === 1 ? createHmac("sha256", secret).update(`dbc-person-v1:${keys[0]}`).digest("hex") : undefined;
  if (status === "verified" && !personKey) { status = "manual_review"; note = "The verified identity details need a team check before the per-person equipment limit can be confirmed."; }
  return { status, note, poaPostcodes, checks: verificationChecks(decision), ...(personKey ? { personKey } : {}), ...(documentExpiresAt ? { documentExpiresAt } : {}) };
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
    const mapped = mapDecision(event.status, event.decision);
    if (!mapped) return true;
    try {
      return await ctx.runMutation(internal.bookings.setDiditResult, {
        bookingId: bookingId as any,
        sessionId: event.session_id,
        eventId: event.event_id,
        eventAt: event.created_at * 1000,
        providerStatus: event.status,
        ...mapped,
      });
    } catch { return false; }
  },
});
