export const ADMIN_NOTIFICATION_CATEGORIES = ["Messages", "Verification", "Bookings & payments", "Email", "Other"] as const;

export function adminNotificationCategory(kind: string): typeof ADMIN_NOTIFICATION_CATEGORIES[number] {
  if (["renter_message", "human_request", "gaffer_resumed"].includes(kind)) return "Messages";
  if (["verification_failure", "verification_archive", "drone_document"].includes(kind)) return "Verification";
  if (["booking_paid", "booking_cancelled"].includes(kind)) return "Bookings & payments";
  if (["email_failure", "email_sent"].includes(kind)) return "Email";
  return "Other";
}

export function adminPushPresentation(notification: { kind: string; title: string; body: string; bookingId?: string }) {
  const category = adminNotificationCategory(notification.kind);
  const reference = notification.bookingId ? `DBC-${String(notification.bookingId).slice(-8).toUpperCase()} · ` : "";
  return { title: `${category} · ${notification.title}`, body: `${reference}${notification.body}` };
}
