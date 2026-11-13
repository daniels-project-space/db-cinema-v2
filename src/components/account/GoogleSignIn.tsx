"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, type AccountTermsAcceptance } from "./AccountProvider";
import { accountAuthErrorMessage } from "../../../shared/accountAuth";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/** "Continue with Google" — Google Identity Services button. Renders only when a client id is
 *  configured, so the email/password form degrades gracefully before Google OAuth is wired up. */
export function GoogleSignIn({
  onError,
  onDone,
  requireTermsAcceptance = false,
  termsAcceptance = null,
}: {
  onError?: (m: string, code?: string) => void;
  onDone?: () => void;
  requireTermsAcceptance?: boolean;
  termsAcceptance?: AccountTermsAcceptance | null;
}) {
  const { signInWithGoogle } = useAccount();
  const ref = useRef<HTMLDivElement>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const flowRef = useRef({ onError, onDone, requireTermsAcceptance, termsAcceptance });
  flowRef.current = { onError, onDone, requireTermsAcceptance, termsAcceptance };

  useEffect(() => {
    if (!CLIENT_ID || !ref.current) return;
    let cancelled = false;
    let initialized = false;
    let renderedWidth = 0;
    let loadTimeout: ReturnType<typeof setTimeout> | undefined;
    let script: HTMLScriptElement | null = null;
    let resizeObserver: ResizeObserver | undefined;

    const renderButton = () => {
      const g = (window as any).google;
      const host = ref.current;
      if (!g?.accounts?.id || !host || cancelled) return;
      const width = Math.max(200, Math.min(320, Math.floor(host.clientWidth || 320)));
      if (width === renderedWidth) return;
      host.replaceChildren();
      g.accounts.id.renderButton(host, {
        theme: "filled_black",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width,
      });
      renderedWidth = width;
    };

    const init = () => {
      const g = (window as any).google;
      if (!g?.accounts?.id || !ref.current || cancelled) return;
      if (loadTimeout) clearTimeout(loadTimeout);
      setLoadFailed(false);
      if (!initialized) {
        g.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async (resp: any) => {
            const flow = flowRef.current;
            if (flow.requireTermsAcceptance && !flow.termsAcceptance) {
              flow.onError?.("Please accept the current Terms and Conditions and read the Privacy Notice first.");
              return;
            }
            try {
              await signInWithGoogle(resp.credential, flow.termsAcceptance ?? undefined);
              flow.onDone?.();
            } catch (e: any) {
              flow.onError?.(accountAuthErrorMessage(e, "Google sign-in failed. Please try again."), typeof e?.data?.code === "string" ? e.data.code : undefined);
            }
          },
        });
        initialized = true;
      }
      renderButton();
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(renderButton);
        resizeObserver.observe(ref.current);
      } else {
        window.addEventListener("resize", renderButton);
      }
    };

    const fail = () => {
      if (cancelled) return;
      if (loadTimeout) clearTimeout(loadTimeout);
      setLoadFailed(true);
    };

    if ((window as any).google?.accounts?.id) {
      init();
    } else {
      // A blocked script or a load event without GIS should not leave an empty
      // Google button slot with no explanation. Password sign-in stays usable.
      loadTimeout = setTimeout(() => {
        if ((window as any).google?.accounts?.id) init();
        else fail();
      }, 12000);
      script = document.getElementById("gsi-script") as HTMLScriptElement | null;
      if (script) {
        script.addEventListener("load", init);
        script.addEventListener("error", fail);
      }
      else {
        script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.id = "gsi-script";
        script.async = true;
        script.defer = true;
        script.addEventListener("load", init);
        script.addEventListener("error", fail);
        document.head.appendChild(script);
      }
    }
    return () => {
      cancelled = true;
      if (loadTimeout) clearTimeout(loadTimeout);
      script?.removeEventListener("load", init);
      script?.removeEventListener("error", fail);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", renderButton);
    };
  }, [signInWithGoogle]);

  if (!CLIENT_ID) return null;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center gap-3 text-[11px] uppercase tracking-wide text-white/25">
        <span className="h-px flex-1 bg-white/10" />
        or
        <span className="h-px flex-1 bg-white/10" />
      </div>
      {requireTermsAcceptance && !termsAcceptance && <p className="text-center text-xs text-white/45">Agree above to create an account with Google.</p>}
      <div ref={ref} className={requireTermsAcceptance && !termsAcceptance ? "hidden" : "w-full rounded-full"} />
      {loadFailed && <p role="status" aria-live="polite" className="m-0 max-w-sm text-center text-xs leading-5 text-white/55">Google sign-in is unavailable right now. You can still use email and password.</p>}
    </div>
  );
}
