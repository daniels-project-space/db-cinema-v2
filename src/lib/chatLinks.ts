import { BUSINESS_CONTACT_EMAIL } from "../../shared/businessEmail";

const FIRST_PARTY_ORIGIN = "https://dbcinemarentals.com";
const STRIPE_CHECKOUT_SESSION_PATH = /^\/c\/pay\/cs_(?:live|test)_[A-Za-z0-9_-]+$/;

export function removeRedundantBusinessEmailLines(text: string, businessEmail: string): string {
  if (!text.toLowerCase().includes(`mailto:${businessEmail.toLowerCase()}`)) return text;
  const escapedEmail = businessEmail.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  const emailLine = new RegExp(`^\\s*(?:(?:contact\\s+)?email\\s*:\\s*)?${escapedEmail}[.,]?\\s*$`, "i");
  return text.split("\n").filter((line) => !emailLine.test(line)).join("\n");
}

export function approvedChatLink(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
      const url = new URL(value, FIRST_PARTY_ORIGIN);
      return url.origin === FIRST_PARTY_ORIGIN ? url : null;
    }

    const url = new URL(value);
    if (url.protocol === "mailto:") {
      if (url.username || url.password || url.hostname || url.port || url.hash) return null;
      let recipient = "";
      try { recipient = decodeURIComponent(url.pathname).trim().toLowerCase(); } catch { return null; }
      if (recipient !== BUSINESS_CONTACT_EMAIL) return null;
      const queryKeys = [...url.searchParams.keys()];
      const subject = url.searchParams.get("subject");
      if (queryKeys.some(key => key !== "subject") || (subject != null && (subject.length > 120 || /[\r\n]/.test(subject)))) return null;
      return url;
    }
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;

    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const firstParty = host === "dbcinemarentals.com" || host === "www.dbcinemarentals.com";
    const didit = host === "verify.didit.me" || host === "verification.didit.me";
    const maps = host === "maps.google.com" || host === "www.google.com" && /^\/maps(?:\/|$)/.test(url.pathname);
    if (firstParty || didit || maps) return url;
    if (host === "checkout.stripe.com") return STRIPE_CHECKOUT_SESSION_PATH.test(url.pathname) ? url : null;
    return null;
  } catch {
    return null;
  }
}

export function resolveRentalChatLink(
  rawUrl: string,
  suppliedLabel?: string,
  options: { allowAdminNavigation?: boolean } = {},
) {
  const isBusinessEmail = rawUrl.trim().toLowerCase() === BUSINESS_CONTACT_EMAIL.toLowerCase();
  const url = isBusinessEmail ? new URL(`mailto:${BUSINESS_CONTACT_EMAIL}`) : approvedChatLink(rawUrl);
  if (!url) return null;

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = url.pathname.replace(/\/$/, "");
  const isFirstParty = hostname === "dbcinemarentals.com";
  const isEmail = url.protocol === "mailto:";
  if (isFirstParty && /^\/api(?:\/|$)/i.test(pathname)) return null;
  if (isFirstParty && /^\/admin(?:\/|$)/i.test(pathname) && !options.allowAdminNavigation) return null;

  const label = suppliedLabel?.trim().slice(0, 72) || (isEmail
    ? "Email the team"
    : isFirstParty && pathname === "/contact"
      ? "Open contact form"
      : hostname === "checkout.stripe.com"
        ? "Open secure payment"
        : hostname === "verify.didit.me" || hostname === "verification.didit.me"
          ? "Continue verification"
          : hostname === "maps.google.com" || pathname.startsWith("/maps")
            ? "Open map"
            : "Open DB Cinema link");
  const openInNewTab = !isEmail && !isFirstParty;

  return {
    href: url.toString(),
    label,
    kind: isEmail ? "email" as const : "action" as const,
    ariaLabel: isEmail || !openInNewTab ? label : `${label.startsWith("Open ") ? label : `Open ${label}`} in a new tab`,
    subject: isEmail ? url.searchParams.get("subject") ?? undefined : undefined,
    openInNewTab,
  };
}

export function approvedStripeCheckoutUrl(value: unknown): string | null {
  const url = approvedChatLink(value);
  if (!url || url.protocol !== "https:" || url.hostname.toLowerCase().replace(/\.$/, "") !== "checkout.stripe.com" || !STRIPE_CHECKOUT_SESSION_PATH.test(url.pathname)) return null;
  return url.toString();
}

export function approvedCheckoutCartPath(value: unknown): string | null {
  return typeof value === "string" && /^\/cart\/quote\/[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function approvedGearListingPath(slug: unknown): string | null {
  return typeof slug === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(slug)
    ? `/gear/${encodeURIComponent(slug)}`
    : null;
}
