export const RESEND_DELIVERY_STATUSES = [
  "delivered",
  "delivery_delayed",
  "bounced",
  "suppressed",
  "failed",
  "complained",
] as const;

export type ResendDeliveryStatus = typeof RESEND_DELIVERY_STATUSES[number];

export type EmailRecipientDeliveryStatus = {
  recipient: string;
  status: ResendDeliveryStatus;
  at: number;
  eventId: string;
  reason?: string;
};

const STATUS_PRIORITY: Record<ResendDeliveryStatus, number> = {
  delivery_delayed: 1,
  delivered: 2,
  failed: 3,
  bounced: 4,
  suppressed: 5,
  complained: 6,
};

/**
 * Merge provider outcomes by recipient. Resend may retry webhooks or deliver
 * them out of order; the latest provider timestamp wins, with a stable status
 * priority for events that share a timestamp.
 */
export function mergeEmailRecipientDeliveryStatuses(
  current: readonly EmailRecipientDeliveryStatus[] | undefined,
  incoming: readonly EmailRecipientDeliveryStatus[],
): EmailRecipientDeliveryStatus[] {
  const byRecipient = new Map<string, EmailRecipientDeliveryStatus>();
  for (const item of current ?? []) {
    const recipient = item.recipient.trim().toLowerCase();
    if (recipient) byRecipient.set(recipient, { ...item, recipient });
  }

  for (const item of incoming) {
    const recipient = item.recipient.trim().toLowerCase();
    if (!recipient || !item.eventId) continue;
    const next = { ...item, recipient };
    const previous = byRecipient.get(recipient);
    if (previous?.eventId === next.eventId) continue;
    if (previous && next.at < previous.at) continue;
    if (previous && next.at === previous.at && STATUS_PRIORITY[next.status] <= STATUS_PRIORITY[previous.status]) continue;
    byRecipient.set(recipient, next);
  }

  return [...byRecipient.values()].sort((left, right) => left.recipient.localeCompare(right.recipient));
}

export function emailDeliveryStatusLabel(status: ResendDeliveryStatus): string {
  switch (status) {
    case "delivered": return "Delivered";
    case "delivery_delayed": return "Delayed";
    case "bounced": return "Bounced";
    case "suppressed": return "Suppressed";
    case "failed": return "Failed";
    case "complained": return "Spam complaint";
  }
}
