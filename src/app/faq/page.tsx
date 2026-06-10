import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FAQS } from "@/lib/guides";

export const metadata: Metadata = {
  title: "FAQ — camera & film gear hire in London",
  description:
    "Answers on renting cinema cameras and lighting in London: delivery, deposits, insurance, rates, opening hours and booking changes.",
  alternates: { canonical: "/faq" },
};

export default function FAQPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader />
      <main className="section-window mx-auto max-w-2xl px-6 py-14">
        <PageHero eyebrow="FAQ" lead="Questions," accent="answered" sub="Renting, delivery, deposits and dates, all explained in plain English." />
        <div className="mt-8 divide-y divide-white/5">
          {FAQS.map((f) => (
            <div key={f.q} className="py-5">
              <h2 className="font-display font-semibold text-white/85">{f.q}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{f.a}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center text-sm text-white/40">
          Still stuck?{" "}
          <Link href="/account" className="text-accent-400 hover:underline">Message us in your account</Link>.
        </div>
      </main>
    </>
  );
}
