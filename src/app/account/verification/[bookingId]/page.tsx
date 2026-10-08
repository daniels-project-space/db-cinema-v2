"use client";
import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { VerificationProgress } from "@/components/rentals/VerificationProgress";
function Inner() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const params = useSearchParams();
  return <VerificationProgress bookingId={bookingId} checkoutSessionId={params.get("session_id")} presentation="page" />;
}
export default function VerificationPage() {
  return <Suspense fallback={<p role="status" className="p-8 text-white/60">Loading verification…</p>}><Inner /></Suspense>;
}
