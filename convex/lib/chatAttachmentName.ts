export function chatAttachmentName(name: string, contentType: string): string {
  const extensions: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const extension = extensions[contentType];
  if (!extension) throw Error("Attachment unavailable.");
  const base = name.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\.[^.]*$/, "").slice(0, 90) || "attachment";
  return `${base}.${extension}`;
}
