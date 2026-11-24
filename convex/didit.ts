"use node";

import { verificationChecks, verificationCanStart, verificationBookingOpen, diditSessionRefreshAllowed, bookingVerificationExpired, verificationExpired, verificationWindowClosed, verificationDeadlineAt } from "../shared/verificationProgress";
import { DIDIT_DOCUMENT_EXPIRED, diditFailureReason } from "../shared/diditFailureReason";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const sessionApi = "https://verification.didit.me/v3/session/";
const hostedSessionUrl = /^https:\/\/verify\.didit\.me\/(?:[a-z-]+\/)?session\/[A-Za-z0-9_-]+$/;
const resumableSessionStatuses = ["Not Started", "In Progress", "Awaiting User", "Resubmitted"] as const;
class DiditDecisionUnavailable extends Error {
  constructor(message: string, readonly providerStatus?: number) {
    super(message);
    this.name = "DiditDecisionUnavailable";
  }
}
class DiditDecisionNotFound extends DiditDecisionUnavailable {
  constructor() {
    super("Could not check the current verification decision. Please try again.", 404);
    this.name = "DiditDecisionNotFound";
  }
}
class VerificationReusePending extends Error {}

function verificationReuseArchiveFallbackAllowed(error: unknown): boolean {
  if (!(error instanceof DiditDecisionUnavailable)) return false;
  const status = error.providerStatus;
  return status === undefined || status === 404 || status === 429 || status >= 500;
}

async function retrieveSession(apiKey: string, sessionId: string, bookingId: string, email: string, includeResubmissions = false): Promise<any> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) throw new Error("Invalid verification case ID.");
  let res: Response;
  try { res = await fetch(`${sessionApi}${sessionId}/decision/${includeResubmissions ? "?include=resubmissions" : ""}`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new DiditDecisionUnavailable("Could not check the current verification decision. Please try again."); }
  if (!res.ok) {
    if (res.status === 404) throw new DiditDecisionNotFound();
    if (res.status >= 400)
      throw new DiditDecisionUnavailable("Could not check the current verification decision. Please try again.", res.status);
    throw new Error("Could not check the current verification decision. Please try again.");
  }
  let session: any = await res.json();
  if (session.session_id !== sessionId || session.session_kind !== "user" ||
      session.vendor_data !== `dbc-booking-${bookingId}` ||
      session.contact_details?.email?.trim().toLowerCase() !== email.trim().toLowerCase())
    throw new Error("Verification case does not match this rental.");
  if (session.status === "Resubmitted" && !includeResubmissions && !session.resubmit_info && !session.resubmissions) {
    try { session = await retrieveSession(apiKey, sessionId, bookingId, email, true); }
    catch { return session; }
  }
  return session;
}

function diditAdminRecoveryMessage(error: unknown): string | null {
  if (error instanceof DiditDecisionUnavailable) {
    if (error.providerStatus === 404)
      return "Didit returned 404 for the saved session. Check the session ID in Didit Business Console; the case was not approved or reset.";
    if (error.providerStatus === 401 || error.providerStatus === 403)
      return "Didit denied the session read. Check the server API key and session-read permission; no decision was changed.";
    if (error.providerStatus === 429 || (error.providerStatus != null && error.providerStatus >= 500))
      return "Didit is temporarily unavailable. The latest result is unconfirmed; retry after the provider recovers. No decision was changed.";
    if (error.providerStatus != null)
      return `Didit rejected the session read (HTTP ${error.providerStatus}). Check the session and workflow in Didit Business Console; no decision was changed.`;
    return "Didit could not be reached. The latest result is unconfirmed; retry after connectivity returns. No decision was changed.";
  }
  if (error instanceof Error && error.message.startsWith("Automatic verification is temporarily unavailable."))
    return "Didit is not configured for this deployment. Check its API key, workflow, application ID, webhook secret and environment.";
  return null;
}

async function retrieveAdminSession(apiKey: string, sessionId: string, bookingId: string, email: string): Promise<any> {
  try {
    return await retrieveSession(apiKey, sessionId, bookingId, email);
  } catch (error) {
    const message = diditAdminRecoveryMessage(error);
    if (message) throw new Error(message);
    throw error;
  }
}

const resubmissionFeatureFields: Record<string, string> = {
  OCR: "id_verifications",
  LIVENESS: "liveness_checks",
  FACE_MATCH: "face_matches",
  POA: "poa_verifications",
  PROOF_OF_ADDRESS: "poa_verifications",
  PHONE: "phone_verifications",
  EMAIL: "email_verifications",
  QUESTIONNAIRE: "questionnaire_responses",
};
const resubmittableFeatureStatuses = new Set(["Declined", "In Review", "Not Finished", "Expired", "Kyc Expired"]);
const resubmissionVerificationFeatures: Record<string, "identity" | "selfie" | "address"> = {
  OCR: "identity",
  LIVENESS: "selfie",
  FACE_MATCH: "selfie",
  POA: "address",
  PROOF_OF_ADDRESS: "address",
};
const resubmissionFeatureLabels: Record<string, string> = {
  OCR: "photo ID",
  LIVENESS: "selfie",
  FACE_MATCH: "selfie",
  POA: "proof of address",
  PROOF_OF_ADDRESS: "proof of address",
  PHONE: "phone check",
  EMAIL: "email check",
  QUESTIONNAIRE: "questionnaire",
};

function resubmissionDetails(decision: any, eventInfo?: any) {
  const latest = Array.isArray(decision?.resubmissions) ? decision.resubmissions.at(-1) : null;
  const info = eventInfo ?? decision?.resubmit_info ?? (latest ? { nodes_to_resubmit: latest.nodes, reasons: latest.reasons } : null);
  const nodes = Array.isArray(info?.nodes_to_resubmit) ? info.nodes_to_resubmit : [];
  const features = new Set<"identity" | "selfie" | "address">();
  const labels = new Set<string>();
  const reasons = new Set<string>();
  for (const node of nodes.slice(0, 20)) {
    if (typeof node?.node_id !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(node.node_id)) continue;
    const feature = typeof node.feature === "string" ? node.feature : "";
    if (resubmissionVerificationFeatures[feature]) features.add(resubmissionVerificationFeatures[feature]);
    if (resubmissionFeatureLabels[feature]) labels.add(resubmissionFeatureLabels[feature]);
    const reason = info?.reasons?.[node.node_id];
    if (typeof reason === "string") {
      const safeReason = reason.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      if (safeReason) reasons.add(safeReason);
    }
  }
  const note = labels.size
    ? `Please resubmit your ${[...labels].join(", ")}.${reasons.size ? ` Didit’s note: ${[...reasons].slice(0, 2).join("; ")}.` : ""}`
    : "Please complete the requested verification step.";
  return { features: [...features], note };
}

