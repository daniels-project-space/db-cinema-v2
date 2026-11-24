type RetryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageKey(scope: string, sourceDigest: string, clean: boolean): string {
  return `dbc-chat-upload-v1:${encodeURIComponent(scope)}:${clean ? "clean" : "original"}:${sourceDigest}`;
}

export function attachmentRetryKey(storage: RetryStorage | null, scope: string, sourceDigest: string, clean: boolean, create: () => string): string {
  const key = storageKey(scope, sourceDigest, clean);
  try {
    const saved = storage?.getItem(key);
    if (saved && /^[a-f0-9]{32}$/.test(saved)) return saved;
  } catch {}
  const value = create();
  try { storage?.setItem(key, value); } catch {}
  return value;
}

export function clearAttachmentRetryKey(storage: RetryStorage | null, scope: string, sourceDigest: string, clean: boolean, expected: string): void {
  const key = storageKey(scope, sourceDigest, clean);
  try { if (storage?.getItem(key) === expected) storage.removeItem(key); } catch {}
}
