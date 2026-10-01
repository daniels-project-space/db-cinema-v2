"use client";
import { useEffect, useRef, useState } from "react";

export function SmartImage({ src, fallbackSources = [], alt = "", className = "", imgClassName = "" }: {
  src: string | null | undefined; fallbackSources?: readonly string[]; alt?: string; className?: string; imgClassName?: string;
}) {
  const sources = [...new Set([src, ...fallbackSources].filter((s): s is string => !!s))];
  return <ImageSources key={JSON.stringify(sources)} sources={sources} alt={alt} className={className} imgClassName={imgClassName} />;
}
function ImageSources({ sources, alt, className, imgClassName }: { sources: string[]; alt: string; className: string; imgClassName: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const image = ref.current;
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, [index]);
  const src = sources[index];
  return <div className={`relative overflow-hidden bg-charcoal-800 ${className}`}>
    {!src ? <div role="img" aria-label={alt ? `${alt} — photo unavailable` : "Photo unavailable"} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/30">
      <svg aria-hidden="true" viewBox="0 0 32 32" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="7" width="24" height="18" rx="4"/><circle cx="16" cy="16" r="5"/><path d="M10 7l2-3h8l2 3"/></svg>
      <span className="text-[10px]">Photo unavailable</span>
    </div> : (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={src} ref={ref} src={src} alt={alt} loading="lazy" onLoad={() => setLoaded(true)}
        onError={() => { setLoaded(false); setIndex((current) => current + 1); }}
        className={`smart-img ${loaded ? "loaded" : ""} absolute inset-0 h-full w-full object-cover ${imgClassName}`} />
    )}
  </div>;
}
