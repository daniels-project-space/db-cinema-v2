import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { GUIDES, GUIDE_CATEGORIES } from "@/lib/guides";
import { AskGaffer } from "@/components/gaffer/AskGaffer";
import { GuideLibrary } from "@/components/guides/GuideLibrary";

export const metadata: Metadata = {
  title: "Guides — camera & film gear hire tips",
  description: "Practical guides to renting cinema cameras, lenses and lighting in London — plus how-to videos on balancing gimbals, setting up drones, ND filters, audio and lighting.",
  alternates: { canonical: "/guides" },
};

export default function GuidesPage() {
  return <><SiteHeader /><main className="section-window mx-auto max-w-6xl px-6 py-14">
    <PageHero eyebrow="Guides" lead="Shoot" accent="smarter" sub="Straight-talking advice on renting the right gear — and how-to videos for getting the most out of it." />
    <GuideLibrary guides={GUIDES} topics={GUIDE_CATEGORIES} />
    <AskGaffer className="mt-12" title="Stuck on set right now?" blurb="Tell Gaffer which bit of kit you're working with and it'll talk you through the setup step by step." />
  </main></>;
}