function renterActionableResubmissionNodes(report: any, expiredDocumentsOnly = false) {
  const nodes: Array<{ node_id: string; feature: string }> = [];
  const seen = new Set<string>();
  for (const [feature, field] of Object.entries(resubmissionFeatureFields)) {
    if (feature === "PROOF_OF_ADDRESS" || !Array.isArray(report?.[field])) continue;
    for (const row of report[field]) {
      if (expiredDocumentsOnly && row?.status !== "Kyc Expired") continue;
      if (!resubmittableFeatureStatuses.has(row?.status)) continue;
      if (typeof row?.node_id !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(row.node_id)) return null;
      const key = `${field}:${row.node_id}`;
      if (seen.has(key)) return null;
      seen.add(key);
      nodes.push({ node_id: row.node_id, feature });
    }
  }
  return nodes;
}

function validatedResubmissionNodes(preview: any, report: any, expectedEmail: string, requestedNodes: Array<{ node_id: string; feature: string }>) {
  const nodes = preview?.nodes_to_resubmit;
  if (typeof preview?.recipient !== "string" || preview.recipient.trim().toLowerCase() !== expectedEmail.trim().toLowerCase() ||
      preview?.requires_user_action !== true || !Array.isArray(nodes) || !nodes.length || !requestedNodes.length) return null;
  const seen = new Set<string>();
  const normalized: Array<{ node_id: string; feature: string }> = [];
  for (const node of nodes) {
    const field = resubmissionFeatureFields[node?.feature];
    if (!field || typeof node.node_id !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(node.node_id) || !Array.isArray(report[field])) return null;
    const key = `${field}:${node.node_id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const matching = report[field].filter((row: any) => row?.node_id === node.node_id);
    if (!matching.length || !matching.every((row: any) => resubmittableFeatureStatuses.has(row.status))) return null;
    normalized.push({ node_id: node.node_id, feature: node.feature === "PROOF_OF_ADDRESS" ? "POA" : node.feature });
  }
  const requestedKeys = requestedNodes.map(node => `${resubmissionFeatureFields[node.feature]}:${node.node_id}`).sort();
  const previewKeys = normalized.map(node => `${resubmissionFeatureFields[node.feature]}:${node.node_id}`).sort();
  if (requestedKeys.length !== previewKeys.length || requestedKeys.some((key, index) => key !== previewKeys[index])) return null;
  return normalized;
}

const diditReviewFeatureLabels: Record<string, string> = {
  id_verifications: "photo ID",
  liveness_checks: "selfie check",
  face_matches: "face match",
  poa_verifications: "proof of address",
  aml_screenings: "screening",
};

function diditReviewReason(decision: any): string {
  const warnings: any[] = Array.isArray(decision?.warnings) ? [...decision.warnings] : [];
  const reviewFeatures = new Set<string>();
  for (const [field, label] of Object.entries(diditReviewFeatureLabels)) {
    const rows = Array.isArray(decision?.[field]) ? decision[field] : [];
    for (const row of rows) {
      if (row?.status === "In Review") reviewFeatures.add(label);
      if (Array.isArray(row?.warnings)) warnings.push(...row.warnings);
    }
  }
  const summaries = [...new Set(warnings
    .map(warning => typeof warning?.short_description === "string"
      ? warning.short_description.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)
      : "")
    .filter(Boolean))].slice(0, 2);
  if (summaries.length)
    return `Didit requested a team review: ${summaries.join("; ")}`.slice(0, 400);
  if (reviewFeatures.size)
    return `Didit requested a team review of the ${[...reviewFeatures].join(" and ")}.`;
  const risks = [...new Set(warnings
    .map(warning => typeof warning?.risk === "string" ? warning.risk.replace(/[^A-Za-z0-9 _-]/g, " ").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() : "")
    .filter(Boolean))].slice(0, 2);
  if (risks.length)
    return `Didit requested a team review (${risks.join("; ")}).`;
  return "Didit requested a team review. The rental remains pending until the case is resolved.";
}

async function retrieveExpectedStatus(apiKey: string, sessionId: string, bookingId: string, email: string, workflowId: string, targetStatus: string) {
  try {
    const session = await retrieveSession(apiKey, sessionId, bookingId, email);
    return session.workflow_id === workflowId && session.status === targetStatus ? session : null;
  } catch {
    return null;
  }
}

async function reconcileReviewAudit(ctx: any, bookingId: any, booking: any, report: any, apiKey: string): Promise<boolean> {
  const claim = booking.diditReviewClaim;
  const expected = claim?.decision === "approve" ? "Approved" : claim?.decision === "decline" ? "Declined" : claim?.decision === "resubmit" ? "Resubmitted" : null;
  if (!claim?.outcomeUnknown || !/^[a-f0-9]{32}$/.test(claim.auditMarker ?? "") || claim.sessionId !== booking.diditSessionId || !expected || report.status !== expected || !Number.isSafeInteger(claim.startedAt)) return false;
  try {
    const response = await fetch(`https://verification.didit.me/v3/sessions/${booking.diditSessionId}/reviews/?limit=50`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return false;
    const page: any = await response.json();
    if (!Array.isArray(page?.results) || page.results.length > 50) return false;
    const suffix = `\n[DBC review ${claim.auditMarker}]`;
    const found = page.results.some((entry: any) => {
      const createdAt = typeof entry?.created_at === "string" ? Date.parse(entry.created_at) : NaN;
      return entry?.activity_type === "STATUS_UPDATED" && entry.actor_type === "API_KEY" && entry.new_status === expected &&
        typeof entry.comment === "string" && entry.comment.endsWith(suffix) && Number.isFinite(createdAt) &&
        createdAt >= claim.startedAt - 60_000 && createdAt <= Date.now() + 60_000;
    });
    if (!found) return false;
    return await ctx.runMutation(internal.diditReviewClaims.reconcileConfirmed, { bookingId, sessionId: booking.diditSessionId, providerStatus: report.status, expectedMarker: claim.auditMarker });
  } catch { return false; }
}

function config() {
  const apiKey = process.env.DIDIT_API_KEY;
  const workflowId = process.env.DIDIT_WORKFLOW_ID;
  const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET;
  const previousWebhookSecret = process.env.DIDIT_WEBHOOK_SECRET_PREVIOUS;
  const environment = process.env.DIDIT_ENVIRONMENT;
  const applicationId = process.env.DIDIT_APPLICATION_ID;
  if (!apiKey || !workflowId || !webhookSecret || !applicationId || !["sandbox", "live"].includes(environment ?? ""))
    throw new Error("Automatic verification is temporarily unavailable. Please contact us before paying.");
  return { apiKey, workflowId, webhookSecret, previousWebhookSecret, environment, applicationId };
}

function adminConfig() {
  try {
    return config();
  } catch (error) {
    const message = diditAdminRecoveryMessage(error);
    if (message) throw new Error(message);
    throw error;
  }
}

