"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { KitPlanner } from "@/components/plans/KitPlanner";
import {RecoveryBasket} from "@/components/plans/RecoveryBasket";
function Planner() {
  const q = useSearchParams();
  const recoveryId=q.get("recovery");
  if(recoveryId)return <RecoveryBasket key={recoveryId} recoveryId={recoveryId}/>;
  return (
    <KitPlanner
      key={q.toString()}
      planId={q.get("plan") ?? undefined}
      bookingId={q.get("booking") ?? undefined}
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
