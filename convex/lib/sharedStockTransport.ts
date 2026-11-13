type Item = { itemId: string; start: number; returnAt: number; quantity: number };
export type StockRequest =
  | { operation: "acquire"; args: { requestId: string; bookingId?: string; items: Item[] } }
  | { operation: "acquireZero"; args: { requestId:string; bookingId:string; oldItems:Item[]; newItems:Item[] } }
  | { operation: "acquirePaidBooking"; args: { requestId:string; bookingId:string; bookingRevision:number; verificationState:"pending"; paymentEvidence:{status:"succeeded";paymentIntentId:string;paidAt:number}|{status:"no_payment_required";checkoutSessionId:string;paidAt:number}; items:Item[] } }
  | { operation: "releaseBooking"; args: { bookingId:string; bookingRevision:number; eventId:string; reason:"booking_cancelled"|"verification_declined"|"verification_expired"|"booking_returned" } }
  | { operation: "beginExecution"; args: { id: string; fingerprint: string; executionKey: string } }
  | { operation: "checkExecution"; args: { id: string; fingerprint: string; executionKey: string } }
  | { operation: "checkConversion"; args: { id: string; fingerprint: string; executionKey: string; receipt: Record<string, unknown> } }
  | { operation: "releaseCompensated"; args: { id: string; fingerprint: string; executionKey: string; evidence: { swapId:string; bookingId:string; bookingRevision:number; paymentIntentId:string; refundId:string; refundStatus:"succeeded"; amountPence:number; refundAttemptedAt:number; windows:Array<{itemId:string;start:number;end:number;quantity:number}> } } }
  | { operation: "checkCompensatedRelease"; args: { id: string; fingerprint: string; executionKey: string; evidence: { swapId:string; bookingId:string; bookingRevision:number; paymentIntentId:string; refundId:string; refundStatus:"succeeded"; amountPence:number; refundAttemptedAt:number; windows:Array<{itemId:string;start:number;end:number;quantity:number}> } } }
  | { operation: "releasePrepared"; args: { id: string; fingerprint: string; reason: "withdrawn_before_execution" | "renter_declined_before_execution" | "abandoned_before_execution" } };

export type StockTransportResult = { status: "offline" | "unknown" | "capacity_conflict" } | { status: "confirmed"; result: Record<string, unknown> };
const MAX_RESPONSE = 16384;

function endpoint(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.convex\.site$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== "/dbcinema/booking-sync" || url.search || url.hash) throw Error("Invalid Rental Manager endpoint.");
  return `${url.origin}/dbcinema/shared-stock`;
}

export function sharedStockTransportConfigured(managerUrl?: string, secret?: string): boolean {
  if (!managerUrl || !secret || secret.length < 32) return false;
  try { endpoint(managerUrl); return true; } catch { return false; }
}

