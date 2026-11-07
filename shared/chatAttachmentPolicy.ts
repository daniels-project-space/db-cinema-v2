export const CHAT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const CHAT_IMAGE_ACCEPT = CHAT_IMAGE_TYPES.join(",");
export const CHAT_IMAGE_LIMIT = 10 * 1024 * 1024;
export const CHAT_IMAGE_HELP = "Choose a JPG, PNG or WebP image up to 10 MB.";

export function isChatImageType(contentType: string): boolean {
  return (CHAT_IMAGE_TYPES as readonly string[]).includes(contentType);
}