/** Create or reopen the one booking-bound Didit workflow. Only the paid renter can
 * receive its hosted URL; the API key never reaches the browser. */
export const bookingSession = action({
  args: {
    bookingId: v.id("bookings"),
    accountToken: v.optional(v.string()),
    checkoutSessionId: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ url: string | null; reused?: boolean; updated?: boolean; waitingForBookingId?: string }> => {
    let booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
    const savedReuseEligible = booking && booking.accountAccessRequired === false &&
      ["required", "processing", "requires_input", "manual_review", "rejected"].includes(booking.idVerifyStatus ?? "required") &&
      booking.idVerificationSource !== "manual" && !booking.diditManualDecisionAt && !booking.verificationFreshRequired;
    if (!booking || booking.verificationProvider !== "didit" || !verificationBookingOpen(booking.status) ||
        (!["required", "processing", "requires_input"].includes(booking.idVerifyStatus ?? "required") &&
          !(booking.idVerifyStatus === "verified" && bookingVerificationExpired(booking)) &&
          !(savedReuseEligible && ["manual_review", "rejected"].includes(booking.idVerifyStatus))))
      throw new Error("This booking is not ready for verification.");
    if (verificationWindowClosed(booking))
      throw new Error("Verification for this rental closed two hours after its scheduled start. This does not affect future rentals.");
    if (booking.status === "pending_verification" && (!Number.isSafeInteger(booking.checkoutPaidAt) || booking.checkoutPaidAt <= 0))
      throw new Error("Complete the rental payment before opening verification.");
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
    let diditClaimId: string | undefined;
    try {
    if (savedReuseEligible) {
      if(await ctx.runQuery(internal.bookings.reuseVerificationPotential,{bookingId:a.bookingId}) === true &&
         !(await ctx.runQuery(internal.bookings.reuseVerificationCandidate,{bookingId:a.bookingId})))
        if (booking.verificationInProgressFrom)
          return { url: null, waitingForBookingId: String(booking.verificationInProgressFrom) };
        else throw new VerificationReusePending("Your saved verification is being checked. Please try again shortly or contact the team in your rental conversation.");
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
        if (typeof existing.session_url === "string" && hostedSessionUrl.test(existing.session_url)) {
          if (verificationWindowClosed(booking))
            throw new Error("Verification for this rental closed two hours after its scheduled start. This does not affect future rentals.");
          return { url: existing.session_url };
        }
        reopeningExistingSession = true;
      } else if (existing.status !== "Expired" && existing.status !== "Abandoned" && !(booking.idVerifyStatus === "verified" && verificationExpired(booking) && existing.status === "Approved")) {
        if (booking.idVerificationSource === "manual" && booking.idVerifyStatus === "requires_input")
          throw new Error("The replacement request is being prepared. Contact the team from your rental conversation.");
        const mapped = mapDecision(existing.status, existing);
        if (!mapped) throw new Error("The verification decision could not be read. Contact the team from your rental conversation.");
        const saved = await ctx.runMutation(internal.bookings.setDiditResult, {
          bookingId: a.bookingId, sessionId: booking.diditSessionId,
          eventId: `open-progress-${booking.diditSessionId}-${decisionReadAt}`, eventAt: decisionReadAt,
          providerStatus: existing.status, reconciliation: true, requireApplied: true, expectedEventId: booking.diditEventId ?? null,
          expectedEventAt: booking.diditEventAt ?? null, expectedManualDecisionAt: booking.diditManualDecisionAt ?? null,
          expectedLateBlockedEventId: booking.verificationLateBlockedEventId ?? null,
          expectedLateBlockedEventAt: booking.verificationLateBlockedEventAt ?? null, ...mapped,
        });
        if (!saved) throw new Error("The verification session changed. Refresh this rental.");
        return { url: null, updated: true };
      }
    }
    if (!reopeningExistingSession) {
      diditClaimId = randomUUID();
      const slot = await ctx.runMutation(internal.bookings.claimDiditSessionSlot, {
        bookingId: a.bookingId, claimId: diditClaimId, ...(booking.diditSessionId ? { previousSessionId: booking.diditSessionId } : {}),
      });
      if (slot?.kind === "waiting" && slot.sourceBookingId)
        return { url: null, waitingForBookingId: String(slot.sourceBookingId) };
      if (slot?.kind === "busy")
        throw new VerificationReusePending("Verification is opening for this rental. Please try again in a moment.");
      if (slot?.kind !== "owner") throw new Error("The rental changed. Refresh verification progress before continuing.");
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
      if (verificationWindowClosed(booking))
        throw new Error("Verification for this rental closed two hours after its scheduled start. This does not affect future rentals.");
      return { url: result.url };
    }
    if (!result.session_id || result.session_id === booking.diditSessionId ||
        result.workflow_id !== cfg.workflowId || !result.url ||
        !hostedSessionUrl.test(result.url))
      throw new Error("Verification provider returned an invalid session.");
    const saved: boolean = await ctx.runMutation(internal.bookings.setDiditSession, {
      bookingId: a.bookingId, sessionId: result.session_id, previousSessionId: booking.diditSessionId, claimId: diditClaimId,
    });
    if (!saved) {
      const current: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
      if (current?.idVerifyStatus === "verified" && current.idVerificationSource === "reused_didit" &&
          current.verificationReusedFrom && verificationCanStart(current)) return { url: null, reused: true };
      if (current && !current.diditSessionId && await ctx.runQuery(internal.bookings.reuseVerificationPotential, { bookingId: a.bookingId }))
        throw new VerificationReusePending("Your saved verification is being checked. Please try again shortly or contact the team in your rental conversation.");
      if (current?.verificationInProgressFrom)
        return { url: null, waitingForBookingId: String(current.verificationInProgressFrom) };
      if (current?.diditSessionId && verificationCanStart(current)) {
        const attached = await retrieveSession(cfg.apiKey, current.diditSessionId, String(a.bookingId), current.guestEmail);
        if (attached.workflow_id === cfg.workflowId && ["Not Started", "In Progress", "Awaiting User", "Resubmitted"].includes(attached.status) && typeof attached.session_url === "string" && hostedSessionUrl.test(attached.session_url)) return { url: attached.session_url };
      }
      throw new Error("The rental changed while verification opened. Refresh its progress before continuing.");
    }
    diditClaimId = undefined;
    return { url: result.url };
    } catch (error) {
      if (diditClaimId) {
        try { await ctx.runMutation(internal.bookings.releaseDiditSessionClaim, { bookingId: a.bookingId, claimId: diditClaimId }); }
        catch { console.error("Verification session claim could not be released"); }
      }
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

/** The renter explicitly requests another attempt for an automatic decline or
 * an expired ID document. Didit's preview supplies the exact steps; the
 * website owns the one renter email for this status change. */
export const retryRejected = action({
  args: { bookingId: v.id("bookings"), accountToken: v.optional(v.string()), checkoutSessionId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ url: string }> => {
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId:a.bookingId });
    if (booking && verificationWindowClosed(booking))
      throw new Error("Verification for this rental closed two hours after its scheduled start. This does not affect future rentals.");
    if (!booking || booking.verificationProvider !== "didit" || !booking.diditSessionId ||
        !["rejected", "requires_input"].includes(booking.idVerifyStatus ?? "") || !verificationCanStart(booking))
      throw new Error("This verification cannot be retried yet. Refresh the page or contact the team.");
    let authorized = false;
    if (a.accountToken) {
      const account: any = await ctx.runQuery(internal.accounts._byToken, { token:a.accountToken });
      authorized = !!account && belongsToRentalAccount(booking, account);
    }
    if (!authorized && a.checkoutSessionId && booking.stripeCheckoutSessionId === a.checkoutSessionId) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error("Payment service unavailable.");
      const paid = await new Stripe(key).checkout.sessions.retrieve(a.checkoutSessionId);
      authorized = paid.status === "complete" && ["paid", "no_payment_required"].includes(paid.payment_status) && paid.metadata?.bookingId === a.bookingId;
    }
    if (!authorized) throw new Error("Sign in to retry this rental's verification.");
    const sessionId = booking.diditSessionId, requestId = randomUUID();
    await ctx.runMutation(internal.diditReviewClaims.claimRenterRetry, {bookingId:a.bookingId, sessionId, requestId,
      expectedEventId:booking.diditEventId ?? null, expectedEventAt:booking.diditEventAt ?? null,
      expectedAccountId:booking.accountId ?? null, expectedEmail:booking.guestEmail, expectedIdVerifyStatus:booking.idVerifyStatus});
    try {
      const cfg = config();
      let report = await retrieveSession(cfg.apiKey, sessionId, String(a.bookingId), booking.guestEmail);
      if (report.workflow_id !== cfg.workflowId) throw new Error("Verification workflow does not match this rental.");
      const automaticDecline = report.status === "Declined" && report.decision_trace?.decided_by === "automatic";
      const expiredDocument = report.status === "Kyc Expired" && booking.idVerifyStatus === "requires_input" && booking.verificationNote === DIDIT_DOCUMENT_EXPIRED;
      if (!automaticDecline && !expiredDocument)
        throw new Error("This verification needs the team's review before another attempt.");
      const requestedNodes = renterActionableResubmissionNodes(report, expiredDocument);
      if (!requestedNodes?.length) throw new Error("Didit has no renter-actionable steps to resubmit. Contact the team for help.");
      const previewResponse = await fetch(`${sessionApi}${sessionId}/resubmission-preview/`, {
        method:"POST", headers:{"x-api-key":cfg.apiKey,"content-type":"application/json"},
        body:JSON.stringify({nodes_to_resubmit:requestedNodes,email_language:"en"}), signal:AbortSignal.timeout(20_000),
      });
      if (!previewResponse.ok) throw new Error("The retry could not be prepared. Please try again or contact the team.");
      const preview: any = await previewResponse.json();
      const requestNodes = validatedResubmissionNodes(preview, report, booking.guestEmail, requestedNodes);
      if (!requestNodes)
        throw new Error("Didit did not confirm renter-actionable steps for another attempt. Contact the team for help.");
      if (verificationWindowClosed(booking))
        throw new Error("Verification for this rental closed two hours after its scheduled start. This does not affect future rentals.");
      const response = await fetch(`${sessionApi}${sessionId}/update-status/`, {
        method:"PATCH", headers:{"x-api-key":cfg.apiKey,"content-type":"application/json","Idempotency-Key":`renter-retry-${requestId}`},
        body:JSON.stringify({new_status:"Resubmitted",comment:"The renter requested another attempt.",nodes_to_resubmit:requestNodes,
          send_email:false}),
        signal:AbortSignal.timeout(20_000),
      }).catch(() => null);
      let acknowledged = false;
      if (response?.ok) acknowledged = (await response.json().catch(() => null))?.session_id === sessionId;
      if (!acknowledged) {
        const uncertain = !response || response.ok || response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
        if (uncertain) {
          const observed = await retrieveExpectedStatus(cfg.apiKey, sessionId, String(a.bookingId), booking.guestEmail, cfg.workflowId, "Resubmitted");
          if (observed) report = observed;
          else throw new Error(response?.status === 409
            ? "The verification changed or could not be reopened. Refresh the page or contact the team."
            : "The verification update may still be processing. Refresh its status before trying again.");
        } else {
          throw new Error("The verification changed or could not be reopened. Refresh the page or contact the team.");
        }
      }
      if (acknowledged) report = await retrieveSession(cfg.apiKey, sessionId, String(a.bookingId), booking.guestEmail);
      if (report.workflow_id !== cfg.workflowId || report.status !== "Resubmitted" || typeof report.session_url !== "string" || !hostedSessionUrl.test(report.session_url))
        throw new Error("The retry is being prepared. Refresh this page in a moment.");
      const mapped = mapDecision(report.status, report, report.status === "Resubmitted" ? { nodes_to_resubmit: requestNodes } : undefined);
      if (!mapped) throw new Error("The retry is being prepared. Refresh this page in a moment.");
      const saved: boolean = await ctx.runMutation(internal.bookings.setDiditResult, {bookingId:a.bookingId,sessionId,
        eventId:`renter-retry-${requestId}`,eventAt:Date.now(),providerStatus:report.status,...mapped,reconciliation:true,
        requireApplied:true,
        expectedEventId:booking.diditEventId ?? null,expectedEventAt:booking.diditEventAt ?? null,
        expectedManualDecisionAt:booking.diditManualDecisionAt ?? null,
        expectedLateBlockedEventId:booking.verificationLateBlockedEventId ?? null,
        expectedLateBlockedEventAt:booking.verificationLateBlockedEventAt ?? null});
      if (!saved) throw new Error("This rental changed. Refresh its verification progress.");
      const current: any = await ctx.runQuery(internal.bookings.verificationAccess, {bookingId:a.bookingId});
      if (!current || current.diditSessionId !== sessionId || !verificationCanStart(current) || current.idVerifyStatus !== "requires_input")
        throw new Error("This rental changed. Refresh its verification progress.");
      return {url:report.session_url};
    } finally { await ctx.runMutation(internal.diditReviewClaims.release,{bookingId:a.bookingId,sessionId,requestId}); }
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
    if (!verificationReuseArchiveFallbackAllowed(error)) return;
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
    note: v.string(), requestId: v.string(),
  },
  handler: async (ctx, { token, bookingId, decision, note, requestId }): Promise<{ status: string; providerStatus: string }> => {
    if (process.env.ADMIN_SESSION_DIDIT_REVIEW_V2 === "enabled")
      await ctx.runMutation(internal.adminAccountSessionV2.authorizeDiditReview, { token });
    else await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "didit.adminReview" });
    const reason = note.trim();
    if (reason.length < 5 || reason.length > 400) throw new Error("Add a 5–400 character review reason.");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new Error("Refresh the case and try again.");
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
    if (booking && verificationWindowClosed(booking))
      throw new Error("This rental's verification window has passed. Use the one-rental admin override before deciding in Didit.");
    if (!booking || booking.verificationProvider !== "didit" || !booking.diditSessionId ||
        !verificationBookingOpen(booking.status) || booking.idVerifyStatus !== "manual_review")
      throw new Error("Only a rental waiting for Didit review can be decided here.");
    const sessionId = booking.diditSessionId;
    await ctx.runMutation(internal.diditReviewClaims.claim, { bookingId, sessionId, requestId, decision });
    try {
      const cfg = adminConfig();
    let session = await retrieveAdminSession(cfg.apiKey, sessionId, String(bookingId), booking.guestEmail);
      if (session.workflow_id !== cfg.workflowId) throw new Error("Verification workflow does not match this rental.");
      if (session.status !== "In Review") throw new Error("Didit has already changed this case. Refresh the rental before deciding.");

      const targetStatus = decision === "approve" ? "Approved" : decision === "decline" ? "Declined" : "Resubmitted";
      let nodesToResubmit: Array<{ node_id: string; feature: string }> | undefined;
      if (decision === "resubmit") {
        const requestedNodes = renterActionableResubmissionNodes(session);
        if (!requestedNodes?.length)
          throw new Error("Didit has no renter-actionable steps to resubmit. Review the case and approve or decline it instead.");
        const previewResponse = await fetch(`${sessionApi}${sessionId}/resubmission-preview/`, {
          method: "POST",
          headers: { "x-api-key": cfg.apiKey, "content-type": "application/json" },
          body: JSON.stringify({ nodes_to_resubmit: requestedNodes, email_language: "en" }),
          signal: AbortSignal.timeout(20_000),
        }).catch(() => null);
        if (!previewResponse) throw new Error("Didit could not be reached. Refresh the case before deciding.");
        if (!previewResponse.ok) {
          if (previewResponse.status === 409) throw new Error("The Didit case changed. Refresh before deciding.");
          if (previewResponse.status === 429 || previewResponse.status >= 500) throw new Error("Didit is temporarily unavailable. Refresh and retry shortly.");
          if (previewResponse.status === 401 || previewResponse.status === 403) throw new Error("The Didit key cannot review this case. Check its session-write access.");
          throw new Error("Didit could not prepare the requested resubmission. Refresh the case and check its current status.");
        }
        const preview: any = await previewResponse.json().catch(() => null);
        nodesToResubmit = validatedResubmissionNodes(preview, session, booking.guestEmail, requestedNodes) ?? undefined;
        if (!nodesToResubmit) throw new Error("Didit did not identify valid, renter-matched steps that need resubmission. Refresh the case before deciding.");
      }

      const beforeDecision: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
      if (!beforeDecision || beforeDecision.diditSessionId !== sessionId || beforeDecision.idVerifyStatus !== "manual_review" ||
          !verificationBookingOpen(beforeDecision.status) || beforeDecision.verificationProvider !== "didit" ||
          beforeDecision.accountId !== booking.accountId || beforeDecision.guestEmail !== booking.guestEmail ||
          verificationWindowClosed(beforeDecision))
        throw new Error("This rental or its verification window changed before Didit could be updated. Refresh the rental before deciding.");

      // Didit is the source of truth for the decision, but renter email stays
      // on the website's booking email path so approval includes the invoice and
      // handover details and decisions never produce duplicate provider emails.
      const auditMarker = randomUUID().replace(/-/g, "");
      await ctx.runMutation(internal.diditReviewClaims.markUnknown, { bookingId, requestId, sessionId, expectedAccountId: booking.accountId ?? null, expectedEmail: booking.guestEmail, auditMarker });
      const response = await fetch(`${sessionApi}${sessionId}/update-status/`, {
        method: "PATCH",
        headers: { "x-api-key": cfg.apiKey, "content-type": "application/json", "Idempotency-Key": requestId },
        body: JSON.stringify({
          new_status: targetStatus,
          comment: `${reason}\n[DBC review ${auditMarker}]`,
          send_email: false,
          ...(nodesToResubmit ? { nodes_to_resubmit: nodesToResubmit } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      let acknowledged = false;
      if (response?.ok) acknowledged = (await response.json().catch(() => null))?.session_id === sessionId;
      if (!acknowledged) {
        const uncertain = !response || response.ok || response.status === 409 || response.status === 429 || response.status >= 500;
        if (uncertain) {
          const observed = await retrieveExpectedStatus(cfg.apiKey, sessionId, String(bookingId), booking.guestEmail, cfg.workflowId, targetStatus);
          if (observed) session = observed;
          else if (response?.status === 409) throw new Error("The Didit case changed. Refresh before deciding.");
          else if (response?.status === 429 || (response && response.status >= 500)) throw new Error("Didit is temporarily unavailable. Refresh and retry shortly.");
          else throw new Error("Didit may have received this decision, but its current status could not be confirmed. Refresh the case before trying again.");
        } else if (response?.status === 401 || response?.status === 403) {
          throw new Error("Didit rejected the key. Check session-write access and reconcile the case before another decision.");
        } else {
          throw new Error("Didit did not confirm this decision. Reconcile the case before another decision.");
        }
      }

      // Didit remains the source of truth. Re-read before updating the website;
      // this shares the webhook transition, notifications, archive and RM sync.
      session = await retrieveAdminSession(cfg.apiKey, sessionId, String(bookingId), booking.guestEmail);
      if (session.workflow_id !== cfg.workflowId || session.status !== targetStatus)
        throw new Error("Didit has not confirmed this decision yet. Refresh the rental before retrying.");
      const mapped = mapDecision(session.status, session, decision === "resubmit" ? { nodes_to_resubmit: nodesToResubmit } : undefined);
      const expectedStatus = decision === "approve" ? "verified" : decision === "decline" ? "rejected" : "requires_input";
      if (!mapped || mapped.status !== expectedStatus) throw new Error("The Didit decision could not be reconciled.");
      const latest: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
      if (!latest || latest.diditSessionId !== sessionId || !verificationBookingOpen(latest.status))
        throw new Error("The rental changed during review. Check its current rental and Didit status.");
      if (latest.idVerifyStatus !== expectedStatus) {
        const appliedAt = Math.max(Date.now(), (latest.diditEventAt ?? 0) + 1);
        const saved: boolean = await ctx.runMutation(internal.bookings.setDiditResult, {
          bookingId, sessionId, eventId: `manual-review-${requestId}`, eventAt: appliedAt,
          providerStatus: session.status, ...mapped, reconciliation: true, requireApplied: true,
          expectedEventId: latest.diditEventId ?? null,
          expectedEventAt: latest.diditEventAt ?? null,
          expectedManualDecisionAt: latest.diditManualDecisionAt ?? null,
          expectedLateBlockedEventId: latest.verificationLateBlockedEventId ?? null,
          expectedLateBlockedEventAt: latest.verificationLateBlockedEventAt ?? null,
        });
        if (!saved) {
          const current: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
          if (current?.diditSessionId !== sessionId || current.idVerifyStatus !== expectedStatus)
            throw new Error("Didit changed, but the rental could not be synced. Refresh the case before retrying.");
        }
      }
      if (!acknowledged) throw new Error("Didit shows this status, but the decision request itself is unconfirmed. The case remains locked for investigation.");
      const reconciled = await ctx.runMutation(internal.diditReviewClaims.reconcileConfirmed, { bookingId, sessionId, providerStatus: targetStatus, expectedMarker: auditMarker });
      if (!reconciled) throw new Error("Didit confirmed the decision, but the rental could not be reconciled. Refresh the case.");
      return { status: expectedStatus, providerStatus: targetStatus };
    } finally {
      await ctx.runMutation(internal.diditReviewClaims.release, { bookingId, requestId, sessionId });
    }
  },
});

export const adminVerificationLink = action({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }): Promise<{
    url: string;
    issues: Array<{ feature: string; risk: string; summary: string; detail: string }>;
  }> => {
    if (process.env.ADMIN_SESSION_DIDIT_REVIEW_V2 === "enabled")
      await ctx.runMutation(internal.adminAccountSessionV2.authorizeDiditReview, { token });
    else await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "didit.adminVerificationLink" });

    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
    if (!booking || booking.verificationProvider !== "didit" || !booking.diditSessionId ||
        !verificationBookingOpen(booking.status) || booking.idVerifyStatus !== "manual_review")
      throw new Error("Only an open Didit review can be opened here. Refresh the rental first.");

    const cfg = adminConfig();
    const session = await retrieveAdminSession(cfg.apiKey, booking.diditSessionId, String(bookingId), booking.guestEmail);
    if (session.workflow_id !== cfg.workflowId) throw new Error("Verification workflow does not match this rental.");
    if (typeof session.session_url !== "string" || !hostedSessionUrl.test(session.session_url))
      throw new Error("Didit did not return a valid verification link. Open the business console and search the case ID.");

    // Keep the response limited to warnings and the provider's allowlisted URL;
    // never return document, portrait, identity, or match payloads to the browser.
    const cleanText = (value: unknown, max: number) => typeof value === "string"
      ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
      : "";
    const candidates: Array<{ warning: any; feature: string }> = [];
    const addWarnings = (warnings: unknown, feature = "") => {
      if (Array.isArray(warnings)) for (const warning of warnings.slice(0, 20)) candidates.push({ warning, feature });
    };
    addWarnings(session.decision_trace?.status_warnings);
    addWarnings(session.warnings);
    for (const [field, feature] of [["id_verifications", "Photo ID"], ["liveness_checks", "Liveness"], ["face_matches", "Face match"], ["poa_verifications", "Proof of address"]]) {
      const reports = session[field];
      if (Array.isArray(reports)) for (const report of reports.slice(0, 20)) addWarnings(report?.warnings, feature);
    }
    const issues: Array<{ feature: string; risk: string; summary: string; detail: string }> = [];
    const seen = new Set<string>();
    for (const { warning, feature } of candidates) {
      const issue = {
        feature: cleanText(warning?.feature, 48) || feature,
        risk: cleanText(warning?.risk, 64),
        summary: cleanText(warning?.short_description, 180),
        detail: cleanText(warning?.long_description, 480),
      };
      if (!issue.summary && !issue.detail && issue.risk) issue.summary = issue.risk.replace(/_/g, " ");
      const key = JSON.stringify(issue);
      if ((!issue.summary && !issue.detail) || seen.has(key)) continue;
      seen.add(key);
      issues.push(issue);
      if (issues.length === 8) break;
    }

    return { url: session.session_url, issues };
  },
});;

