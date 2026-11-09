"use node";

import { verificationChecks, verificationCanStart, verificationBookingOpen, verificationExpired } from "../shared/verificationProgress";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const sessionApi = "https://verification.didit.me/v3/session/";
const hostedSessionUrl = /^https:\/\/verify\.didit\.me\/(?:[a-z-]+\/)?session\/[A-Za-z0-9_-]+$/;
const resumableSessionStatuses = ["Not Started", "In Progress", "Awaiting User", "Resubmitted"] as const;
class DiditDecisionUnavailable extends Error {}
class DiditDecisionNotFound extends DiditDecisionUnavailable {}
class VerificationReusePending extends Error {}

async function retrieveSession(apiKey: string, sessionId: string, bookingId: string, email: string): Promise<any> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) throw new Error("Invalid verification case ID.");
  let res: Response;
  try { res = await fetch(`${sessionApi}${sessionId}/decision/`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new DiditDecisionUnavailable("Could not check the current verification decision. Please try again."); }
  if (!res.ok) {
    if (res.status === 404) throw new DiditDecisionNotFound("Could not check the current verification decision. Please try again.");
    if (res.status === 429 || res.status >= 500) throw new DiditDecisionUnavailable("Could not check the current verification decision. Please try again.");
    throw new Error("Could not check the current verification decision. Please try again.");
  }
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
  handler: async (ctx, a): Promise<{ url: string | null; reused?: boolean; updated?: boolean }> => {
    let booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
    const savedReuseEligible = booking && booking.accountAccessRequired === false &&
      ["required", "processing", "requires_input", "manual_review", "rejected"].includes(booking.idVerifyStatus ?? "required") &&
      booking.idVerificationSource !== "manual" && !booking.diditManualDecisionAt;
    if (!booking || booking.verificationProvider !== "didit" || !verificationBookingOpen(booking.status) ||
        (!["required", "processing", "requires_input"].includes(booking.idVerifyStatus ?? "required") &&
          !(booking.idVerifyStatus === "verified" && verificationExpired(booking)) &&
          !(savedReuseEligible && ["manual_review", "rejected"].includes(booking.idVerifyStatus))))
      throw new Error("This booking is not ready for verification.");
    if (!verificationCanStart(booking)) throw Error("Complete the rental payment and required card hold before verification.");
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

    const originalSessionId = booking.diditSessionId;
    try {
    if (savedReuseEligible) {
      if(await ctx.runQuery(internal.bookings.reuseVerificationPotential,{bookingId:a.bookingId}) === true &&
         !(await ctx.runQuery(internal.bookings.reuseVerificationCandidate,{bookingId:a.bookingId})))
        throw new VerificationReusePending("Your saved verification is being checked. Please try again shortly or contact the team in your rental conversation.");
      if(await ctx.runQuery(internal.bookings.reuseVerificationPotential,{bookingId:a.bookingId}) === true) {
        await ctx.runAction(internal.didit.reuseVerification, { bookingId: a.bookingId });
        booking = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
        if (booking?.idVerifyStatus === "verified" && verificationCanStart(booking)) return { url: null, reused: true };
      }
      if (!booking || !verificationCanStart(booking) || !["required", "processing", "requires_input"].includes(booking.idVerifyStatus ?? "required")) throw Error("The rental changed. Refresh its verification progress.");
      if(await ctx.runQuery(internal.bookings.reuseVerificationPotential,{bookingId:a.bookingId}) === true)
        throw new VerificationReusePending("Your saved verification is being checked. Please try again shortly or contact the team in your rental conversation.");
    }
    const cfg = config();
    let reopeningExistingSession = false;
    if (booking.diditSessionId) {
      const decisionReadAt = Date.now();
      const existing = await retrieveSession(cfg.apiKey, booking.diditSessionId, String(a.bookingId), booking.guestEmail);
      if (existing.workflow_id !== cfg.workflowId) throw new Error("Verification workflow does not match this rental.");
      if (resumableSessionStatuses.includes(existing.status)) {
        if (typeof existing.session_url === "string" && hostedSessionUrl.test(existing.session_url))
          return { url: existing.session_url };
        reopeningExistingSession = true;
      } else if (existing.status !== "Expired" && existing.status !== "Abandoned" && !(booking.idVerifyStatus === "verified" && verificationExpired(booking) && existing.status === "Approved")) {
        if (booking.idVerificationSource === "manual" && booking.idVerifyStatus === "requires_input")
          throw new Error("The replacement request is being prepared. Contact the team from your rental conversation.");
        const mapped = mapDecision(existing.status, existing);
        if (!mapped) throw new Error("The verification decision could not be read. Contact the team from your rental conversation.");
        const saved = await ctx.runMutation(internal.bookings.setDiditResult, {
          bookingId: a.bookingId, sessionId: booking.diditSessionId,
          eventId: `open-progress-${booking.diditSessionId}-${decisionReadAt}`, eventAt: decisionReadAt,
          providerStatus: existing.status, reconciliation: true, expectedEventId: booking.diditEventId ?? null,
          expectedEventAt: booking.diditEventAt ?? null, expectedManualDecisionAt: booking.diditManualDecisionAt ?? null, ...mapped,
        });
        if (!saved) throw new Error("The verification session changed. Refresh this rental.");
        return { url: null, updated: true };
      }
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
    const result: { session_id?: string; url?: string; workflow_id?: string; status?: string } = await res.json();
    if (reopeningExistingSession) {
      if (result.session_id !== booking.diditSessionId || result.workflow_id !== cfg.workflowId ||
          !resumableSessionStatuses.includes(result.status as typeof resumableSessionStatuses[number]) ||
          !result.url || !hostedSessionUrl.test(result.url))
        throw new Error("The saved verification session could not be reopened. Contact the team from your rental conversation.");
      return { url: result.url };
    }
    if (!result.session_id || result.session_id === booking.diditSessionId ||
        result.workflow_id !== cfg.workflowId || !result.url ||
        !hostedSessionUrl.test(result.url))
      throw new Error("Verification provider returned an invalid session.");
    const saved: boolean = await ctx.runMutation(internal.bookings.setDiditSession, {
      bookingId: a.bookingId, sessionId: result.session_id, previousSessionId: booking.diditSessionId,
    });
    if (!saved) {
      const current: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
      if (current?.diditSessionId && verificationCanStart(current)) {
        const attached = await retrieveSession(cfg.apiKey, current.diditSessionId, String(a.bookingId), current.guestEmail);
        if (attached.workflow_id === cfg.workflowId && ["Not Started", "In Progress", "Awaiting User", "Resubmitted"].includes(attached.status) && typeof attached.session_url === "string" && hostedSessionUrl.test(attached.session_url)) return { url: attached.session_url };
      }
      throw new Error("The rental changed while verification opened. Refresh its progress before continuing.");
    }
    return { url: result.url };
    } catch (error) {
      if(error instanceof VerificationReusePending)throw error;
      try {
        await ctx.runMutation(internal.bookings.flagDiditOpeningFailure, {
          bookingId: a.bookingId, sessionId: originalSessionId,
        });
      } catch {
        console.error("Verification opening failure alert could not be queued");
      }
      throw error;
    }
  },
});

