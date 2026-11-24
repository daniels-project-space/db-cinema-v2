import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { NativeReviewModeration } from "@/components/admin/NativeReviewModeration";

export default function AdminReviewsPage() {
  return <>
    <SiteHeader />
    <main className="mx-auto min-h-[70vh] w-full max-w-4xl px-4 pb-16 pt-8 sm:px-6">
      <Link href="/admin" className="text-xs text-white/50 transition-colors hover:text-white/80">← Admin</Link>
      <NativeReviewModeration />
    </main>
  </>;
}
