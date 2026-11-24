import React from "react";
import { createRoot } from "react-dom/client";
import { HyggloReviewRows, HyggloTrustTile, type VerifiedHyggloHighlight } from "../../src/components/HyggloReviewShowcase";
import { HomeStats } from "../../src/components/HomeStats";
import { ReviewCarousel } from "../../src/components/ReviewCarousel";

const hyggloReviews: VerifiedHyggloHighlight[] = Array.from({ length: 100 }, (_, index) => ({
  _id: `home-fixture-${index}`,
  author: `Renter ${index + 1}`,
  authorImage: `/broken-review-photo.jpg?source=featured&index=${index}&view=${encodeURIComponent(new URLSearchParams(window.location.search).get("view") ?? "default")}`,
  rating: 5,
  text: index === 0 ? "A carefully prepared kit, a lovely handover and a team that made our shoot simple. ".repeat(5) : `A clear, helpful rental experience for review fixture ${index + 1}.`,
  product: index % 2 === 0 ? "Sony FX3" : "24–70mm lens",
}));

const nativeReviews = Array.from({ length: 8 }, (_, index) => ({
  _id: `native-fixture-${index}`,
  source: "native",
  author: `Crew member ${index + 1}`,
  authorImage: index === 0 ? `/broken-review-photo.jpg?source=native&view=${encodeURIComponent(new URLSearchParams(window.location.search).get("view") ?? "default")}` : "",
  rating: 5,
  text: `A useful, realistic review of the booking and gear. Entry ${index + 1}.`,
  incentivized: false,
  product: "Sony FX3",
}));

(window as typeof window & { __nativeReviews?: typeof nativeReviews }).__nativeReviews = nativeReviews;

createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-7xl space-y-10 px-4 py-6 sm:px-6">
    <section data-testid="fixture-featured" className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
      <article className="trust-card h-[148px] rounded-2xl border border-white/10 bg-[#101013] p-4 text-white min-[420px]:h-[188px] sm:h-[304px]">London rental kit</article>
      <HyggloTrustTile reviews={hyggloReviews} />
      <article className="trust-card h-[148px] rounded-2xl border border-white/10 bg-[#101013] p-4 text-white min-[420px]:h-[188px] sm:h-[304px]">Delivery protection</article>
      <article className="trust-card h-[148px] rounded-2xl border border-white/10 bg-[#101013] p-4 text-white min-[420px]:h-[188px] sm:h-[304px]">Professional support</article>
    </section>
    <section id="reviews" data-testid="fixture-reviews" className="section-glass space-y-8 rounded-3xl px-4 py-8 sm:px-8">
      <div className="text-center"><p className="hud-label text-accent-400">What crews say</p><h1 className="mt-2 font-display text-3xl font-bold text-white">Loved by London filmmakers</h1></div>
      <HyggloReviewRows reviews={hyggloReviews} />
      <ReviewCarousel />
      <HomeStats ratingValue={4.73} reviewCount={1300} itemCount={175} />
    </section>
    <section data-testid="empty-review-fallback" className="mx-auto max-w-sm">
      <HyggloTrustTile reviews={[]} />
    </section>
  </main>,
);