export const reuseVerification = internalAction({
 args: { bookingId: v.id("bookings") },
 handler: async (ctx, { bookingId }) => {
  const candidate: any = await ctx.runQuery(internal.bookings.reuseVerificationCandidate, { bookingId });
  if (!candidate) return;
  try {
    let cfg: ReturnType<typeof config>;
    try { cfg = config(); } catch { throw new DiditDecisionUnavailable("Verification provider configuration is unavailable."); }
    const report = await retrieveSession(cfg.apiKey, candidate.source.diditSessionId, String(candidate.source._id), candidate.source.guestEmail);
    if (report.workflow_id !== cfg.workflowId) return;
    const mapped = mapDecision(report.status, report);
    if (!mapped) return;
    if (mapped.status !== "verified") {
      await ctx.runMutation(internal.bookings.revokeVerificationReuse, { sourceBookingId: candidate.source._id,
        sessionId:candidate.source.diditSessionId,expectedEventId:candidate.source.diditEventId??null,
        expectedEventAt:candidate.source.diditEventAt??null,expectedManualDecisionAt:candidate.source.diditManualDecisionAt??null }); return;
    }
    await ctx.runMutation(internal.bookings.applyVerificationReuse, { bookingId, sourceBookingId: candidate.source._id, ...(mapped.documentExpiresAt != null ? { documentExpiresAt: mapped.documentExpiresAt } : {}), personKey: mapped.personKey });
  } catch (error) {
    if (!(error instanceof DiditDecisionUnavailable)) return;
    try { await ctx.runMutation(internal.bookings.flagDiditProcessingFailure, { bookingId:candidate.source._id,sessionId:candidate.source.diditSessionId }); }
    catch { console.error("Verification provider availability alert failed"); }
    const copies=await ctx.runQuery(internal.verificationArchive.reuseReadCandidate,{bookingId:candidate.source._id});
    if(!copies)return;
    try {
      for(const document of copies.documents){
        const blob=await ctx.storage.get(document.storageId);
        if(!blob||blob.size!==document.size||blob.type!==document.contentType||createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex")!==document.sha256)throw Error("Required verification copy unavailable");
      }
    } catch {
      await ctx.runMutation(internal.verificationArchive.reuseReadFailure,{archiveId:copies.archiveId,generation:copies.generation,expectedVerifiedAt:copies.readVerifiedAt});
      return;
    }
    await ctx.runMutation(internal.bookings.applyVerificationReuse, { bookingId, sourceBookingId:candidate.source._id,
      ...(candidate.source.documentExpiresAt != null ? { documentExpiresAt:candidate.source.documentExpiresAt } : {}),personKey:candidate.source.renterPersonKey });
  }
 }
});

export const adminReview = action({
  args: {
    token: v.string(), bookingId: v.id("bookings"),
    decision: v.union(v.literal("approve"), v.literal("resubmit"), v.literal("decline")),
    note: v.string(),
  },
  handler: async (ctx, { token, bookingId, decision, note }): Promise<{status:"updated"}> => {
    const scopedReview = process.env.ADMIN_SESSION_DIDIT_REVIEW_V2 === "enabled";
    if (scopedReview) await ctx.runMutation(internal.adminAccountSessionV2.authorizeDiditReview, { token });
    else await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "didit.adminReview" });
    const reason = note.trim();
    if (reason.length < 5 || reason.length > 400) throw new Error("Record a 5–400 character review reason.");
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
    if (!booking || booking.verificationProvider !== "didit" || !booking.diditSessionId ||
        !verificationBookingOpen(booking.status) ||
        !["manual_review", "rejected"].includes(booking.idVerifyStatus))
      throw new Error("Only a paid rental with a completed Didit case can be reviewed here.");
    if (decision === "approve" && booking.idVerifyStatus !== "manual_review")
      throw new Error("The rental is not awaiting Didit review. Refresh the case or request resubmission.");
    const cfg = config();
    let session = await retrieveSession(cfg.apiKey, booking.diditSessionId, String(bookingId), booking.guestEmail);
    if (session.workflow_id !== cfg.workflowId) throw new Error("Verification workflow does not match this rental.");
    if (!["Approved", "Declined", "In Review", "Kyc Expired", "Abandoned", "Resubmitted"].includes(session.status))
      throw new Error("This verification is still in progress or expired; it cannot be manually decided.");
    const targetStatus = decision === "approve" ? "Approved" : decision === "decline" ? "Declined" : "Resubmitted";
    if (decision === "approve" && !["Approved", "In Review"].includes(session.status))
      throw new Error("This Didit case cannot be approved; request a resubmission for failed or expired checks.");
    if (decision === "approve" && session.status === "In Review") {
      const fields = ["id_verifications", "liveness_checks", "face_matches", "poa_verifications"] as const;
      const valid = fields.every(field => Array.isArray(session[field]) && session[field].length > 0 && session[field].every((item:any) =>
        item?.status === "Approved" || item?.status === "In Review"));
      if (!valid) throw new Error("A required Didit check failed or is missing. Request a resubmission instead.");
    }
    if (session.status !== targetStatus) {
      let response: Response;
      try {
        response = await fetch(`${sessionApi}${booking.diditSessionId}/update-status/`, {
          method: "PATCH",
          headers: { "x-api-key": cfg.apiKey, "content-type": "application/json" },
          body: JSON.stringify({ new_status: targetStatus, comment: reason }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new Error("Could not update Didit. Refresh the rental before retrying.");
      }
      if (!response.ok) {
        if (response.status === 409) throw new Error("The Didit case changed during review. Refresh and try again.");
        if (response.status === 429 || response.status >= 500) throw new Error("Didit is temporarily unavailable. Refresh the case and retry shortly.");
        throw new Error("Didit did not accept this decision. Refresh the case and check its current status.");
      }
      const acknowledgement: any = await response.json().catch(() => null);
      if (acknowledgement?.session_id !== booking.diditSessionId) throw new Error("Didit did not confirm the case update. Refresh before retrying.");
    }

    // Didit is authoritative. Re-read after every requested change before the
    // website releases the rental's verification gate or sends its messages.
    session = await retrieveSession(cfg.apiKey, booking.diditSessionId, String(bookingId), booking.guestEmail);
    if (session.workflow_id !== cfg.workflowId || session.status !== targetStatus)
      throw new Error("Didit has not confirmed this decision yet. Refresh the rental before retrying.");
    const mapped = mapDecision(session.status, session);
    const expectedStatus = decision === "approve" ? "verified" : decision === "decline" ? "rejected" : "requires_input";
    if (!mapped || mapped.status !== expectedStatus) throw new Error("The Didit decision could not be reconciled.");
    const latest: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
    if (!latest || latest.diditSessionId !== booking.diditSessionId || !verificationBookingOpen(latest.status))
      throw new Error("The rental changed during review. Check its current status and the Didit case.");
    if (latest.idVerifyStatus === expectedStatus) return {status:"updated"};
    const appliedAt = Date.now();
    const saved: boolean = await ctx.runMutation(internal.bookings.setDiditResult, {
      bookingId, sessionId:booking.diditSessionId, eventId:`manual-review-${decision}-${booking.diditSessionId}-${appliedAt}`,
      eventAt:appliedAt, providerStatus:session.status, ...mapped, reconciliation:true, requireApplied:true,
      expectedEventId:latest.diditEventId ?? null, expectedEventAt:latest.diditEventAt ?? null, expectedManualDecisionAt:latest.diditManualDecisionAt ?? null,
      ...(scopedReview ? { adminReviewSessionToken: token } : {}),
    });
    if (!saved) {
      const after: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
      if (after?.diditSessionId === booking.diditSessionId && after.idVerifyStatus === expectedStatus) return {status:"updated"};
      throw new Error("The rental changed during review. Check its current status and the Didit case.");
    }
    return {status:"updated"};
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
    if (!authorized && a.checkoutSessionId && booking?.stripeCheckoutSessionId === a.checkoutSessionId && verificationBookingOpen(booking.status)) authorized = true;
    if (!authorized || !booking) throw Error("Sign in to view this rental's verification.");
    return await refreshBoundProgress(ctx, a.bookingId, booking);
  },
});

async function refreshBoundProgress(ctx: any, bookingId: any, booking: any): Promise<{status:string}> {
    if (!verificationBookingOpen(booking.status)) return {status: "closed"};
    if (booking.verificationProvider !== "didit" || !booking.diditSessionId) return {status: "not_started"};
    const claimed = await ctx.runMutation(internal.bookings.claimDiditProgressRefresh, {bookingId, sessionId:booking.diditSessionId});
    if (!claimed) return {status: "unchanged"};
    try {
    const cfg = config();
    const readStartedAt = Date.now();
    const report = await retrieveSession(cfg.apiKey, booking.diditSessionId, String(bookingId), booking.guestEmail);
    if (report.workflow_id !== cfg.workflowId) throw Error("Verification workflow does not match this rental.");
    const mapped = mapDecision(report.status, report);
    if (!mapped) throw Error("Unknown verification status.");
    // Polling is for progress, not a synthetic new document event on every
    // tick. Signed data.updated webhooks and full reconciliation still capture
    // document changes; identical progress must not reset a completed archive.
    const advisoryCannotChange = booking.identityRiskNotice === "Didit approved the identity, but cross-account identity matching is unavailable." && !mapped.personKey;
    // A previous implementation could persist that advisory even when this
    // booking already held the matching provider-attested HMAC key. Let the
    // next bound Approved refresh clear that stale advisory through the normal
    // booking mutation; keep short-circuiting only when no trusted key exists.
    const canClearStaleIdentityAdvisory = advisoryCannotChange && /^[a-f0-9]{64}$/.test(booking.renterPersonKey ?? "");
    const needsConfirmationRepair = booking.status === "confirmed" && mapped.status !== "verified";
    if (!canClearStaleIdentityAdvisory && !needsConfirmationRepair && (!booking.identityRiskNotice || advisoryCannotChange) && booking.idVerifyStatus === mapped.status && (["identity", "selfie", "address"] as const).every(key => booking.verificationChecks?.[key] === mapped.checks[key]) &&
        (booking.verificationNote ?? null) === (mapped.note ?? null) && (booking.documentExpiresAt ?? null) === (mapped.documentExpiresAt ?? null) &&
        (!mapped.personKey || booking.renterPersonKey === mapped.personKey)) return {status: "unchanged"};
    const saved = await ctx.runMutation(internal.bookings.setDiditResult, {
      bookingId, sessionId: booking.diditSessionId,
      eventId: `progress-${booking.diditSessionId}-${readStartedAt}`, eventAt: readStartedAt, providerStatus: report.status,
      expectedEventId: booking.diditEventId ?? null, expectedEventAt: booking.diditEventAt ?? null,
      expectedManualDecisionAt: booking.diditManualDecisionAt ?? null, ...mapped,
    });
    if (!saved) throw Error("The verification session changed. Refresh this rental.");
    return {status: "updated"};
    } catch (error) {
      try { await ctx.runMutation(internal.bookings.flagDiditProcessingFailure, {bookingId, sessionId:booking.diditSessionId}); }
      catch { console.error("Didit progress failure alert could not be queued"); }
      throw error;
    }
}

export const refreshForGaffer = internalAction({
  args: { accountId: v.id("accounts"), bookingId: v.id("bookings") },
  handler: async (ctx, {accountId, bookingId}): Promise<{status:string}> => {
    const booking = await ctx.runQuery(internal.chat._gafferVerificationAccess, {accountId, bookingId});
    if (!booking) throw Error("Rental unavailable.");
    return await refreshBoundProgress(ctx, bookingId, booking);
  },
});

/** Webhook delivery is normally immediate. Re-read a bounded set of open
 * rentals hourly so a missed callback cannot leave verification stuck. */
export const reconcileOpenSessions = internalAction({
  args: { generation: v.number() },
  handler: async (ctx, { generation }) => {
    try {
    const candidates = await ctx.runQuery(internal.diditSweep.batch, { generation });
    let cfg: ReturnType<typeof config>;
    try { cfg = config(); }
    catch (error) {
      await ctx.runMutation(internal.diditSweep.configurationFailure, { generation });
      throw error;
    }
    if (!candidates.length) return;
    let failures = 0;
    for (let i = 0; i < candidates.length; i += 5) {
      const outcomes = await Promise.allSettled(candidates.slice(i, i + 5).map(async (candidate) => {
        try {
          const readStartedAt = Date.now();
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
            eventAt: readStartedAt,
            providerStatus: report.status,
            reconciliation: true,
            sweepGeneration: generation,
            expectedEventId: candidate.expectedEventId,
            expectedEventAt: candidate.expectedEventAt,
            expectedManualDecisionAt: candidate.expectedManualDecisionAt,
            ...mapped,
          });
          if (!saved) throw new Error("Verification session changed during reconciliation.");
        } catch {
          failures++;
          await ctx.runMutation(internal.bookings.flagDiditProcessingFailure,{bookingId:candidate.bookingId,sessionId:candidate.sessionId,sweepGeneration:generation});
        }
        await ctx.runMutation(internal.bookings.markDiditReconciled, {
          bookingId: candidate.bookingId, sessionId: candidate.sessionId, attemptedAt: Date.now(), sweepGeneration:generation,
        });
      }));
      failures += outcomes.filter(outcome => outcome.status === "rejected").length;
    }
    if (failures) throw new Error(`${failures} rental verification case(s) could not be reconciled.`);
    } finally {
      await ctx.runMutation(internal.diditSweep.finish, { generation });
    }
  },
});

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function validSignature(secret: string, signature: string | undefined, content: string): boolean {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(content, "utf8").digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
    // Didit's final session status is authoritative. Its decision payload may
    // omit feature details when they were not returned, which must not turn a
    // completed provider approval into a manual review.
    status = "verified";
    if (Array.isArray(decision?.poa_verifications)) poaPostcodes = decision.poa_verifications.map((poa: any) =>
      String(poa.poa_parsed_address?.postal_code ?? poa.poa_formatted_address ?? poa.poa_address ?? ""));
  } else if (rawStatus === "In Review") status = "manual_review";
  else if (["Resubmitted", "Abandoned", "Expired", "Awaiting User"].includes(String(rawStatus))) status = "requires_input";
  else if (rawStatus === "Declined" || rawStatus === "Kyc Expired") status = "rejected";
  else if (rawStatus === "Not Started" || rawStatus === "In Progress") status = "processing";
  else return null;
  let note = rawStatus === "Expired" ? "The verification link expired. Start a new check before handover."
    : rawStatus === "Abandoned" ? "The verification was not completed. Start a new check before handover."
    : status === "requires_input" ? "Please complete the requested document step." : undefined;
  const expiries = (Array.isArray(decision?.id_verifications) ? decision.id_verifications : [])
    .map((item: any) => /^\d{4}-\d{2}-\d{2}$/.test(item.expiration_date ?? "") ? Date.parse(`${item.expiration_date}T00:00:00Z`) : NaN);
  const documentExpiresAt = expiries.length && expiries.every(Number.isFinite) ? Math.min(...expiries) : undefined;
  // Use provider-attested biographical identity across emails; never store raw DOB or ID numbers.
  const identities = (Array.isArray(decision?.id_verifications) ? decision.id_verifications : [])
    .filter((item: any) => item.status === "Approved" && /^\d{4}-\d{2}-\d{2}$/.test(item.date_of_birth ?? "") && typeof item.full_name === "string" && item.full_name.trim());
  const keys = identities.map((item: any) => JSON.stringify([item.full_name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "), item.date_of_birth]));
  // This key must remain stable for the lifetime of restricted-account
  // identity records. Keep the invoice secret as a backwards-compatible
  // fallback; provision the dedicated secret with the existing invoice-secret
  // value before enabling it so current person keys continue to match.
  const secret = process.env.RESTRICTED_IDENTITY_HMAC_SECRET || process.env.INVOICE_SECRET;
  const personKey = secret && keys.length && new Set(keys).size === 1 ? createHmac("sha256", secret).update(`dbc-person-v1:${keys[0]}`).digest("hex") : undefined;
  const checks = rawStatus === "Approved"
    ? { identity: "approved", selfie: "approved", address: "approved" } as const
    : verificationChecks(decision);
  return { status, note, poaPostcodes, checks, ...(personKey ? { personKey } : {}), ...(documentExpiresAt ? { documentExpiresAt } : {}) };
}

/** Didit v3 webhooks sign the complete canonical JSON with X-Signature-V2.
 * Didit's final Approved session status is authoritative even when feature
 * details are absent; In Review is the provider's explicit manual-review state. */
export const webhook = internalAction({
  args: {
    body: v.string(),
    signature: v.string(),
    previousSignature: v.optional(v.string()),
    rawSignature: v.optional(v.string()),
    previousRawSignature: v.optional(v.string()),
    timestamp: v.string(),
  },
  handler: async (ctx, { body, signature, previousSignature, rawSignature, previousRawSignature, timestamp }): Promise<boolean | "processing_error"> => {
    const reject=async(reason:"configuration"|"signature"|"timestamp"|"provider_context"|"payload"|"booking_binding",alertOwner=false,diagnostic?:{
      bookingId?:string;sessionId?:string;eventId?:string;providerStatus?:string;
    }):Promise<false>=>{
      const safeRef=(value:string|undefined)=>value?createHash("sha256").update(value).digest("hex").slice(0,12):undefined;
      console.warn(`[didit/webhook] rejected: ${reason}${diagnostic?.eventId?` event=${safeRef(diagnostic.eventId)}`:""}${diagnostic?.sessionId?` session=${safeRef(diagnostic.sessionId)}`:""}`);
      if(alertOwner)try{await ctx.runMutation(internal.bookings.flagDiditWebhookRejection,{
        reason,
        ...(diagnostic?.bookingId?{bookingId:diagnostic.bookingId}:{}),
        ...(diagnostic?.sessionId?{sessionRef:safeRef(diagnostic.sessionId)}:{}),
        ...(diagnostic?.eventId?{eventRef:safeRef(diagnostic.eventId)}:{}),
        ...(diagnostic?.providerStatus?{providerStatus:diagnostic.providerStatus.slice(0,40)}:{}),
      });}
      catch{console.error("Didit webhook rejection alert could not be queued");}
      return false;
    };
    let cfg: ReturnType<typeof config>;
    try { cfg = config(); } catch { return reject("configuration",true); }
    if (body.length > 1_000_000) return reject("payload");
    let event: any;
    try { event = JSON.parse(body); } catch { return reject("payload"); }
    const expectedProviderContext=event.application_id===cfg.applicationId&&event.workflow_id===cfg.workflowId&&event.environment===cfg.environment;
    if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
      return reject("timestamp",expectedProviderContext);
    const signed = JSON.stringify(canonical(event));
    const authenticated = validSignature(cfg.webhookSecret, signature, signed) ||
      validSignature(cfg.webhookSecret, previousSignature, signed) ||
      validSignature(cfg.webhookSecret, rawSignature, body) ||
      validSignature(cfg.webhookSecret, previousRawSignature, body);
    if (!authenticated) return reject("signature",expectedProviderContext);
    if (event.timestamp !== Number(timestamp)) return reject("timestamp",true);
    if (event.webhook_type !== "status.updated" && event.webhook_type !== "data.updated") return true;
    if (event.environment !== cfg.environment || event.application_id !== cfg.applicationId ||
        event.workflow_id !== cfg.workflowId || event.session_kind === "business") return reject("provider_context",true);
    if (typeof event.vendor_data !== "string" || !event.vendor_data.startsWith("dbc-booking-") ||
        typeof event.session_id !== "string" || typeof event.event_id !== "string" ||
        !Number.isSafeInteger(event.created_at)) return reject("payload",true);
    const bookingId = event.vendor_data.slice("dbc-booking-".length);
    try {
      const mapped = mapDecision(event.status, event.decision);
      if (!mapped) throw Error("Unsupported verification status");
      const applied = await ctx.runMutation(internal.bookings.setDiditResult, {
        bookingId: bookingId as any,
        sessionId: event.session_id,
        eventId: event.event_id,
        eventAt: event.created_at * 1000,
        providerStatus: event.status,
        ...mapped,
      });
      if (!applied) return reject("booking_binding", true, {
        bookingId, sessionId:event.session_id, eventId:event.event_id,
        providerStatus:typeof event.status==="string"?event.status:undefined,
      });
      return true;
    } catch {
      try { await ctx.runMutation(internal.bookings.flagDiditProcessingFailure,{bookingId:bookingId as any,sessionId:event.session_id}); }
      catch { console.error("Verified Didit event processing and alert failed"); }
      return "processing_error";
    }
  },
});
