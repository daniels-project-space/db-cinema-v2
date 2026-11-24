/** Single customer-facing and monitored DB Cinema mailbox. */
export const BUSINESS_CONTACT_EMAIL = "dbcinemarentals@gmail.com";

/** Only a sender from the verified DB Cinema domain may send customer mail. */
export function isBusinessSender(value: string | null | undefined): boolean {
  const raw = String(value ?? "").trim();
  const address = raw.match(/<([^>]+)>/)?.[1]?.trim() ?? raw;
  return /^[^@\s]+@dbcinemarentals\.com$/i.test(address);
}
