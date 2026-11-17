import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { droneDocumentType, DRONE_DOCUMENT_LIMIT } from "./lib/droneDocument";
import { chatAttachmentsReady, chatAttachmentScannerHealthy, scanChatAttachment, CHAT_ATTACHMENT_LIMIT } from "./lib/chatAttachmentScanner";
import { chatAttachmentName } from "./lib/chatAttachmentName";
import { adminSessionMigrationReady } from "./adminAccountSessionV2";
import { CHAT_TEXT_LIMIT, isChatAttachmentNameMatched, isChatAttachmentType, isChatImageType } from "../shared/chatAttachmentPolicy";

const http = httpRouter();

// Rental Manager → storefront marketing tags. The shared secret is the same
// server-to-server credential used for the existing Rental Manager reads.
http.route({
  path: "/dbcinema/manager-marketing-tags",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    const expected = process.env.RMV2_WEBHOOK_SECRET ?? "";
    const supplied = req.headers.get("x-dbcinema-sync-token") ?? "";
    if (!expected || supplied.length !== expected.length || supplied !== expected)
      return new Response("Forbidden", { status: 403, headers });
    if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return new Response("Unsupported media type", { status: 415, headers });

    let body: any;
    try {
      const raw = await req.text();
      if (new TextEncoder().encode(raw).byteLength > 16_384)
        return new Response("Request too large", { status: 413, headers });
      body = JSON.parse(raw);
    } catch { return new Response("Invalid JSON", { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => key !== "protocolVersion" && key !== "changes") ||
        body.protocolVersion !== 1 || !Array.isArray(body.changes) ||
        body.changes.length < 1 || body.changes.length > 50 ||
        body.changes.some((change: any) => !change || typeof change !== "object" || Array.isArray(change) ||
          Object.keys(change).some(key => !["productId", "marketingOnly", "mode", "updatedAt"].includes(key)) ||
          !Number.isSafeInteger(change.productId) || change.productId <= 0 ||
          typeof change.marketingOnly !== "boolean" || !["automatic", "manual"].includes(change.mode) ||
          !Number.isSafeInteger(change.updatedAt) || change.updatedAt < 0) ||
        new Set(body.changes.map((change: any) => change.productId)).size !== body.changes.length)
      return new Response("Invalid marketing tag batch", { status: 400, headers });

    try {
      const receipt = await ctx.runMutation(internal.sync.applyManagerMarketingTags, { changes: body.changes });
      return Response.json(receipt, { headers });
    } catch {
      return new Response("Marketing tag update failed", { status: 500, headers });
    }
  }),
});

