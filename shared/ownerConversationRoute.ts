/** Pushes and owner links use the same scoped conversation address. */
export function ownerConversationUrl({ bookingId, accountId }: { bookingId?: string; accountId?: string }) {
  const query = bookingId ? `?rental=${encodeURIComponent(bookingId)}` : accountId ? `?account=${encodeURIComponent(accountId)}` : "";
  return `/admin${query}#messages`;
}

export function parseOwnerConversationUrl(input: string, origin: string) {
  try {
    const url = new URL(input, origin);
    if (url.origin !== origin || url.pathname !== "/admin") return null;
    const bookingId = url.searchParams.get("rental"), accountId = url.searchParams.get("account");
    if ((bookingId && accountId) || url.searchParams.getAll("rental").length > 1 || url.searchParams.getAll("account").length > 1) return null;
    if ([bookingId, accountId].some(id => id !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) return null;
    return { bookingId, accountId, openMessages: !!bookingId || !!accountId || url.hash === "#messages", href: url.href };
  } catch { return null; }
}