/** Read the current provider decision for an authenticated, visible rental.
 * Browser-supplied results are never accepted. Webhooks remain authoritative,
 * and this closes the progress gap when a callback is delayed or missed. */
export const refreshProgress = action({
  args: { bookingId: v.id("bookings"), accountToken: v.optional(v.string()), checkoutSessionId: v.optional(v.string()), admin: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{status: string}> => {
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
    let authorized = false;
    if (a.admin && a.accountToken) {
      if (process.env.ADMIN_SESSION_DIDIT_REVIEW_V2 === "enabled")
        await ctx.runMutation(internal.adminAccountSessionV2.authorizeDiditReview, { token: a.accountToken });
      else await ctx.runMutation(internal.adminAuth.assertAdminInternal, {token: a.accountToken, fn: "didit.refreshProgress"});
      authorized = true;
    } else if (a.accountToken) {
      const account: any = await ctx.runQuery(internal.accounts._byToken, {token: a.accountToken});
      authorized = !!booking && !!account && belongsToRentalAccount(booking, account);
    }
    // The completed session is an existing bearer capability on the success
    // page; it must be the exact session already bound by Stripe fulfilment.
    if (!authorized && a.checkoutSessionId && booking?.stripeCheckoutSessionId === a.checkoutSessionId && verificationBookingOpen(booking.status)) authorized = true;
    if (!authorized || !booking) throw Error("Sign in to view this rental's verification.");
    try {
      return await refreshBoundProgress(ctx, a.bookingId, booking, a.admin === true);
    } catch (error) {
      const message = a.admin ? diditAdminRecoveryMessage(error) : null;
      if (message) throw new Error(message);
      throw error;
    }
  },
});

export const reconcileReturnedBooking = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }): Promise<{ status: string }> => {
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
    if (!booking || booking.status !== "returned" || booking.verificationProvider !== "didit" || !booking.diditSessionId)
      return { status: "closed" };
    return refreshBoundProgress(ctx, bookingId, booking);
  },
});

