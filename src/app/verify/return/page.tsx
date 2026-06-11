"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { IconCheck, IconShield } from "@/components/icons";

function Inner() {
  const params = useSearchParams();
  const bookingId = params.get("booking");
  const refresh = useAction(api.identity.refresh);
  const [status, setStatus] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !bookingId) return;
    ran.current = true;
    refresh({ bookingId: bookingId as any })
      .then((r) => setStatus(r.status))
      .catch(() => setStatus("error"));
  }, [bookingId, refresh]);

  const verified = status === "verified";
  const pending = status === "processing" || status === null;

  return (
    <div className="page-in mx-auto max-w-md px-6 py-20 text-center">
      <div
        className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
          verified
            ? "bg-emerald-500/15 text-emerald-400 shadow-[0_0_36px_-8px_rgba(52,211,153,0.6)]"
            : pending
              ? "bg-accent-500/15 text-accent-400"
              : "bg-amber-500/15 text-amber-400"
        }`}
      >
        {verified ? (
          <IconCheck className="h-7 w-7" />
        ) : pending ? (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent-400/20 border-t-accent-400" />
        ) : (
          <IconShield className="h-7 w-7" />
        )}
      </div>
      <h1 className="mt-5 font-display text-2xl font-bold text-white/90">
        {verified
          ? "Identity verified"
          : pending
            ? "Checking your verification…"
            : "Verification not complete"}
      </h1>
      <p className="mt-2 text-sm text-white/40">
        {verified
          ? "Thanks — your booking is ready for handover."
          : pending
            ? "Stripe is processing your documents. This can take a moment."
            : "You can retry verification from your account."}
      </p>
      <Link href="/account" className="btn-primary mt-6 px-6 py-2.5 text-sm">
        Go to my account
      </Link>
    </div>
  );
}

export default function VerifyReturnPage() {
  return (
    <>
      <SiteHeader />
      <main className="section-window min-h-[60vh]">
        <Suspense fallback={null}>
          <Inner />
        </Suspense>
      </main>
    </>
  );
}
