"use client";
import { useEffect, useRef, useState } from "react";

export function SmartImage({ src, fallbackSources = [], alt = "", className = "", imgClassName = "", fit = "contain", loading = "lazy" }: {
  src: string | null | undefined; fallbackSources?: readonly string[]; alt?: string; className?: string; imgClassName?: string; fit?: "contain" | "cover"; loading?: "lazy" | "eager";
}) {
  const sources = [...new Set([src, ...fallbackSources].filter((s): s is string => typeof s === "string" && !!s.trim()).map(s => s.trim()))];
  return <ImageSources key={JSON.stringify(sources)} sources={sources} alt={alt} className={className} imgClassName={imgClassName} fit={fit} loading={loading} />;
}
function ImageSources({ sources, alt, className, imgClassName, fit, loading }: { sources: string[]; alt: string; className: string; imgClassName: string; fit: "contain" | "cover"; loading: "lazy" | "eager" }) {
  const ref = useRef<HTMLImageElement>(null);
  const [index, setIndex] = useState(0);
  const [loadedIndex, setLoadedIndex] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const advance = () => setIndex(current => current === index ? current + 1 : current);
  useEffect(() => {
    setHydrated(true);
    const image = ref.current;
    if (!image?.complete) return;
    if (image.naturalWidth > 0) setLoadedIndex(index);
    else setIndex(current => current === index ? current + 1 : current);
  }, [index]);
  const src = sources[index];
  return <div aria-busy={hydrated && !!src && loadedIndex !== index} className={`relative overflow-hidden bg-charcoal-800 ${className}`}>
    {src && loadedIndex !== index && <div aria-hidden="true" className="absolute inset-0 bg-white/[0.035] motion-safe:animate-pulse" />}
    {!src ? <div role="img" aria-label={alt ? `${alt} — photo unavailable` : "Photo unavailable"} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/30">
      <svg aria-hidden="true" viewBox="0 0 32 32" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="7" width="24" height="18" rx="4"/><circle cx="16" cy="16" r="5"/><path d="M10 7l2-3h8l2 3"/></svg>
      <span className="text-[10px]">Photo unavailable</span>
    </div> : (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={src} ref={ref} src={src} alt={alt} loading={loading} decoding="async" data-image-pending={hydrated && loadedIndex !== index ? "true" : undefined} style={{ objectFit: fit }} onLoad={() => setLoadedIndex(index)}
        onError={advance}
        className={`smart-img ${loadedIndex === index ? "loaded" : ""} absolute inset-0 h-full w-full object-cover ${imgClassName}`} />
    )}
  </div>;
}
