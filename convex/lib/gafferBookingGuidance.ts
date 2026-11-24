import { bookingVerificationExpired } from "../../shared/verificationProgress";
import { cancellationEligibilityRecovery as cancellationEligibilityRecoveryShared } from "../../shared/gafferCancellationGuidance";
import { gafferVerificationCheckFacts } from "../../shared/gafferVerificationFacts";

type BookingStatus = {status:string;idVerifyStatus?:string|null;idVerificationSource?:string|null;verificationChecks?:Record<string,string>|null;verificationExpiresAt?:number|null;documentExpiresAt?:number|null};

type CancellationEligibilityBooking = {
  stage?:string;
  verification?:{status?:string|null;expired?:boolean;lateApprovalBlocked?:boolean};
  cancellation?:{
    policy?:"full_refund"|"store_credit"|"no_refund"|null;
    termsVersion?:string|null;
    termsText?:string|null;
    timingBasis?:string|null;
    decisionPending?:boolean;
  };
};

export function cancellationEligibilityRecovery(message:string, booking:CancellationEligibilityBooking|null|undefined, accountRentalCount?:number):string|null {
  return cancellationEligibilityRecoveryShared(message, booking, accountRentalCount);
}

export function paymentRecovery(message:string, booking:{stage?:string}|null|undefined):string|null {
  const text=message.toLowerCase();
  if (/\b(human|person|someone|staff|manager|team|operator|representative|refund\w*|cancel\w*|disput\w*|chargeback\w*|damage\w*|fraud\w*|threat\w*|injur\w*|abus\w*|harm\w*|suicid\w*|unsafe|safety|safeguard\w*|emergenc\w*|police|ambulance|fire|999|911|speak (?:to|with)|talk (?:to|with)|call me)\b/.test(text)) return null;
  const duplicate=/\b(?:charged|charge|paid|payment|payments|transaction|transactions)\b.{0,35}\b(?:twice|duplicate|duplicated|two times)\b|\b(?:twice|duplicate|duplicated)\b.{0,35}\b(?:charged|charge|paid|payment|payments|transaction|transactions)\b/.test(text);
  const checkout=/\b(?:charged|charge|paid|payment|bank)\b.{0,65}\b(?:checkout|booking|payment)\b.{0,35}\b(?:failed|error|stuck|not (?:working|confirmed)|didn.t work)\b|\b(?:checkout|booking|payment)\b.{0,35}\b(?:failed|error|stuck|not (?:working|confirmed)|didn.t work)\b.{0,65}\b(?:charged|charge|paid|payment|bank)\b/.test(text);
  if((!duplicate && !checkout) || !booking?.stage)return null;
  const status=booking.stage==="pending_payment"?"The website has not yet confirmed payment for this rental. ":"";
  return `${status}I can't establish here whether a bank charge settled or was duplicated. Please don't pay again if your bank shows a charge. Would you like the team to check securely? Don't post card or bank details in chat.`;
}

export function gafferBookingStatus(booking: BookingStatus): string {
  if (booking.status === "pending_payment") return "Payment has not yet been confirmed; do not assume it failed or ask the renter to pay again if they see a charge.";
  if (booking.status === "confirmed") {
    if (booking.idVerifyStatus !== "verified") return "Payment recorded; identity and address verification is not yet approved for handover.";
    if (bookingVerificationExpired(booking)) return "Payment recorded; the previous verification has expired and needs renewal before handover.";
    if (gafferVerificationCheckFacts(booking.verificationChecks, booking.idVerificationSource)?.incomplete)
      return "Payment recorded; required Didit document checks are not all approved, so the rental is not cleared for handover.";
  }
  return ({confirmed:"confirmed",active:"out now (rental in progress)",returned:"completed and returned",cancelled:"cancelled"} as Record<string,string>)[booking.status] ?? booking.status;
}

export function bookingRecovery(message:string, booking:{stage?:string;verification?:{status?:string|null;expired?:boolean;lateApprovalBlocked?:boolean;source?:string|null;checks?:Record<string,string>|null}}|null|undefined):string|null {
  const text=message.toLowerCase();
  if (!/\b(?:booking|rental|reservation)\b.{0,35}\b(?:confirm(?:ed|ation)?|status)\b|\b(?:confirm(?:ed|ation)?|status)\b.{0,35}\b(?:booking|rental|reservation)\b/.test(text)) return null;
  if (/\b(human|person|someone|staff|manager|team|operator|representative|refund\w*|cancel\w*|disput\w*|chargeback\w*|damage\w*|fraud\w*|threat\w*|injur\w*|abus\w*|harm\w*|suicid\w*|unsafe|safety|safeguard\w*|speak (?:to|with)|talk (?:to|with)|call me)\b/.test(text)) return null;
  if (booking?.stage === "pending_payment") return "The website has not yet confirmed payment for this rental. If your bank shows a charge, please don't pay again. Would you like the team to check? Otherwise, if Retry secure checkout is still visible, you can use it without changing the submitted details.";
  if (booking?.stage === "pending_verification" && booking.verification?.lateApprovalBlocked) return "Didit approved your documents after this rental's verification cutoff, so the rental was not confirmed. The team can check whether this specific rental can still proceed. This does not affect future rentals.";
  if (booking?.stage !== "confirmed" || !booking.verification) return null;
  const checkFacts = gafferVerificationCheckFacts(booking.verification.checks, booking.verification.source);
  if (checkFacts?.incomplete && booking.verification.status === "verified" && !booking.verification.expired)
    return `The overall result is marked approved, but ${checkFacts.summary} This rental is not cleared for handover yet. Please open verification and uploads for this rental.`;
  if (booking.verification.status === "verified" && !booking.verification.expired) return null;
  if (booking.verification.status === "manual_review") return "Your payment is recorded, and your verification is under review. Please wait for the review outcome here; we can't say the rental is ready for collection yet.";
  if (booking.verification.status === "rejected") return "Your payment is recorded, but verification was not approved. Would you like help from the team? Don't send identity documents in chat.";
  return "Your payment is recorded, but verification still needs attention before collection. Please open verification and uploads in this rental and follow the prompts. Don't send identity documents in chat.";
}
