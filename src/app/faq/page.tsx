import type { Metadata } from "next";
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
        <div className="mb-2 text-xs uppercase tracking-widest text-accent-400">FAQ</div>
        <h1 className="font-display text-4xl font-bold text-white/90">
          Questions, <span className="gradient-text">answered</span>
        </h1>
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
