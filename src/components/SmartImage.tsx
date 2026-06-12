"use client";

import { useEffect, useRef, useState } from "react";

/** Image with placeholder + smooth fade/scale-in on load.
 * Hydration-safe: if the image already finished loading before React
 * attached onLoad (SSR pages — the browser races hydration), the mount
 * effect catches it via img.complete so tiles never stay invisible. */
export function SmartImage({
  src,
  alt = "",
  className = "",
  imgClassName = "",
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  imgClassName?: string;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true);
  }, [src]);

  return (
    <div
      className={`relative overflow-hidden bg-charcoal-800 ${!loaded ? "shimmer" : ""} ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={ref}
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          className={`smart-img ${loaded ? "loaded" : ""} absolute inset-0 h-full w-full object-cover ${imgClassName}`}
        />
      ) : null}
    </div>
  );
}
