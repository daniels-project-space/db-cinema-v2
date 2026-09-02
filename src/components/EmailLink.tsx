"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CONTACT_EMAIL } from "@/lib/site";

/**
 * The contact address, as a link that actually does something everywhere.
 *
 * It stays a real `mailto:` anchor, so the normal path is the browser's own —
 * middle-click, "copy link address", and a configured mail client all behave as
 * the user expects. The problem is the *unconfigured* case: on a desktop with no
 * default mail handler, clicking a mailto is silently inert, which reads as a
 * broken link.
 *
 * So we let the click through and then watch for whether anything happened. A
 * handler (or the OS chooser) pulls focus away from the document — `blur`, or
 * `visibilitychange` on mobile where the mail app takes over. If neither fires
 * within FALLBACK_MS, nothing opened: we copy the address instead and say so.
 *
 * Deliberately does NOT preventDefault — cancelling the navigation to "detect"
 * support first would break the case that already works.
 */
const FALLBACK_MS = 700;

export function EmailLink({ className = "", label }: { className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
    } catch {
      // clipboard API needs a secure context and permission; fall back to a
      // throwaway selection, which works back to much older browsers.
      const el = document.createElement("textarea");
      el.value = CONTACT_EMAIL;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        return false;
      } finally {
        document.body.removeChild(el);
      }
    }
    return true;
  }

  function onClick() {
    clearTimers();
    let left = false;
    const mark = () => { left = true; };
    window.addEventListener("blur", mark, { once: true });
    document.addEventListener("visibilitychange", mark, { once: true });

    timers.current.push(
      window.setTimeout(async () => {
        window.removeEventListener("blur", mark);
        document.removeEventListener("visibilitychange", mark);
        if (left) return; // a mail client took over — nothing to do
        if (await copy()) {
          setCopied(true);
          timers.current.push(window.setTimeout(() => setCopied(false), 2000));
        }
      }, FALLBACK_MS),
    );
  }

  return (
    <span className="relative inline-block">
      <a href={`mailto:${CONTACT_EMAIL}`} onClick={onClick} className={className}>
        {label ?? CONTACT_EMAIL}
      </a>
      <span
        role="status"
        aria-live="polite"
        className={`pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#0d0d11] px-2.5 py-1 text-[11px] font-medium text-white/85 shadow-lg transition-all duration-200 ${
          copied ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0"
        }`}
      >
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}
