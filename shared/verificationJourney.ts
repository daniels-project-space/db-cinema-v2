import { securityReady } from "./verificationProgress";
import type { VerificationBooking } from "./rentalReadiness";

/** Display real provider decisions; payment alone never means pickup approval. */
export function verificationJourney(booking: VerificationBooking & { cancellationPending?: boolean; returnPending?: boolean }, now = Date.now()) {
  const closed = ["cancelled", "returned"].includes(booking.status) || !!booking.cancellationPending || !!booking.returnPending;
  const paid = ["confirmed", "active", "returned"].includes(booking.status);
  const unexpired = (booking.verificationExpiresAt == null || booking.verificationExpiresAt > now) && (booking.documentExpiresAt == null || booking.documentExpiresAt > now);
  const checksPassed = ["identity", "selfie", "address"].every(key => booking.verificationChecks?.[key] === "approved");
  const verified = booking.idVerifyStatus === "verified" && unexpired && (booking.idVerificationSource === "manual" || !booking.verificationChecks || checksPassed);
  const reviewed = verified && booking.verificationArchiveReady === true;
  const documents = checksPassed || verified;
  const drone = !booking.requiresDroneLicence || booking.droneLicenceStatus === "approved";
  const security = securityReady(booking) && (!booking.depositHoldAmount || (booking.depositHoldExpiresAt != null && booking.depositHoldExpiresAt > now));
  const ready = !closed && paid && reviewed && drone && security;
  const steps = [{ label: "Payment", detail: paid ? "Completed" : "Awaiting payment", done: paid },
    { label: "Documents", detail: documents ? "Checks complete" : "Verify your identity", done: documents },
    { label: "Review", detail: reviewed ? "Approved" : verified ? "Saving documents" : "We'll check your details", done: reviewed },
    ...(booking.requiresDroneLicence ? [{ label: "Drone licence", detail: drone ? "Approved" : "Upload and review", done: drone }] : []),
    { label: "Ready for pickup", detail: ready ? "All set" : reviewed && drone ? "Card hold required" : "Awaiting checks", done: ready }];
  return { steps, current: closed ? -1 : steps.findIndex(step => !step.done), paid, reviewed, documents, ready, closed };
}
