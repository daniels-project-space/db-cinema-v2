export function verificationReadSnapshot(documents: { storageId: string; sha256: string; size: number; contentType: string }[]) {
  return JSON.stringify(documents.map(document => [document.storageId, document.sha256, document.size, document.contentType]));
}
