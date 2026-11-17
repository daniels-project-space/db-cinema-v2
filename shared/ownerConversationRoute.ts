/** Pushes and owner links use the same scoped conversation address. */
export function ownerConversationUrl({ bookingId, accountId, emailThreadId }: { bookingId?: string; accountId?: string; emailThreadId?: string }) {
  const query = emailThreadId ? `?emailThread=${encodeURIComponent(emailThreadId)}` : bookingId ? `?rental=${encodeURIComponent(bookingId)}` : accountId ? `?account=${encodeURIComponent(accountId)}` : "";
  return `/admin${query}#messages`;
}

export function parseOwnerConversationUrl(input: string, origin: string) {
  try {
    const url = new URL(input, origin);
    if (url.origin !== origin || url.pathname !== "/admin") return null;
    const bookingId = url.searchParams.get("rental"), accountId = url.searchParams.get("account"), emailThreadId = url.searchParams.get("emailThread");
    if ([bookingId, accountId, emailThreadId].filter(Boolean).length > 1 || ["rental", "account", "emailThread"].some(key => url.searchParams.getAll(key).length > 1)) return null;
    if ([bookingId, accountId, emailThreadId].some(id => id !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) return null;
    return { bookingId, accountId, emailThreadId, openMessages: !!bookingId || !!accountId || !!emailThreadId || url.hash === "#messages", href: url.href };
  } catch { return null; }
}