export const reconcileLateVerificationOverride = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }): Promise<{ status: string }> => {
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId });
    if (!booking || booking.status !== "pending_verification" || !booking.verificationLateOverrideAt ||
        booking.verificationProvider !== "didit" || !booking.diditSessionId)
      return { status: "closed" };
    return refreshBoundProgress(ctx, bookingId, booking);
  },
});

async function refreshBoundProgress(ctx: any, bookingId: any, booking: any, adminRecovery = false): Promise<{status:string}> {
    if (!diditSessionRefreshAllowed(booking)) return {status: "closed"};
    if (booking.verificationProvider !== "didit" || !booking.diditSessionId) return {status: "not_started"};
    const claimed = await ctx.runMutation(internal.bookings.claimDiditProgressRefresh, {bookingId, sessionId:booking.diditSessionId});
    if (!claimed) return {status: "throttled"};
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
    if (!canClearStaleIdentityAdvisory && !needsConfirmationRepair && (!booking.identityRiskNotice || advisoryCannotChange) && booking.idVerifyStatus === mapped.status && (["identity", "selfie", "address"] as const).every(key => booking.verificationChecks?.[key] === mapped.checks?.[key]) &&
        (booking.verificationNote ?? null) === (mapped.note ?? null) && (booking.documentExpiresAt ?? null) === (mapped.documentExpiresAt ?? null) &&
        (!mapped.personKey || booking.renterPersonKey === mapped.personKey)) {
      if (booking.diditReviewClaim?.outcomeUnknown && !await reconcileReviewAudit(ctx, bookingId, booking, report, cfg.apiKey)) return { status: "decision_uncertain" };
      if (report.status === "Approved" && booking.status === "pending_verification" && booking.idVerifyStatus === "verified") {
        const queued = await ctx.runMutation(internal.bookings.retryPaidDiditConfirmation, { bookingId });
        return {status: queued ? "confirmation_retry_queued" : "unchanged"};
      }
      return {status: "unchanged"};
    }
    const saved = await ctx.runMutation(internal.bookings.setDiditResult, {
      bookingId, sessionId: booking.diditSessionId,
      eventId: `progress-${booking.diditSessionId}-${readStartedAt}`, eventAt: readStartedAt, providerStatus: report.status,
      reconciliation: true, requireApplied: true,
      expectedEventId: booking.diditEventId ?? null, expectedEventAt: booking.diditEventAt ?? null,
      expectedManualDecisionAt: booking.diditManualDecisionAt ?? null,
      expectedLateBlockedEventId: booking.verificationLateBlockedEventId ?? null,
      expectedLateBlockedEventAt: booking.verificationLateBlockedEventAt ?? null, ...mapped,
    });
    if (!saved) {
      const current: any = await ctx.runQuery(internal.bookings.verificationAccess, {bookingId});
      if (current?.diditSessionId === booking.diditSessionId && current.verificationLateBlockedProviderStatus === "Approved" &&
          (current.verificationLateBlockedEventAt ?? 0) >= readStartedAt && !current.verificationLateOverrideAt)
        return {status: "late_approved"};
      return {status: "stale"};
    }
    if (booking.diditReviewClaim?.outcomeUnknown && !await reconcileReviewAudit(ctx, bookingId, booking, report, cfg.apiKey)) return { status: "decision_uncertain" };
    const deadline = verificationDeadlineAt(booking);
    const onTimeApproval = mapped.status === "verified" && deadline !== null &&
      mapped.decisionAt !== undefined && mapped.decisionAt < deadline;
    const lateResult = verificationWindowClosed(booking) && !booking.verificationLateOverrideAt && !onTimeApproval && !mapped.manualApproval;
    return {status: lateResult ? mapped.status === "verified" ? "late_approved" : "late" : "updated"};
    } catch (error) {
      try { await ctx.runMutation(internal.bookings.flagDiditProcessingFailure, {bookingId, sessionId:booking.diditSessionId}); }
      catch { console.error("Didit progress failure alert could not be queued"); }
      const message = adminRecovery ? diditAdminRecoveryMessage(error) : null;
      if (message) throw new Error(message);
      throw error;
    }
}

