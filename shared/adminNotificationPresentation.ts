export const ADMIN_NOTIFICATION_CATEGORIES = ["Messages", "Verification", "Bookings & payments", "Email", "Other"] as const;

export function adminNotificationCategory(kind: string): typeof ADMIN_NOTIFICATION_CATEGORIES[number] {
  if (["renter_message", "human_request", "gaffer_resumed"].includes(kind)) return "Messages";
  if (["verification_failure", "verification_update", "verification_archive", "identity_match", "drone_document"].includes(kind)) return "Verification";
  if (["booking_paid", "booking_cancelled", "checkout_failure", "deposit_refund_failure", "stripe_dispute"].includes(kind)) return "Bookings & payments";
  if (["email_failure", "email_sent"].includes(kind)) return "Email";
  return "Other";
}

export function adminPushPresentation(notification: { kind: string; title: string; body: string; bookingId?: string }) {
  const category = adminNotificationCategory(notification.kind);
  const reference = notification.bookingId ? `DBC-${String(notification.bookingId).slice(-8).toUpperCase()} · ` : "";
  const body = notification.kind === "verification_update" ? "Didit approved verification. Document archiving may still be in progress."
    : notification.kind !== "verification_failure" ? notification.body
    : notification.title === "Verification needs review" ? "Check the provider status and required checks. Open the rental for details."
      : notification.title === "Booking identity or allocation notice" ? "A booking needs an identity or stock check. Open the rental for details."
        : notification.title === "Didit verification not approved" ? "Didit did not approve verification. Open the rental for details."
          : notification.title === "Didit resubmission reported" ? "Didit reports a resubmission; verification is not complete."
            : notification.title === "Didit verification incomplete" ? "Didit reports that verification is not complete. Open the rental for details."
              : notification.title === "Verification could not open" ? "A renter could not open verification. Open the rental to help."
                : notification.title === "Verification update needs attention" ? "A verification update could not be processed. Open the rental to review."
                  : notification.title === "Didit webhook rejected" ? "A Didit update was rejected. Check the webhook configuration and logs."
        : "Verification needs attention. Open the admin panel for details.";
  return { title: `${category} · ${notification.title}`, body: `${reference}${body}` };
}
