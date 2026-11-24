"use client";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { legalVersionForPolicy } from "../../../shared/legalVersioning";
import { COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS } from "@/lib/legal";
export const CHECKOUT_PAUSED_MESSAGE = "Checkout is temporarily paused while we improve the booking experience. Your basket is saved; please check back soon.";
export function useCheckoutStatus() {
  const config = useQuery(api.settings.get, {});
  const version = config ? legalVersionForPolicy(config) : null;
  const cancellationProtection = !!config && !!version && (
    config.cancellationProtectionEnabled === true ||
    (COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS as readonly string[]).includes(version)
  );
  return {
    enabled: config?.checkoutEnabled === true,
    loading: config === undefined,
    cancellationProtection,
    cancellationPolicyVersion: version,
  };
}
export function CheckoutPauseNotice({ loading = false }: { loading?: boolean }) {
  return <p data-testid="checkout-paused-notice" role="status" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm leading-relaxed text-amber-100/85">{loading ? "Checking checkout availability…" : CHECKOUT_PAUSED_MESSAGE}</p>;
}

export function CancellationProtectionSummary({
  enabled,
  version,
  testId = "cancellation-protection-summary",
}: {
  enabled: boolean;
  version?: string | null;
  testId?: string;
}) {
  if (!enabled) return null;
  return <p data-testid={testId} className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-300/15 bg-sky-300/[.045] px-3 py-2 text-xs">
    <span className="text-white/70">Cancellation protection <strong className="ml-1 font-semibold text-sky-200">Free</strong></span>
    <Link href={`/legal/cancellation${version ? `?version=${encodeURIComponent(version)}` : ""}`} className="font-medium text-sky-300 underline decoration-sky-300/50 underline-offset-4 hover:text-sky-200">View terms</Link>
  </p>;
}
