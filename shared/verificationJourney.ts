import { securityReady, verificationExpired } from "./verificationProgress";
import type { VerificationBooking } from "./rentalReadiness";
import { verificationReuseNeedsReview } from "./rentalReadiness";

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
  const paid = ["confirmed", "active", "returned"].includes(booking.status);
  const unexpired = !verificationExpired(booking, now);
  const checksPassed = ["identity", "selfie", "address"].every(
    (key) => booking.verificationChecks?.[key] === "approved",
  );
  const verified =
    booking.idVerifyStatus === "verified" &&
    booking.verificationExpiresAt != null &&
    unexpired &&
    (booking.idVerificationSource === "manual" ||
      !booking.verificationChecks ||
      checksPassed);
  const reviewed = verified && booking.verificationArchiveReady === true;
  const reuseNeedsReview = verificationReuseNeedsReview(booking, now);
  const documents = unexpired && !reuseNeedsReview && (checksPassed || verified);
  const drone =
    !booking.requiresDroneLicence || booking.droneLicenceStatus === "approved";
  const security =
    securityReady(booking) &&
    (!booking.depositHoldAmount ||
      (booking.depositHoldExpiresAt != null &&
        booking.depositHoldExpiresAt > now));
  const ready = !closed && paid && reviewed && drone && security;
  const steps = [
    {
      label: "Payment",
      detail: paid ? "Completed" : "Awaiting payment",
      done: paid,
    },
    {
      label: "Documents",
      detail: reuseNeedsReview ? "Needs team check" : documents ? "Checks complete" : "Verify your identity",
      done: documents,
    },
    {
      label: "Review",
      detail: reviewed
        ? "Approved"
        : reuseNeedsReview
          ? "Team review needed"
          : verified
          ? "Saving documents"
          : "We'll check your details",
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
      label: "Ready for pickup",
      detail: ready
        ? "All set"
        : reviewed && drone
          ? "Card hold required"
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
