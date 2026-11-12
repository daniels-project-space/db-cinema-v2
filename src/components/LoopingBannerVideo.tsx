"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function LoopingBannerVideo({ src, mobileSrc, poster, mobileAutoplay = false }: { src: string; mobileSrc?: string; poster: string; mobileAutoplay?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const userRequestedPlayback = useRef(false);
  const playbackWatchdog = useRef<number | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);

  const ensureViewportSource = useCallback((video: HTMLVideoElement) => {
    const nextSrc = window.matchMedia("(max-width: 767px)").matches ? mobileSrc ?? src : src;
    if (video.dataset.activeSrc !== nextSrc) {
      video.dataset.activeSrc = nextSrc;
      video.src = nextSrc;
      video.load();
    }
  }, [mobileSrc, src]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const viewport = window.matchMedia("(max-width: 767px)");
    let visible = false;
    let canPlayRetryRegistered = false;
    setMobileViewport(viewport.matches);
    const clearPlaybackWatchdog = () => {
      if (playbackWatchdog.current !== null) {
        window.clearTimeout(playbackWatchdog.current);
        playbackWatchdog.current = null;
      }
    };
    const playbackStarted = () => {
      clearPlaybackWatchdog();
      setPlaybackBlocked(false);
    };
    const playbackFailed = () => {
      clearPlaybackWatchdog();
      setPlaybackBlocked(true);
    };
    const retryAfterCanPlay = () => {
      canPlayRetryRegistered = false;
      if (!visible || document.hidden || !video.paused) return;
      void video.play().then(playbackStarted).catch(playbackFailed);
    };
    const playVisibleVideo = () => {
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("webkit-playsinline", "true");
      video.autoplay = viewport.matches && mobileAutoplay || userRequestedPlayback.current;
      if (!video.paused && !video.ended) {
        playbackStarted();
        return;
      }
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !canPlayRetryRegistered) {
        canPlayRetryRegistered = true;
        video.addEventListener("canplay", retryAfterCanPlay, { once: true });
      }
      clearPlaybackWatchdog();
      playbackWatchdog.current = window.setTimeout(() => {
        playbackWatchdog.current = null;
        if (visible && !document.hidden && video.paused) setPlaybackBlocked(true);
      }, 1400);
      void video.play().then(playbackStarted).catch((error: unknown) => {
        // iOS may abort the first play request while load() switches to the
        // phone-sized source. The canplay retry above starts it once decoded.
        if ((error as { name?: string } | null)?.name === "AbortError" && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        playbackFailed();
      });
    };
    const sync = () => {
      const mobileViewport = viewport.matches;
      if (visible && !document.hidden && (!motion.matches || userRequestedPlayback.current || (mobileViewport && mobileAutoplay))) {
        ensureViewportSource(video);
        playVisibleVideo();
      } else {
        video.pause();
        if (visible && motion.matches && !(mobileViewport && mobileAutoplay)) setPlaybackBlocked(true);
      }
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0.05 });
    const onError = playbackFailed;
    observer.observe(video);
    video.addEventListener("error", onError);
    video.addEventListener("playing", playbackStarted);
    motion.addEventListener("change", sync);
    const onViewportChange = () => {
      setMobileViewport(viewport.matches);
      sync();
    };
    viewport.addEventListener("change", onViewportChange);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      clearPlaybackWatchdog();
      video.removeEventListener("canplay", retryAfterCanPlay);
      video.removeEventListener("error", onError);
      video.removeEventListener("playing", playbackStarted);
      motion.removeEventListener("change", sync);
      viewport.removeEventListener("change", onViewportChange);
      document.removeEventListener("visibilitychange", sync);
      video.pause();
    };
  }, [ensureViewportSource, mobileAutoplay]);

  const playVideo = () => {
    const video = ref.current;
    if (!video) return;
    userRequestedPlayback.current = true;
    ensureViewportSource(video);
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    void video.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
  };

  return (
    <>
      <video ref={ref} className="absolute inset-0 h-full w-full object-cover object-center" poster={poster} autoPlay={mobileAutoplay && mobileViewport} muted loop playsInline preload="none" aria-hidden="true" />
      {playbackBlocked && (
        <button
          type="button"
          data-testid="gear-video-play"
          onClick={playVideo}
          aria-label="Play the gear page film"
          className="absolute right-4 top-4 z-20 inline-flex min-h-10 items-center gap-2 rounded-full border border-white/25 bg-black/55 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-xl transition hover:border-accent-300/60 hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-300"
        >
          <span aria-hidden="true" className="text-accent-300">▶</span>
          Play film
        </button>
      )}
    </>
  );
}
