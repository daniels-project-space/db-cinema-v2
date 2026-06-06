"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

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
    <div className="mx-auto max-w-md px-6 py-20 text-center">
      <div className="text-4xl">{verified ? "✅" : pending ? "⏳" : "🪪"}</div>
      <h1 className="mt-4 font-display text-2xl font-bold text-white/90">
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
      <Link href="/account" className="mt-6 inline-block rounded-full bg-accent-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-accent-600">
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
