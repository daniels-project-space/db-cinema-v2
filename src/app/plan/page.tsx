"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { KitPlanner } from "@/components/plans/KitPlanner";
function Planner() {
  const q = useSearchParams();
  return (
    <KitPlanner
      key={q.toString()}
      planId={q.get("plan") ?? undefined}
      bookingId={q.get("booking") ?? undefined}
      recoveryId={q.get("recovery") ?? undefined}
    />
  );
}
export default function Page() {
  return (
    <Suspense
      fallback={<p className="p-12 text-white/45">Loading your kit…</p>}
    >
      <Planner />
    </Suspense>
  );
}
