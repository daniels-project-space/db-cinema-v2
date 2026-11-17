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
    return <>
      <GearDetailClient slug={listing.slug} initialListing={listing as any} />
      {/* Mirror the global Gaffer's mobile positioning contract so this browser
          fixture catches collisions with the real product booking dock. */}
      <button
        type="button"
        aria-label="Contact us — chat with Gaffer"
        data-testid="fixture-gaffer-launcher"
        className="launcher fixed bottom-3 right-3 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-charcoal-900"
      >G</button>
      <div
        data-testid="fixture-gaffer-panel"
        className="chat-panel fixed bottom-[72px] right-3 z-50 flex h-auto max-h-[min(68dvh,560px)] w-[calc(100vw-24px)] max-w-sm flex-col overflow-hidden rounded-2xl border border-white/10 bg-charcoal-900"
        hidden
        style={{ display: "none" }}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2.5">
          <strong className="text-sm text-white">GAFFER · Online</strong>
          <button aria-label="Close Gaffer chat" className="h-9 w-9 rounded-full">×</button>
        </header>
        <div className="relative z-10 max-h-[calc(68dvh-12rem)] min-h-0 flex-none space-y-3 overflow-y-auto p-3">
          <p className="rounded-xl bg-white/[0.06] p-3 text-sm text-white/80">I can check this listing and help with dates. What would you like to know?</p>
          <button className="min-h-11 rounded-full border border-white/10 px-3 text-xs">Check availability</button>
        </div>
        <div className="flex shrink-0 gap-2 border-t border-white/10 p-3">
          <input data-testid="fixture-gaffer-input" aria-label="Message Gaffer" placeholder="Ask about gear or dates…" className="input min-w-0 flex-1 rounded-full" />
          <button data-testid="fixture-gaffer-send" aria-label="Send message" className="h-10 w-10 shrink-0 rounded-full">➤</button>
        </div>
      </div>
    </>;
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <GearCard listing={listing as any} mobileCompact priorityImage />
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
if (window.location.pathname === "/how-it-works") {
  // This page is an async server component in Next. Resolve it before mounting
  // the resulting tree in the browser fixture, where React client roots cannot
  // render the component's Promise directly.
  void HowItWorksPage().then(page => root.render(page));
} else {
  root.render(<Fixture />);
}
