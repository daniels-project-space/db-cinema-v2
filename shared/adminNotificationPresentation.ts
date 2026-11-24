export const ADMIN_NOTIFICATION_CATEGORIES = ["Messages", "Verification", "Bookings & payments", "Email", "Other"] as const;

export function adminNotificationCategory(kind: string): typeof ADMIN_NOTIFICATION_CATEGORIES[number] {
  if (["renter_message", "human_request", "gaffer_resumed", "gaffer_handled"].includes(kind)) return "Messages";
  if (["verification_failure", "verification_update", "verification_archive", "identity_match", "drone_document"].includes(kind)) return "Verification";
  if (["booking_paid", "booking_cancelled", "checkout_failure", "reminder_failure", "deposit_refund_failure", "stripe_dispute", "membership_invoice_review", "membership_checkout_failure"].includes(kind)) return "Bookings & payments";
  if (["email_failure", "email_sent"].includes(kind)) return "Email";
  return "Other";
}

export const ADMIN_PUSH_NOTICES = [
  "message", "team_request", "conversation", "verification_action", "verification_update", "account_match",
  "payment_received", "cancellation_update", "rental_attention", "payment_attention", "refund_attention", "dispute_update",
  "email_attention", "email_update", "team_update",
] as const;
export type AdminPushNotice = typeof ADMIN_PUSH_NOTICES[number];

export function adminPushNotice(notification: { kind: string; title?: string }): AdminPushNotice {
  const { kind, title } = notification;
  if (kind === "renter_message") return "message";
  if (kind === "human_request") return "team_request";
  if (["gaffer_resumed", "gaffer_handled"].includes(kind)) return "conversation";
  if (["verification_failure", "verification_archive"].includes(kind)) return "verification_action";
  if (["verification_update", "drone_document"].includes(kind)) return "verification_update";
  if (kind === "identity_match") return title === "Possible match to a restricted account" ? "account_match" : "verification_action";
  if (kind === "booking_paid") return "payment_received";
  if (kind === "booking_cancelled") return "cancellation_update";
  if (["checkout_failure", "reminder_failure"].includes(kind)) return "rental_attention";
  if (kind === "deposit_refund_failure") return "refund_attention";
  if (kind === "stripe_dispute") return "dispute_update";
  if (["membership_invoice_review", "membership_checkout_failure"].includes(kind)) return "payment_attention";
  if (kind === "email_failure") return "email_attention";
  if (kind === "email_sent") return "email_update";
  return "team_update";
}

/** Lock-screen payloads carry only a safe category; private event text stays in the signed-in admin. */
export function adminPushPresentation(notification: { kind: string; title?: string }) {
  return { notice: adminPushNotice(notification) };
}
