"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="font-display text-2xl font-bold text-white/90">Something went wrong</div>
      <p className="mt-2 max-w-md text-sm text-white/50">
        That one is on us, not you. Try again, and if it keeps happening reach us from the contact page.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="press rounded-full bg-accent-500 px-5 py-2 text-sm font-medium text-white hover:bg-accent-600"
        >
          Try again
        </button>
        <a href="/" className="rounded-full border border-white/15 px-5 py-2 text-sm font-medium text-white/70 hover:text-white">
          Back home
        </a>
        <a href="/contact" className="rounded-full border border-white/15 px-5 py-2 text-sm font-medium text-white/70 hover:text-white">
          Contact us
        </a>
      </div>
    </div>
  );
}
