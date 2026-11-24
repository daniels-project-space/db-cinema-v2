import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { LEGAL_ARCHIVE, LEGAL_DOCS } from "../../../../shared/legalDocuments";

export default async function ReferralTerms({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  const version = (await searchParams).version ?? "2026-11-referrals-v3";
  const doc = version === "2026-10-referrals-v2" ? LEGAL_DOCS.referrals : LEGAL_ARCHIVE[version]?.referrals;
  if (!doc) notFound();
  return <><SiteHeader/><main className="mx-auto max-w-3xl px-6 py-16"><Link href="/account" className="text-sm text-accent-300">← Your account</Link><h1 className="mt-6 font-display text-4xl text-white">{doc.title}</h1><p className="mt-3 text-xs text-white/40">Referral terms · {version} · effective on acceptance</p><div className="mt-10 space-y-8">{doc.sections.map(({h,p})=><section key={h}><h2 className="text-lg text-white">{h}</h2><p className="mt-2 text-sm leading-7 text-white/60">{p}</p></section>)}</div></main></>;
}
