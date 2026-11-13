import React from "react";
import { createRoot } from "react-dom/client";
import { HomeStats } from "@/components/HomeStats";

function Fixture() {
  return (
    <main id="reviews" className="mx-auto max-w-4xl px-4 pt-[120vh] pb-16">
      <h1 className="font-poster text-3xl text-white">Reviews</h1>
      <HomeStats ratingValue={4.73} reviewCount={1300} itemCount={175} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