async function boundedText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE)) throw Error("Invalid stock response.");
  if (!response.body) throw Error("Missing stock response.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE) { await reader.cancel(); throw Error("Invalid stock response."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function validReceipt(request: StockRequest, receipt: any): boolean {
  if (request.operation === "acquirePaidBooking") {
    const outcome = receipt?.outcome;
    const expectedExecutionKey = `booking_execution_${request.args.bookingId}`;
    const keys = ["bookingId", "fingerprint", "holdsStock", "ok", "operation", "outcome", "replayed", "requestId", "version", ...(receipt?.executionKey === undefined ? [] : ["executionKey"])].sort().join(",");
    const executionStarted = outcome === "execution_started" && receipt.holdsStock === true && receipt.executionKey === expectedExecutionKey;
    const converted = outcome === "converted" && receipt.holdsStock === false && (receipt.executionKey === undefined || receipt.executionKey === expectedExecutionKey);
    return receipt?.version === 1 && receipt?.ok === true && Object.keys(receipt).sort().join(",") === keys &&
      receipt.operation === request.operation && receipt.bookingId === request.args.bookingId &&
      receipt.requestId === request.args.requestId && typeof receipt.fingerprint === "string" && receipt.fingerprint.length > 0 &&
      (executionStarted || converted) && typeof receipt.replayed === "boolean";
  }
  if (request.operation === "releaseBooking") return receipt?.version === 1 && Object.keys(receipt).sort().join(",") === "bookingId,idempotent,ok,operation,outcome,releasedClaims,version" && receipt.ok === true && receipt.operation === request.operation && receipt.bookingId === request.args.bookingId && receipt.outcome === "released" && Number.isSafeInteger(receipt.releasedClaims) && receipt.releasedClaims >= 0 && typeof receipt.idempotent === "boolean";
  if (!receipt || receipt.version !== 1 || receipt.operation !== request.operation || !receipt.request || receipt.request.source !== "website" || !receipt.result || typeof receipt.result !== "object" || typeof receipt.result.replayed !== "boolean") return false;
  const actual = receipt.request;
  if (request.operation === "acquire") {
    const expectedKeys = request.args.bookingId === undefined ? "items,requestId,source" : "bookingId,items,requestId,source";
    if (Object.keys(actual).sort().join(",") !== expectedKeys || actual.requestId !== request.args.requestId || actual.bookingId !== request.args.bookingId || !Array.isArray(actual.items) || actual.items.length !== request.args.items.length || !actual.items.every((line: any, index: number) => {
      const expected = request.args.items[index];
      return line && Object.keys(line).sort().join(",") === "itemId,quantity,returnAt,start" && line.itemId === expected.itemId && line.start === expected.start && line.returnAt === expected.returnAt && line.quantity === expected.quantity;
    })) return false;
  } else if(request.operation === "acquireZero") {
    const same=(actualItems:any,expected:Item[])=>Array.isArray(actualItems)&&actualItems.length===expected.length&&actualItems.every((line:any,index:number)=>line&&Object.keys(line).sort().join(",")==="itemId,quantity,returnAt,start"&&line.itemId===expected[index].itemId&&line.start===expected[index].start&&line.returnAt===expected[index].returnAt&&line.quantity===expected[index].quantity);
    if(Object.keys(actual).sort().join(",")!=="bookingId,newItems,oldItems,requestId,source"||actual.requestId!==request.args.requestId||actual.bookingId!==request.args.bookingId||!same(actual.oldItems,request.args.oldItems)||!same(actual.newItems,request.args.newItems))return false;
  } else {
    const expected = request.args;
    const keys = request.operation === "releasePrepared" ? ["fingerprint", "id", "reason", "source"] : request.operation === "checkConversion" ? ["executionKey", "fingerprint", "id", "receipt", "source"] : request.operation === "releaseCompensated" || request.operation === "checkCompensatedRelease" ? ["evidence", "executionKey", "fingerprint", "id", "source"] : ["executionKey", "fingerprint", "id", "source"];
    if (Object.keys(actual).sort().join(",") !== keys.join(",") || actual.id !== expected.id || actual.fingerprint !== expected.fingerprint || (request.operation === "releasePrepared" ? actual.reason !== request.args.reason : actual.executionKey !== request.args.executionKey)) return false;
    if(request.operation === "checkConversion") {
      const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
      if(JSON.stringify(canonical(actual.receipt))!==JSON.stringify(canonical(request.args.receipt)))return false;
    }
    if(request.operation === "releaseCompensated" || request.operation === "checkCompensatedRelease") {
      const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
      if(JSON.stringify(canonical(actual.evidence))!==JSON.stringify(canonical(request.args.evidence)))return false;
    }
  }
  const result = receipt.result;
  if(request.operation === "checkCompensatedRelease")return result.state === "compensated_released";
  if(request.operation === "checkConversion" && typeof result.stockRisk !== "boolean")return false;
  if(request.operation === "acquireZero") {
    const normalize=(items:Item[])=>items.map(line=>[line.itemId,line.start,line.returnAt,line.quantity]);
    const fingerprint=JSON.stringify(["zero-capacity-v1",request.args.bookingId,normalize(request.args.oldItems),normalize(request.args.newItems)]);
    const claimReady=result.state==="prepared"||result.state==="execution_started";
    const alreadyConverted=result.state==="converted"&&typeof result.stockRisk==="boolean";
    return typeof result.requestId==="string"&&result.requestId.length>0&&result.requestId.length<256&&result.fingerprint===fingerprint&&(claimReady||alreadyConverted);
  }
  if (request.operation === "acquire") {
    const lines = request.args.items.map(line => ({ ...line, end: line.returnAt + 3600000 })).sort((left, right) => left.itemId.localeCompare(right.itemId) || left.start - right.start || left.end - right.end || left.quantity - right.quantity);
    const fingerprint = JSON.stringify(lines.map(line => [line.itemId, line.start, line.end, line.quantity]));
    const claimReady=result.state==="prepared"||result.state==="execution_started";
    const alreadyConverted=result.state==="converted"&&typeof result.stockRisk==="boolean";
    return typeof result.requestId === "string" && result.requestId.length > 0 && result.requestId.length < 256 && result.fingerprint === fingerprint && (claimReady||alreadyConverted);
  }
  return result.state === (request.operation === "releasePrepared" ? "released" : request.operation === "releaseCompensated" ? "compensated_released" : request.operation === "checkConversion" ? "converted" : "execution_started");
}

export async function sendSharedStockRequest(request: StockRequest, config: { enabled: boolean; managerUrl?: string; secret?: string; fetcher?: typeof fetch; timeoutMs?: number }): Promise<StockTransportResult> {
  if (!config.enabled || !config.managerUrl || !config.secret || config.secret.length < 32) return { status: "offline" };
  let url: string;
  try { url = endpoint(config.managerUrl); } catch { return { status: "offline" }; }
  const body = JSON.stringify({ version: 1, ...request });
  if (new TextEncoder().encode(body).length > MAX_RESPONSE) return { status: "offline" };
  try {
    const response = await (config.fetcher ?? fetch)(url, { method: "POST", redirect: "error", headers: { "content-type": "application/json", "x-shared-stock-token": config.secret }, body, signal: AbortSignal.timeout(config.timeoutMs ?? 15000) });
    if (!response.ok) {
      if (response.status !== 409) return { status: "unknown" };
      try {
        const rejection = JSON.parse(await boundedText(response));
        if (request.operation === "acquirePaidBooking" && rejection && Object.keys(rejection).sort().join(",") === "error,ok" && rejection.ok === false && rejection.error === "capacity_conflict") return { status: "capacity_conflict" };
        if (rejection && Object.keys(rejection).sort().join(",") === "error,operation,version" &&
          rejection.version === 1 && rejection.operation === request.operation && rejection.error === "capacity_conflict" &&
          ["acquire", "acquirePaidBooking", "beginExecution", "checkExecution"].includes(request.operation)) {
          return { status: "capacity_conflict" };
        }
      } catch {}
      return { status: "unknown" };
    }
    const receipt = JSON.parse(await boundedText(response));
    if (!validReceipt(request, receipt)) return { status: "unknown" };
    // Paid-claim and terminal-release endpoints use a compact top-level
    // response envelope; legacy swap operations return their result nested.
    return { status: "confirmed", result: request.operation === "acquirePaidBooking" || request.operation === "releaseBooking" ? receipt : receipt.result };
  } catch { return { status: "unknown" }; }
}
