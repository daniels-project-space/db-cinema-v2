import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";

/** Best-effort client IP from Vercel/proxy headers. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "anon";
}

export type RateResult = { allowed: boolean; retryAfterSec: number };

/** Fixed-window, IP-keyed rate limit backed by Convex. Fails OPEN on any error so a limiter
 *  hiccup never blocks real customers. */
export async function rateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<RateResult> {
  try {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return { allowed: true, retryAfterSec: 0 };
    const c = new ConvexHttpClient(url);
    const r: any = await c.mutation(api.rateLimit.hit, {
      key: `${bucket}:${clientIp(req)}`,
      limit,
      windowMs,
    });
    return { allowed: !!r.allowed, retryAfterSec: Math.ceil((r.retryAfterMs ?? 0) / 1000) };
  } catch {
    return { allowed: true, retryAfterSec: 0 };
  }
}
