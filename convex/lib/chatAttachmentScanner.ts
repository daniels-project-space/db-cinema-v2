import { CHAT_ATTACHMENT_LIMIT as SHARED_CHAT_ATTACHMENT_LIMIT, isChatAttachmentType } from "../../shared/chatAttachmentPolicy";

export const CHAT_ATTACHMENT_LIMIT = SHARED_CHAT_ATTACHMENT_LIMIT;

type ScannerOptions = { endpoint: string; token: string; fetcher?: typeof fetch; now?: number; timeoutMs?: number };

function scannerConfiguration() {
  const endpoint = process.env.CHAT_ATTACHMENT_SCANNER_URL ?? "";
  const token = process.env.CHAT_ATTACHMENT_SCANNER_TOKEN ?? "";
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/scan" || token.length < 32) return null;
    return { endpoint, token };
  } catch {
    return null;
  }
}

export function chatAttachmentsReady(): boolean {
  return process.env.CHAT_ATTACHMENTS_RELEASE_ENABLED === "enabled" && scannerConfiguration() !== null;
}

async function readScannerJson(response: Response) {
  if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Error("Scanner unavailable.");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Invalid scanner response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 4096) { await reader.cancel(); throw Error("Invalid scanner response."); }
    chunks.push(part.value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(output));
}

export async function chatAttachmentScannerHealthy(options?: ScannerOptions): Promise<boolean> {
  const config: ScannerOptions | null = options ?? scannerConfiguration();
  if (!config) return false;
  try {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/scan" || !config.token || config.token.length < 32) return false;
    endpoint.pathname = "/health";
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 5000);
    try {
      const response = await (config.fetcher ?? fetch)(endpoint, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${config.token}`, "X-Scan-Nonce": nonce },
      });
      const result = await readScannerJson(response);
      const now = options?.now ?? Date.now();
      return result.nonce === nonce && result.ready === true && /^ClamAV [0-9][0-9.]+$/.test(result.engine) &&
        typeof result.signatureVersion === "string" && /^\d+$/.test(result.signatureVersion) &&
        Number.isSafeInteger(result.signatureUpdatedAt) && result.signatureUpdatedAt <= now &&
        result.signatureUpdatedAt >= now - 48 * 60 * 60 * 1000;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export async function scanChatAttachment(bytes: Uint8Array, digest: string, nonce: string, options: ScannerOptions) {
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/scan" || !options.token || options.token.length < 32 || !/^[a-f0-9]{64}$/.test(digest) || !/^[a-f0-9]{32}$/.test(nonce) || !bytes.length || bytes.length > CHAT_ATTACHMENT_LIMIT) throw Error("Scanner configuration unavailable.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/octet-stream", "X-Content-SHA256": digest, "X-Scan-Nonce": nonce },
      body: bytes as unknown as BodyInit,
    });
    if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Error("Scanner unavailable.");
    const reader = response.body?.getReader();
    if (!reader) throw Error("Invalid scanner response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 4096) { await reader.cancel(); throw Error("Invalid scanner response."); }
      chunks.push(part.value);
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    const verdict = JSON.parse(new TextDecoder().decode(output));
    const now = options.now ?? Date.now();
    if (verdict.nonce !== nonce || verdict.sha256 !== digest || verdict.size !== bytes.length || !isChatAttachmentType(verdict.contentType) || verdict.verdict !== "clean" || verdict.complete !== true || verdict.encrypted !== false || verdict.truncated !== false || verdict.limitExceeded !== false || typeof verdict.engine !== "string" || !/^ClamAV [0-9][0-9.]+$/.test(verdict.engine) || typeof verdict.signatureVersion !== "string" || !/^\d+$/.test(verdict.signatureVersion) || !Number.isSafeInteger(verdict.signatureUpdatedAt) || verdict.signatureUpdatedAt > now || verdict.signatureUpdatedAt < now - 48 * 60 * 60 * 1000) throw Error("Scanner did not return a complete current clean verdict.");
    return { contentType: verdict.contentType, engine: verdict.engine.slice(0, 120), signatureVersion: verdict.signatureVersion.slice(0, 120), signatureUpdatedAt: verdict.signatureUpdatedAt };
  } finally {
    clearTimeout(timeout);
  }
}
