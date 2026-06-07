"use client";

import { useState } from "react";

/** Image with shimmer placeholder + smooth fade/scale-in on load. */
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
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      className={`relative overflow-hidden bg-charcoal-800 ${!loaded ? "shimmer" : ""} ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`smart-img ${loaded ? "loaded" : ""} absolute inset-0 h-full w-full object-cover ${imgClassName}`}
        />
      ) : null}
    </div>
  );
}
