export const DRONE_DOCUMENT_LIMIT = 10 * 1024 * 1024;

/** Match the actual bytes; a supplied MIME header is insufficient. */
export function droneDocumentType(bytes: Uint8Array, supplied: string) {
  if (!bytes.length || bytes.length > DRONE_DOCUMENT_LIMIT) throw Error("Choose a document up to 10 MB.");
  const starts = (...prefix: number[]) => prefix.every((v, i) => bytes[i] === v);
  const type = starts(0x25,0x50,0x44,0x46,0x2d) ? "application/pdf" :
    starts(0xff,0xd8,0xff) ? "image/jpeg" :
    starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a) ? "image/png" :
    starts(0x52,0x49,0x46,0x46) && bytes[8]===0x57 && bytes[9]===0x45 && bytes[10]===0x42 && bytes[11]===0x50 ? "image/webp" : null;
  if (!type || type !== supplied) throw Error("Upload a PDF, JPG, PNG or WebP document.");
  return type;
}