/** Equal-second webhook events have no provider sequence number. Do not infer
 * order from delivery: re-read the bound session and reconcile its current
 * provider state against the event fence that queued this action. */
export const reconcileAmbiguousWebhook = internalAction({
  args: {
    bookingId: v.id("bookings"),
    sessionId: v.string(),
    webhookEventId: v.string(),
    eventAt: v.number(),
    expectedEventId: v.union(v.string(), v.null()),
    expectedEventAt: v.union(v.number(), v.null()),
    expectedManualDecisionAt: v.union(v.number(), v.null()),
    expectedLateBlockedEventId: v.union(v.string(), v.null()),
    expectedLateBlockedEventAt: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args): Promise<{status: string}> => {
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, {bookingId: args.bookingId});
    if (!booking || booking.verificationProvider !== "didit" || booking.diditSessionId !== args.sessionId ||
        booking.diditEventId !== args.expectedEventId || booking.diditEventAt !== args.expectedEventAt ||
        booking.diditManualDecisionAt !== args.expectedManualDecisionAt ||
        (booking.verificationLateBlockedEventId ?? null) !== args.expectedLateBlockedEventId ||
        (booking.verificationLateBlockedEventAt ?? null) !== args.expectedLateBlockedEventAt || booking.diditEventAt !== args.eventAt)
      return {status: "stale"};
    try {
      const cfg = config();
      const report = await retrieveSession(cfg.apiKey, args.sessionId, String(args.bookingId), booking.guestEmail);
      if (report.workflow_id !== cfg.workflowId) throw new Error("Verification workflow does not match this rental.");
      const mapped = mapDecision(report.status, report);
      if (!mapped) throw new Error("Unknown verification status.");
      const saved = await ctx.runMutation(internal.bookings.setDiditResult, {
        bookingId: args.bookingId,
        sessionId: args.sessionId,
        eventId: `snapshot-${args.sessionId}-${args.webhookEventId}`,
        eventAt: args.eventAt,
        providerStatus: report.status,
        reconciliation: true,
        requireApplied: true,
        expectedEventId: args.expectedEventId,
        expectedEventAt: args.expectedEventAt,
        expectedManualDecisionAt: args.expectedManualDecisionAt,
        expectedLateBlockedEventId: args.expectedLateBlockedEventId,
        expectedLateBlockedEventAt: args.expectedLateBlockedEventAt,
        ...mapped,
      });
      if (!saved) return {status: "stale"};
      return {status: "reconciled"};
    } catch (error) {
      try { await ctx.runMutation(internal.bookings.flagDiditProcessingFailure, {bookingId: args.bookingId, sessionId: args.sessionId}); }
      catch { console.error("Didit ambiguous-webhook reconciliation alert could not be queued"); }
      throw error;
    }
  },
});

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
            requireApplied: true,
            sweepGeneration: generation,
            expectedEventId: candidate.expectedEventId,
            expectedEventAt: candidate.expectedEventAt,
            expectedManualDecisionAt: candidate.expectedManualDecisionAt,
            expectedLateBlockedEventId: candidate.expectedLateBlockedEventId,
            expectedLateBlockedEventAt: candidate.expectedLateBlockedEventAt,
            ...mapped,
          });
          if (!saved) return;
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