function documentCors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowed = new Set([process.env.APP_URL?.replace(/\/$/, ""), "https://dbcinemarentals.com", "https://www.dbcinemarentals.com", "https://db-cinema-v2.vercel.app"]);
  return allowed.has(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Checkout-Session, X-Chat-Filename, X-DBC-Admin-Session", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" } : null;
}
function adminHttpToken(req: Request, scoped: boolean): string {
  const authorization = req.headers.get("authorization") ?? "";
  if (!scoped) return authorization.replace(/^Bearer /, "");
  const token = req.headers.get("x-dbc-admin-session") ?? "";
  if (!/^Bearer [^\s]+$/.test(authorization) || !/^[a-f0-9]{64}$/.test(token)) throw Error("unauthorized");
  return token;
}
http.route({ path: "/admin-session", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req);
  return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/admin-session", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (!adminSessionMigrationReady()) return new Response("Admin session unavailable", { status: 503, headers });
  if (!/^Bearer [^\s]+$/.test(req.headers.get("authorization") ?? "") ||
      !/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? ""))
    return new Response("Unauthorized", { status: 401, headers });
  try {
    if (Number(req.headers.get("content-length")) > 1024) return new Response("Invalid request", { status: 400, headers });
    const reader = req.body?.getReader();
    if (!reader) return new Response("Invalid request", { status: 400, headers });
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 1024) { await reader.cancel(); return new Response("Invalid request", { status: 400, headers }); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 4 ||
        !["clientDigest", "nonce", "mac"].every(key => typeof body[key] === "string" && /^[a-f0-9]{64}$/.test(body[key])) ||
        !Number.isSafeInteger(body.issuedAt)) return new Response("Invalid request", { status: 400, headers });
    const result = await ctx.runAction(internal.adminSessionIssuerV2.issue, { attestation: body });
    if (!result) return new Response("Unauthorized", { status: 401, headers });
    return Response.json(result, { headers });
  } catch { return new Response("Unauthorized", { status: 401, headers }); }
}) });
http.route({ path: "/renter-avatar", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req); return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/renter-avatar", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const { accountId, revision } = await ctx.runMutation(internal.accounts.reserveAvatarUpload, { token });
    const limit = 5 * 1024 * 1024;
    if (Number(req.headers.get("content-length")) > limit) throw Error("Image too large.");
    const reader = req.body?.getReader();
    if (!reader) throw Error("Missing image.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) { await reader.cancel(); throw Error("Image too large."); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const type = droneDocumentType(bytes, req.headers.get("content-type") ?? "");
    if (!type.startsWith("image/")) throw Error("Please choose an image.");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(part => part.toString(16).padStart(2, "0")).join("");
    const parts: ArrayBuffer[] = [];
    for (let start = 0; start < bytes.length; start += 512 * 1024) parts.push(bytes.slice(start, start + 512 * 1024).buffer);
    await ctx.runMutation(internal.accounts.commitAvatarUpload, { token, accountId, revision, contentType: type, digest, chunks: parts });
    return Response.json({ ok: true }, { headers });
  } catch {
    return new Response("Photo could not be uploaded. Choose a JPG, PNG or WebP up to 5 MB.", { status: 403, headers });
  }
}) });
http.route({ path: "/chat-attachment", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req); return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/chat-attachment", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  const url = new URL(req.url);
  const download = url.searchParams.get("download");
  const preview = url.searchParams.get("preview");
  if (download && preview) return new Response("Choose download or preview.", { status: 400, headers });
  if (!download && !preview && !chatAttachmentsReady()) return new Response("Attachments are temporarily unavailable.", { status: 503, headers });
  const admin = url.searchParams.get("admin") === "1";
  let id: any, marker: string | undefined, storageId: any;
  try {
    const scope = { token: adminHttpToken(req, admin && process.env.ADMIN_SESSION_ATTACHMENTS_V2 === "enabled"), admin, bookingId: (url.searchParams.get("bookingId") || undefined) as any, accountId: (url.searchParams.get("accountId") || undefined) as any };
    if (download || preview) {
      const attachmentId = (download || preview) as any;
      const file = await ctx.runMutation(internal.chatAttachments.download, { ...scope, id: attachmentId });
      if (preview && !isChatImageType(file.contentType ?? "")) return new Response("Inline previews support verified JPG, PNG and WebP images only.", { status: 415, headers });
      const stored = await ctx.storage.get(file.storageId);
      if (!stored || stored.size !== file.size) throw Error("File unavailable.");
      const bytes = new Uint8Array(await stored.arrayBuffer());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(part => part.toString(16).padStart(2, "0")).join("");
      if (hash !== file.sha256) throw Error("File unavailable.");
      const current = await ctx.runMutation(internal.chatAttachments.download, { ...scope, id: attachmentId });
      if (current.storageId !== file.storageId || current.messageId !== file.messageId || current.sha256 !== file.sha256 || current.size !== file.size || current.name !== file.name || current.contentType !== file.contentType) throw Error("File unavailable.");
      return new Response(bytes, { headers: { ...headers, "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Type": preview ? file.contentType ?? "application/octet-stream" : "application/octet-stream", "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${file.name}"` } });
    }
    // The browser's availability check is only a convenience. Authenticate the
    // exact upload scope and repeat the scanner self-test at the server edge so
    // a direct POST cannot skip the UI readiness gate.
    await ctx.runQuery(internal.chatAttachments.availabilityAccess, scope);
    if (!await chatAttachmentScannerHealthy()) return new Response("Attachments are temporarily unavailable.", { status: 503, headers });
    const nonce = crypto.randomUUID().replace(/-/g, "");
    marker = `application/vnd.dbcinema.chat-${nonce}`;
    const reservation = await ctx.runMutation(internal.chatAttachments.reserve, { ...scope, marker, requestKey: url.searchParams.get("key") ?? "" });
    if (reservation.status === "pending") return new Response("Upload is processing.", { status: 409, headers });
    if (reservation.status !== "published") id = reservation.id;
    const declared = Number(req.headers.get("content-length"));
    if (declared > CHAT_ATTACHMENT_LIMIT) throw Error("File too large.");
    const reader = req.body?.getReader();
    if (!reader) throw Error("Missing file.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > CHAT_ATTACHMENT_LIMIT) { await reader.cancel(); throw Error("File too large."); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const contentType = req.headers.get("content-type") ?? "";
    const encodedName = req.headers.get("x-chat-filename") ?? "attachment";
    if (encodedName.length > 1080) throw Error("Invalid filename.");
    const name = decodeURIComponent(encodedName);
    if (!isChatAttachmentType(contentType) || !isChatAttachmentNameMatched(name, contentType)) throw Error("Unsupported file type or extension.");
    if (contentType === "text/plain" && size > CHAT_TEXT_LIMIT) throw Error("Text file too large.");
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(part => part.toString(16).padStart(2, "0")).join("");
    if (reservation.status === "published") {
      if (reservation.sha256 !== sha256 || reservation.size !== size || reservation.contentType !== contentType || reservation.name !== chatAttachmentName(name, contentType)) throw Error("Upload retry does not match the original file.");
      return Response.json({ ok: true }, { headers });
    }
    const verdict = await scanChatAttachment(bytes, sha256, nonce, { endpoint: process.env.CHAT_ATTACHMENT_SCANNER_URL ?? "", token: process.env.CHAT_ATTACHMENT_SCANNER_TOKEN ?? "" });
    if (verdict.contentType !== contentType) throw Error("File contents do not match the selected file type.");
    await ctx.runMutation(internal.chatAttachments.recordScan, { id, marker, size, sha256, contentType: verdict.contentType, engine: verdict.engine, signatureVersion: verdict.signatureVersion, signatureUpdatedAt: verdict.signatureUpdatedAt });
    storageId = await ctx.storage.store(new Blob([bytes], { type: marker }));
    const stored = await ctx.storage.get(storageId);
    if (!stored || stored.size !== size) throw Error("File unavailable.");
    const storedHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await stored.arrayBuffer()))).map(part => part.toString(16).padStart(2, "0")).join("");
    if (storedHash !== sha256) throw Error("File unavailable.");
    await ctx.runMutation(internal.chatAttachments.publish, { ...scope, id, marker, storageId, name });
    return Response.json({ ok: true }, { headers });
  } catch {
    if (id && marker) try { await ctx.runMutation(internal.chatAttachments.fail, { id, marker, storageId }); } catch {}
    return new Response("Attachment unavailable.", { status: 403, headers });
  }
}) });
http.route({path:"/renter-drone-document",method:"OPTIONS",handler:httpAction(async(_ctx,req)=>{
  const cors=documentCors(req);return new Response(null,{status:cors?204:403,headers:cors??{}});
})});
http.route({path:"/renter-drone-document",method:"POST",handler:httpAction(async(ctx,req)=>{
  const cors=documentCors(req);if(!cors)return new Response("Forbidden",{status:403});
  const headers={...cors,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
  let storageId;
  try{
    const bookingId=new URL(req.url).searchParams.get("bookingId") as any;
    const token=req.headers.get("authorization")?.replace(/^Bearer /,"")||undefined;
    const checkoutSessionId=req.headers.get("x-checkout-session")||undefined;
    const access={bookingId,token,checkoutSessionId};
    await ctx.runQuery(internal.droneLicences.uploadAccess,access);
    const declared=Number(req.headers.get("content-length"));
    if(declared>DRONE_DOCUMENT_LIMIT)return new Response("Choose a document up to 10 MB.",{status:413,headers});
    const blob=await req.blob(),bytes=new Uint8Array(await blob.arrayBuffer());
    const contentType=droneDocumentType(bytes,req.headers.get("content-type")??"");
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");
    storageId=await ctx.storage.store(new Blob([bytes],{type:contentType}));
    const stored=await ctx.storage.get(storageId);
    if(!stored || stored.size!==bytes.length)throw Error("Uploaded document could not be saved. Please retry.");
    const storedHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await stored.arrayBuffer()))).map(b=>b.toString(16).padStart(2,"0")).join("");
    if(storedHash!==sha256)throw Error("Uploaded document could not be verified. Please retry.");
    const result=await ctx.runMutation(internal.droneLicences.saveUpload,{...access,storageId,sha256,contentType,size:bytes.length});
    storageId=undefined;
    return Response.json(result,{headers});
  }catch{
    if(storageId && await ctx.storage.get(storageId))await ctx.storage.delete(storageId);
    return new Response("Document could not be saved. Check your account and rental, then upload a PDF, JPG, PNG or WebP up to 10 MB.",{status:403,headers});
  }
})});
http.route({ path: "/admin-private-portrait", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req);
  return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/admin-private-portrait", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  try {
    const token = adminHttpToken(req, process.env.ADMIN_SESSION_VERIFICATION_V2 === "enabled");
    const { accountId, documentId } = await req.json();
    const selected = () => ctx.runQuery(api.privateVerificationPortrait.selected, { token, accountId, refresh: Math.floor(Date.now() / 60000) });
    if ((await selected())?.documentId !== documentId) throw Error("Portrait unavailable");
    const document = await ctx.runMutation(internal.verificationArchive.downloadAccess, { token, documentId });
    const blob = await ctx.storage.get(document.storageId);
    if (!blob) throw Error("Portrait unavailable");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (bytes.byteLength !== document.size || digest !== document.sha256 || (await selected())?.documentId !== documentId) throw Error("Portrait unavailable");
    return new Response(bytes, { headers: { ...headers, "Content-Type": document.contentType, "Content-Disposition": "inline; filename=private-portrait" } });
  } catch {
    return new Response("Portrait unavailable", { status: 403, headers });
  }
}) });
http.route({ path: "/admin-verification-document", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req);
  return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/admin-verification-document", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const token = adminHttpToken(req, process.env.ADMIN_SESSION_VERIFICATION_V2 === "enabled");
    const { documentId } = await req.json();
    const document = await ctx.runMutation(internal.verificationArchive.downloadAccess, { token, documentId });
    const blob = await ctx.storage.get(document.storageId);
    if (!blob) return new Response("Document unavailable", { status: 404, headers });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (bytes.byteLength !== document.size || digest !== document.sha256)
      return new Response("Document integrity check failed", { status: 409, headers });
    const extension = document.contentType === "application/pdf" ? "pdf" : document.contentType === "image/png" ? "png" : document.contentType === "image/webp" ? "webp" : "jpg";
    return new Response(bytes, { headers: { ...headers, "Content-Type": document.contentType, "Content-Disposition": `inline; filename="verification-document.${extension}"` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = /unauthorized|administrator token/i.test(message) ? 403
      : /document not found/i.test(message) ? 404
      : /retention period ended/i.test(message) ? 410
      : /saved document is missing or invalid/i.test(message) ? 409
      : 503;
    return new Response(status === 409 ? "Document integrity check failed" : status === 404 ? "Document unavailable" : "Document access is temporarily unavailable", { status, headers });
  }
}) });

// Stripe webhook → server-side booking confirmation (see checkout.stripeWebhook for the
// 2-step activation). Transports the raw body + signature to the node action that verifies
// and confirms. Public URL: https://<deployment>.convex.site/stripe-webhook
http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sig = req.headers.get("stripe-signature") ?? "";
    const body = await req.text();
    const ok: boolean = await ctx.runAction(internal.checkout.stripeWebhook, { body, sig });
    return new Response(ok ? "ok" : "ignored", { status: ok ? 200 : 400 });
  }),
});

http.route({
  path: "/didit-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    const result: boolean | "processing_error" = await ctx.runAction(internal.didit.webhook, {
      body,
      signature: req.headers.get("x-signature-v2") ?? "",
      previousSignature: req.headers.get("x-signature-v2-previous") ?? undefined,
      rawSignature: req.headers.get("x-signature") ?? undefined,
      previousRawSignature: req.headers.get("x-signature-previous") ?? undefined,
      timestamp: req.headers.get("x-timestamp") ?? "",
    });
    return new Response(result === true ? "ok" : result === "processing_error" ? "temporarily unavailable" : "invalid", { status: result === true ? 200 : result === "processing_error" ? 500 : 400 });
  }),
});

// Telegram inbound — Approve/Decline inline-button callbacks for booking change requests.
// Set the bot webhook to https://<deployment>.convex.site/telegram with secret_token = TELEGRAM_WEBHOOK_SECRET.
http.route({
  path: "/telegram",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = req.headers.get("x-telegram-bot-api-secret-token");
    if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    let update: any;
    try {
      update = await req.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const cb = update?.callback_query;
    if (cb?.data && typeof cb.data === "string" && cb.data.startsWith("chg:")) {
      const [, action, requestId] = cb.data.split(":");
      if (requestId && (action === "approve" || action === "decline")) {
        await ctx.runAction(internal.changes.resolveChange, {
          requestId: requestId as any,
          action,
          callbackQueryId: cb.id,
          chatId: cb.message?.chat?.id,
          messageId: cb.message?.message_id,
        });
      }
    }
    // admin REPLY to an escalation message → route into the renter's chat thread
    const msg = update?.message;
    if (msg?.reply_to_message?.message_id && typeof msg.text === "string" && msg.text.trim()) {
      await ctx.runMutation(internal.chat._adminReply, { tgMessageId: msg.reply_to_message.message_id, text: msg.text });
    }
    return new Response("ok");
  }),
});

export default http;
