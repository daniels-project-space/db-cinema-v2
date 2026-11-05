import { securityReady, verificationExpired, verificationValidUntil } from "./verificationProgress";
import type { VerificationBooking } from "./rentalReadiness";
import {isSavedCardRental} from './savedCardSecurity';

export function verificationLinkLabel(booking: VerificationBooking, reviewed: boolean): string {
  if (booking.idVerifyStatus === "verified" && booking.requiresDroneLicence && booking.droneLicenceStatus !== "approved") {
    if (booking.droneLicenceStatus === "review") return "Drone licence review · view progress";
    if (booking.droneLicenceStatus === "requires_input") return "Replace drone licence · view progress";
    return "Upload drone licence · view progress";
  }
  if (reviewed) return "View approved verification";
  if (booking.idVerifyStatus === "requires_input") return "Replace documents · view progress";
  if (booking.idVerifyStatus === "manual_review") return "Verification needs review · view progress";
  if (booking.idVerifyStatus === "rejected") return "Verification needs attention · view progress";
  if (!booking.idVerifyStatus || booking.idVerifyStatus === "required") return "Open verification and uploads";
  return "View verification progress";
}

/** Display real provider decisions; payment alone never means pickup approval. */
export function verificationJourney(
  booking: VerificationBooking & {
    cancellationPending?: boolean;
    returnPending?: boolean;
  },
  now = Date.now(),
) {
  const closed =
    ["cancelled", "returned"].includes(booking.status) ||
    !!booking.cancellationPending ||
    !!booking.returnPending;
  const paid = ["pending_verification", "confirmed", "active", "returned"].includes(booking.status);
  const unexpired = !verificationExpired(booking, now);
  const checksPassed = ["identity", "selfie", "address"].every(
    (key) => booking.verificationChecks?.[key] === "approved",
  );
  const verifiedUntil = verificationValidUntil(booking);
  const verified =
    booking.idVerifyStatus === "verified" &&
    verifiedUntil != null &&
    unexpired &&
    (booking.idVerificationSource === "manual" ||
      !booking.verificationChecks ||
      checksPassed);
  const reviewed = verified && booking.verificationArchiveReady === true;
  const documents = unexpired && !["requires_input", "rejected"].includes(booking.idVerifyStatus ?? "") && (checksPassed || verified);
  const drone =
    !booking.requiresDroneLicence || booking.droneLicenceStatus === "approved";
  const security =
    securityReady(booking) &&
    (!booking.depositHoldAmount ||
      (booking.depositHoldExpiresAt != null &&
        booking.depositHoldExpiresAt > now));
  const ready = !closed && booking.status !== "pending_verification" && paid && reviewed && drone && security;
  const steps = [
    {
      label: "Payment",
      detail: paid ? "Completed" : "Awaiting payment",
      done: paid,
    },
    {
      label: "Documents",
      detail: documents ? "Checks complete" : booking.idVerifyStatus === "processing" ? "Verification in progress" : "Verify your identity",
      done: documents,
    },
    {
      label: "Review",
      detail: reviewed
        ? "Approved"
        : verified
          ? "Document storage unconfirmed"
          : booking.idVerifyStatus === "processing"
            ? "Verification in progress"
            : booking.idVerifyStatus === "manual_review"
              ? "Review needed"
              : booking.idVerifyStatus === "requires_input"
                ? "Replacement needed"
                : booking.idVerifyStatus === "rejected"
                  ? "Needs attention"
                  : "Awaiting checks",
      done: reviewed,
    },
    ...(booking.requiresDroneLicence
      ? [
          {
            label: "Drone licence",
            detail: drone ? "Approved" : "Upload and review",
            done: drone,
          },
        ]
      : []),
    {
      label: booking.fulfilment === "delivery" ? "Ready for delivery" : "Ready for pickup",
      detail: ready
        ? "All set"
        : booking.status === "pending_verification"
          ? "Booking confirmation pending"
        : reviewed && drone
          ? isSavedCardRental(booking) ? "Complete saved-card setup" : "Card hold required"
          : "Awaiting checks",
      done: ready,
    },
  ];
  return {
    steps,
    current: closed ? -1 : steps.findIndex((step) => !step.done),
    paid,
    reviewed,
    documents,
    ready,
    closed,
  };
}