function mapDecision(rawStatus: unknown, decision: any, eventResubmitInfo?: any): {
  status: "processing" | "manual_review" | "verified" | "requires_input" | "rejected";
  note?: string;
  poaPostcodes: string[];
  decisionAt?: number;
  documentExpiresAt?: number;
  personKey?: string;
  checks?: ReturnType<typeof verificationChecks>;
  manualApproval?: boolean;
  resubmissionFeatures?: ("identity" | "selfie" | "address")[];
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
  else if (rawStatus === "Kyc Expired") status = "requires_input";
  else if (rawStatus === "Declined") status = "rejected";
  else if (rawStatus === "Not Started" || rawStatus === "In Progress") status = "processing";
  else return null;
  const resubmission = rawStatus === "Resubmitted" ? resubmissionDetails(decision, eventResubmitInfo) : null;
  let note = rawStatus === "Kyc Expired" ? DIDIT_DOCUMENT_EXPIRED
    : rawStatus === "Expired" ? "The verification link expired. Start a new check before handover."
    : rawStatus === "Abandoned" ? "The verification was not completed. Start a new check before handover."
    : rawStatus === "In Review" ? diditReviewReason(decision)
    : status === "requires_input" ? resubmission?.note ?? "Please complete the requested verification step."
    : status === "rejected" ? diditFailureReason(decision) : undefined;
  const expiries = (Array.isArray(decision?.id_verifications) ? decision.id_verifications : [])
    .map((item: any) => /^\d{4}-\d{2}-\d{2}$/.test(item.expiration_date ?? "") ? Date.parse(`${item.expiration_date}T00:00:00Z`) : NaN);
  const documentExpiresAt = expiries.length && expiries.every(Number.isFinite) ? Math.min(...expiries) : undefined;
  const checks = rawStatus === "Resubmitted" ? undefined : verificationChecks(decision);
  // A Didit reviewer can approve a complete session that automation left in
  // review. Preserve the per-check evidence, but carry the provider's explicit
  // human decision through the shared site transition as an override.
  const manualApproval = rawStatus === "Approved" && decision?.decision_trace?.decided_by === "manual" &&
    !!checks && (["identity", "selfie", "address"] as const).every(key =>
      ["approved", "review"].includes(checks[key]));
  // Use provider-attested biographical identity across emails; never store raw DOB or ID numbers.
  const identities = (Array.isArray(decision?.id_verifications) ? decision.id_verifications : [])
    .filter((item: any) => (item.status === "Approved" || manualApproval && item.status === "In Review") &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date_of_birth ?? "") && typeof item.full_name === "string" && item.full_name.trim());
  const keys = identities.map((item: any) => JSON.stringify([item.full_name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "), item.date_of_birth]));
  // This key must remain stable for the lifetime of restricted-account
  // identity records. Keep the invoice secret as a backwards-compatible
  // fallback; provision the dedicated secret with the existing invoice-secret
  // value before enabling it so current person keys continue to match.
  const secret = process.env.RESTRICTED_IDENTITY_HMAC_SECRET || process.env.INVOICE_SECRET;
  const personKey = secret && keys.length && new Set(keys).size === 1 ? createHmac("sha256", secret).update(`dbc-person-v1:${keys[0]}`).digest("hex") : undefined;
  const allChecksApproved = !!checks && (["identity", "selfie", "address"] as const).every(key => checks[key] === "approved");
  if (rawStatus === "Approved" && !allChecksApproved && !manualApproval) {
    status = "manual_review";
    note = "Your verification needs a team review because one or more required checks could not be confirmed.";
  } else if (manualApproval && !allChecksApproved) {
    note = "Didit reviewer manually approved this verification.";
  }
  const decisionAt = typeof decision?.decision_trace?.decided_at === "string"
    ? Date.parse(decision.decision_trace.decided_at)
    : NaN;
  return { status, note, poaPostcodes, checks, ...(manualApproval ? { manualApproval: true } : {}), ...(resubmission?.features.length ? { resubmissionFeatures: resubmission.features } : {}), ...(Number.isSafeInteger(decisionAt) && decisionAt > 0 ? { decisionAt } : {}), ...(personKey ? { personKey } : {}), ...(documentExpiresAt ? { documentExpiresAt } : {}) };
}

/** Didit v3 webhooks sign the complete canonical JSON with X-Signature-V2. */
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
    const webhookSecrets = [cfg.webhookSecret, cfg.previousWebhookSecret].filter((secret): secret is string => !!secret);
    const authenticated = webhookSecrets.some(secret =>
      [signature, previousSignature].some(candidate => validSignature(secret, candidate, signed)) ||
      [rawSignature, previousRawSignature].some(candidate => validSignature(secret, candidate, body)));
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
      let decision = event.decision;
      if (event.status === "Declined" && (!decision?.decision_trace || !["id_verifications", "liveness_checks", "face_matches", "poa_verifications"].some(field => Array.isArray(decision?.[field]) && decision[field].length)) || event.status === "Approved" && !["id_verifications", "liveness_checks", "face_matches", "poa_verifications"].every(field => Array.isArray(decision?.[field]) && decision[field].length)) {
        const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, {bookingId: bookingId as any});
        if (!booking || booking.diditSessionId !== event.session_id || !booking.guestEmail) throw Error("Verification case does not match this rental.");
        const report = await retrieveSession(cfg.apiKey, event.session_id, bookingId, booking.guestEmail);
        if (report.workflow_id !== cfg.workflowId) throw Error("Verification workflow does not match this rental.");
        if (report.status !== event.status) return true;
        decision = report;
      }
      const mapped = mapDecision(event.status, decision, event.resubmit_info);
      if (!mapped) throw Error("Unsupported verification status");
      const applied = await ctx.runMutation(internal.bookings.setDiditResult, {
        bookingId: bookingId as any,
        sessionId: event.session_id,
        eventId: event.event_id,
        eventAt: event.created_at * 1000,
        providerStatus: event.status,
        ...mapped,
      });
      if (!applied) {
        const current: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: bookingId as any });
        const eventAt = event.created_at * 1000;
        const alreadySuperseded = current?.verificationProvider === "didit" && current.diditSessionId === event.session_id &&
          (current.diditEventId === event.event_id || (current.diditEventAt ?? 0) >= eventAt ||
            current.verificationLateBlockedEventId === event.event_id || (current.verificationLateBlockedEventAt ?? 0) >= eventAt ||
            (current.diditManualDecisionAt ?? 0) >= eventAt);
        if (alreadySuperseded) return true;
        return reject("booking_binding", true, {
          bookingId, sessionId:event.session_id, eventId:event.event_id,
          providerStatus:typeof event.status==="string"?event.status:undefined,
        });
      }
      return true;
    } catch {
      try { await ctx.runMutation(internal.bookings.flagDiditProcessingFailure,{bookingId:bookingId as any,sessionId:event.session_id}); }
      catch { console.error("Verified Didit event processing and alert failed"); }
      return "processing_error";
    }
  },
});
