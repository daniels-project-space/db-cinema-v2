import { createRoot } from "react-dom/client";
import { HeroCinematic } from "../../src/components/HeroCinematic";
import { HyggloReviewRows, type VerifiedHyggloHighlight } from "../../src/components/HyggloReviewShowcase";

const categories = [
  { name: "Cameras", count: 3 },
  { name: "Lenses", count: 4 },
  { name: "Lighting", count: 2 },
  { name: "Audio", count: 5 },
];

const sampleReview: VerifiedHyggloHighlight = {
  _id: "mobile-fixture-review",
  author: "Jamie",
  authorImage: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
  rating: 5,
  text: "The kit was ready on time and the handover was easy.",
  product: "Sony FX3",
};
const manyReviews: VerifiedHyggloHighlight[] = Array.from({ length: 100 }, (_, index) => ({
  ...sampleReview,
  _id: `mobile-fixture-review-${index + 1}`,
  author: `Renter ${index + 1}`,
  product: index % 2 ? "ARRI Alexa Mini LF" : "Sony FX3",
}));

createRoot(document.getElementById("root")!).render(
  <>
    <section
      data-testid="mobile-landing-hero"
      className="section-window relative isolate min-h-[clamp(28rem,72svh,44rem)] overflow-hidden"
    >
      <HeroCinematic categories={categories} />
    </section>
    <main data-testid="mobile-next-section" className="px-4 py-8">
      <HyggloReviewRows reviews={new URLSearchParams(window.location.search).has("many") ? manyReviews : [sampleReview]} />
    </main>
  </>,
);
