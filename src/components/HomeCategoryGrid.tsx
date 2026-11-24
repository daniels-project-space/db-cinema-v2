"use client";

import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { IconArrowRight } from "@/components/icons";
import { CategoryIcon } from "@/components/CategoryIcon";
import { selectHomeGearCategory } from "@/lib/homeGearSearchEvents";

type Category = { name: string; count: number };

export function HomeCategoryGrid({ categories }: { categories: Category[] }) {
  return (
    <section className="section-glass px-4 py-12 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="hud-label !text-accent-400/90">The catalogue</div>
          <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
            Every department, <span className="serif-accent gradient-text text-[1.06em]">covered</span>
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/45">
            From cinema camera hire to lens, lighting, audio and drone rental, Db Cinema is London&apos;s
            full-service film equipment hire — delivered across London or collected in central London.
          </p>
        </Reveal>
        <div className="dim-grid mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {categories.map((category, index) => (
            <Reveal key={category.name} delay={Math.min(index, 8) * 50}>
              <button
                type="button"
                data-testid="home-category-select"
                data-category={category.name}
                aria-label={`Show ${category.count} ${category.name.toLowerCase()} listings on this page`}
                onClick={() => selectHomeGearCategory(category.name)}
                className="ci-host spot lift group flex h-full w-full flex-col rounded-2xl p-5 text-left"
              >
                <span className="flex items-start justify-between">
                  <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 transition-all duration-300 group-hover:scale-105 group-hover:bg-accent-500/15 group-hover:accent-glow">
                    <CategoryIcon name={category.name} className="h-9 w-9" />
                  </span>
                  <span className="font-poster text-xl text-white/[0.1] transition-colors group-hover:text-accent-400/25">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </span>
                <span className="mt-5">
                  <span className="block font-display text-lg font-semibold text-white/90 transition-colors group-hover:text-white">
                    {category.name}
                  </span>
                  <span className="mt-1 flex items-center justify-between">
                    <span className="font-mono text-xs text-white/35">{category.count} items</span>
                    <IconArrowRight className="h-4 w-4 text-white/20 transition-all group-hover:translate-x-1 group-hover:text-accent-400" />
                  </span>
                </span>
              </button>
            </Reveal>
          ))}
          <Reveal delay={Math.min(categories.length, 9) * 50}>
            <Link
              href="/gear"
              className="spot lift group flex h-full min-h-[150px] flex-col items-center justify-center gap-3 rounded-2xl border-dashed p-5 text-center"
            >
              <span className="font-display text-lg font-semibold text-white/70 transition-colors group-hover:text-white">
                View everything
              </span>
              <span className="flex items-center gap-1.5 font-mono text-xs text-accent-400">
                {categories.reduce((total, category) => total + category.count, 0)} items
                <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
