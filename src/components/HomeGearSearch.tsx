"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SmartImage } from "@/components/SmartImage";
import { IconArrowRight, IconSearch } from "@/components/icons";
import type { GearListing } from "@/components/GearCard";
import { money } from "@/lib/pricing";

type Category = { name: string; count: number };

const categoryHints: { pattern: RegExp; category: RegExp }[] = [
  { pattern: /\b(camera|cameras|camcorder|body|bodies|red|arri|sony|canon|fx3|fx6|fx9|venice|komodo|v-raptor|blackmagic)\b/i, category: /camera|cinema|video/i },
  { pattern: /\b(lens|lenses|prime|zoom|anamorphic|glass|optics)\b/i, category: /lens|optic/i },
  { pattern: /\b(light|lights|lighting|led|tube|softbox)\b/i, category: /light/i },
  { pattern: /\b(audio|sound|mic|mics|microphone|microphones|lav)\b/i, category: /audio|sound/i },
  { pattern: /\b(drone|drones|uav)\b/i, category: /drone/i },
  { pattern: /\b(grip|tripod|stand|support|rig)\b/i, category: /grip|support/i },
  { pattern: /\b(monitor|viewfinder|display)\b/i, category: /monitor|video/i },
  { pattern: /\b(battery|batteries|charger|media|card)\b/i, category: /accessor|power|media/i },
];

function inferCategory(query: string, categories: Category[]) {
  const normalized = query.toLowerCase();
  const direct = categories.find((item) => {
    const name = item.name.toLowerCase();
    return normalized.includes(name) || name.split(/[^a-z0-9]+/).some((word) =>
      word.length > 2 && new RegExp("\\b" + word + "\\b", "i").test(normalized),
    );
  });
  if (direct) return direct.name;

  const hint = categoryHints.find((item) => item.pattern.test(normalized));
  return hint ? categories.find((item) => hint.category.test(item.name))?.name : undefined;
}

export function HomeGearSearch({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [settledValue, setSettledValue] = useState("");
  const query = value.trim();
  const settledQuery = settledValue.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledValue(query), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const category = useMemo(() => inferCategory(settledQuery, categories), [settledQuery, categories]);
  const searchResult = useQuery(
    api.catalog.searchHomeGear,
    settledQuery.length >= 2 ? { search: settledQuery, category } : "skip",
  );

  function browseSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query) return;
    const target = category
      ? "/gear?cat=" + encodeURIComponent(category)
      : "/gear?q=" + encodeURIComponent(query);
    router.push(target);
    setFocused(false);
  }

  const listings = (searchResult?.listings ?? []) as GearListing[];
  const categoryCount = categories.find((item) => item.name === category)?.count;

  return (
    <div className="relative w-full max-w-[34rem]">
      <form
        onSubmit={browseSearch}
        className="home-search-shell flex h-14 items-center gap-3 rounded-full border border-white/20 bg-[#0b0b0e]/95 p-1.5 pl-5 shadow-[0_16px_50px_-22px_rgba(0,0,0,.9)]"
      >
        <IconSearch className="h-5 w-5 shrink-0 text-accent-300" aria-hidden />
        <input
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setFocused(false);
          }}
          placeholder="Search any item"
          aria-label="Search rental gear"
          aria-expanded={focused}
          aria-controls="home-gear-search-results"
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/45"
        />
        <button
          type="submit"
          className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-accent-300/50 bg-accent-500 px-5 text-sm font-semibold text-white shadow-[0_5px_18px_-6px_rgba(214,32,41,.7)] transition-colors hover:bg-accent-400"
        >
          Search <IconArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </form>

      {focused && (
        <div
          id="home-gear-search-results"
          className="absolute right-0 top-full z-40 mt-3 w-full overflow-hidden rounded-2xl border border-white/12 bg-[#0b0b0e]/98 p-3 shadow-[0_24px_70px_-24px_rgba(0,0,0,.95)]"
          role="region"
          aria-label="Gear search suggestions"
        >
          {query.length < 2 ? (
            <div>
              <p className="px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">Browse by category</p>
              <div className="flex flex-wrap gap-2">
                {categories.slice(0, 6).map((item) => (
                  <Link
                    key={item.name}
                    href={"/gear?cat=" + encodeURIComponent(item.name)}
                    onClick={() => setFocused(false)}
                    className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-2 text-xs text-white/75 transition-colors hover:border-accent-300/40 hover:bg-white/10 hover:text-white"
                  >
                    {item.name} <span className="ml-1 text-white/35">{item.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : query !== settledQuery || searchResult === undefined ? (
            <p className="px-2 py-3 text-sm text-white/55" aria-live="polite">Finding the best matches in the live catalogue…</p>
          ) : listings.length ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3 px-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-300">
                  {searchResult.mode === "category"
                    ? "No exact hit · top picks in " + searchResult.category
                    : "Best matches" + (searchResult.category ? " · " + searchResult.category : "")}
                </p>
                {category && categoryCount ? (
                  <Link
                    href={"/gear?cat=" + encodeURIComponent(category)}
                    onClick={() => setFocused(false)}
                    className="shrink-0 text-[11px] text-white/50 transition-colors hover:text-white"
                  >
                    All {category} ({categoryCount})
                  </Link>
                ) : null}
              </div>
              <div className="max-h-[55vh] overflow-y-auto">
                {listings.map((listing) => (
                  <Link
                    key={listing._id}
                    href={"/gear/" + listing.slug}
                    onClick={() => setFocused(false)}
                    className="group flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-white/[0.07]"
                  >
                    <span className="relative h-14 w-16 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                      {listing.heroImage ? (
                        <SmartImage
                          fit="contain"
                          src={listing.heroImage}
                          fallbackSources={listing.imageSources}
                          alt={listing.title}
                          className="h-full w-full"
                        />
                      ) : (
                        <span className="flex h-full items-center justify-center text-accent-300"><IconSearch className="h-5 w-5" /></span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white/90 group-hover:text-white">{listing.title}</span>
                      <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">
                        {listing.category} <span className="mx-1.5 text-white/20">·</span> {money(listing.pricing.daily)}/day
                      </span>
                    </span>
                    <IconArrowRight className="h-4 w-4 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:text-accent-300" aria-hidden />
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-2 py-2">
              <p className="text-sm text-white/65">No exact match for “{settledQuery}”. Try one of these categories:</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(category ? categories.filter((item) => item.name !== category) : categories).slice(0, 5).map((item) => (
                  <Link
                    key={item.name}
                    href={"/gear?cat=" + encodeURIComponent(item.name)}
                    onClick={() => setFocused(false)}
                    className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-2 text-xs text-white/75 transition-colors hover:border-accent-300/40 hover:bg-white/10 hover:text-white"
                  >
                    {item.name} <span className="ml-1 text-white/35">{item.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
