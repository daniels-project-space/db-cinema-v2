export const CHAT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const CHAT_IMAGE_ACCEPT = CHAT_IMAGE_TYPES.join(",");
export const CHAT_ATTACHMENT_TYPES = [...CHAT_IMAGE_TYPES, "text/plain"] as const;
export const CHAT_ATTACHMENT_ACCEPT = `${CHAT_ATTACHMENT_TYPES.join(",")},.jpg,.jpeg,.png,.webp,.txt`;
export const CHAT_ATTACHMENT_LIMIT = 10 * 1024 * 1024;
export const CHAT_TEXT_LIMIT = 1 * 1024 * 1024;
export const CHAT_IMAGE_LIMIT = CHAT_ATTACHMENT_LIMIT;
export const CHAT_IMAGE_HELP = "Choose a JPG, PNG or WebP image up to 10 MB.";
export const CHAT_ATTACHMENT_HELP = "Attach a JPG, PNG, WebP image or TXT file. 10 MB max; TXT up to 1 MB.";

export function isChatImageType(contentType: string): boolean {
  return (CHAT_IMAGE_TYPES as readonly string[]).includes(contentType);
}

export function isChatAttachmentType(contentType: string): boolean {
  return (CHAT_ATTACHMENT_TYPES as readonly string[]).includes(contentType);
}

export function isChatAttachmentNameMatched(name: string, contentType: string): boolean {
  const leaf = name.trim().split(/[\\/]/).pop() ?? "";
  const match = /\.([a-z0-9]+)$/i.exec(leaf);
  if (!match) return false;
  const extension = match[1].toLowerCase();
  if (contentType === "image/jpeg") return extension === "jpg" || extension === "jpeg";
  if (contentType === "image/png") return extension === "png";
  if (contentType === "image/webp") return extension === "webp";
  if (contentType === "text/plain") return extension === "txt";
  return false;
}
