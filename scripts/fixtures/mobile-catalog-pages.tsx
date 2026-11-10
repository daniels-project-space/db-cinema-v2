import React from "react";
import { createRoot } from "react-dom/client";
import { GearCard } from "../../src/components/GearCard";
import GearDetailClient from "../../src/app/gear/[slug]/GearDetailClient";
import HowItWorksPage from "../../src/app/how-it-works/page";

const listing = {
  _id: "synthetic-arri-alexa-mini-lf",
  slug: "arri-alexa-mini-lf",
  title: "ARRI Alexa Mini LF cinema camera with production accessories",
  category: "Cameras",
  itemType: "camera",
  isPackage: false,
  heroImage: "/arri-deconstruct-poster.jpg",
  imageSources: ["/images/home/maintained-cinema-gear-20261028.webp"],
  gallery: ["/arri-deconstruct-poster.jpg", "/images/home/maintained-cinema-gear-20261028.webp"],
  description: "Professional cinema camera for hire in London.",
  pricing: { daily: 240, day3: 210, day7: 180 },
  depositAmount: 100,
  minimumRentalDays: 1,
  quietDeal: null,
  displayOnly: false,
  bookable: true,
  unavailableDates: [],
  demandScore: 65,
  knowledge: {
    features: ["Large-format 4.5K sensor", "Production-ready camera body"],
    bestFor: ["narrative", "commercial"],
    tips: ["Bring compatible media and power."],
    limits: [],
  },
};

function Fixture() {
  if (window.location.pathname === "/detail") {
    return <GearDetailClient slug={listing.slug} initialListing={listing as any} />;
  }
  if (window.location.pathname === "/how-it-works") return <HowItWorksPage />;
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <GearCard listing={listing as any} mobileCompact priorityImage />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
