export type ChatNotificationOfferStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function latestAnsweredQuestionReplyId(messages: readonly { _id: unknown; sender: string; text?: string | null }[]) {
  let latestQuestionIndex = -1;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.sender === "renter" && message.text?.trim()) latestQuestionIndex = index;
  }
  if (latestQuestionIndex < 0) return null;
  for (let index = latestQuestionIndex + 1; index < messages.length; index++) {
    const message = messages[index];
    if ((message.sender === "bot" || message.sender === "owner") && message.text?.trim()) return String(message._id);
  }
  return null;
}

export function isChatNotificationOfferReady(replyId: string | null, streamedReplyId: string | null) {
  return !!replyId && replyId === streamedReplyId;
}

export function chatNotificationOfferKey(accountId: string) {
  return `dbc_chat_notification_offer:${accountId}`;
}

function resolveStorage(storage?: ChatNotificationOfferStorage | null) {
  try {
    return storage ?? (typeof window === "undefined" ? null : window.localStorage);
  } catch {
    return null;
  }
}

export function isChatNotificationOfferDismissed(accountId: string, storage?: ChatNotificationOfferStorage | null) {
  try {
    return resolveStorage(storage)?.getItem(chatNotificationOfferKey(accountId)) === "dismissed";
  } catch {
    return false;
  }
}

export function dismissChatNotificationOffer(accountId: string, storage?: ChatNotificationOfferStorage | null) {
  try {
    resolveStorage(storage)?.setItem(chatNotificationOfferKey(accountId), "dismissed");
  } catch {}
}

export function clearChatNotificationOfferDismissal(accountId: string, storage?: ChatNotificationOfferStorage | null) {
  try {
    resolveStorage(storage)?.removeItem(chatNotificationOfferKey(accountId));
  } catch {}
}
