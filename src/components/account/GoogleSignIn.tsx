"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "./AccountProvider";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/** "Continue with Google" — Google Identity Services button. Renders only when a client id is
 *  configured, so the email/password form degrades gracefully before Google OAuth is wired up. */
export function GoogleSignIn({
  onError,
  onDone,
}: {
  onError?: (m: string) => void;
  onDone?: () => void;
}) {
  const { signInWithGoogle } = useAccount();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!CLIENT_ID || !ref.current) return;
    let cancelled = false;

    const init = () => {
      const g = (window as any).google;
      if (!g?.accounts?.id || !ref.current || cancelled) return;
      g.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: async (resp: any) => {
          try {
            await signInWithGoogle(resp.credential);
            onDone?.();
          } catch (e: any) {
            onError?.(e?.message ?? "Google sign-in failed.");
          }
        },
      });
      g.accounts.id.renderButton(ref.current, {
        theme: "filled_black",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 320,
      });
    };

    if ((window as any).google?.accounts?.id) {
      init();
      return;
    }
    const existing = document.getElementById("gsi-script") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", init);
      return () => existing.removeEventListener("load", init);
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.id = "gsi-script";
    s.async = true;
    s.defer = true;
    s.onload = init;
    document.head.appendChild(s);
    return () => {
      cancelled = true;
    };
  }, [signInWithGoogle, onError, onDone]);

  if (!CLIENT_ID) return null;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center gap-3 text-[11px] uppercase tracking-wide text-white/25">
        <span className="h-px flex-1 bg-white/10" />
        or
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div ref={ref} className="overflow-hidden rounded-full" />
    </div>
  );
}
