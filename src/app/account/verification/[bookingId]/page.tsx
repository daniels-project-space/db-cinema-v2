"use client";
import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { VerificationProgress } from "@/components/rentals/VerificationProgress";
function Inner() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const params = useSearchParams();
  return <VerificationProgress bookingId={bookingId} checkoutSessionId={params.get("session_id")} />;
}
export default function VerificationPage() {
  return <><SiteHeader /><main className="section-window mx-auto min-h-[70vh] max-w-3xl px-5 pb-12 pt-32"><Suspense fallback={<p>Loading…</p>}><Inner /></Suspense></main></>;
}
