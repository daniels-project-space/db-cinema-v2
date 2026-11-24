"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useCart } from "./CartProvider";
import { IconCheck } from "@/components/icons";

export function CartToast() {
  const { toast, clearToast } = useCart();
  const pathname = usePathname();
  useEffect(() => {
    if (!toast) return;
    if (pathname === "/checkout") { clearToast(); return; }
    const t = setTimeout(clearToast, 5000);
    return () => clearTimeout(t);
  }, [toast, clearToast, pathname]);
  if (!toast || pathname === "/checkout") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div role="status" aria-live="polite" className="toast-in flex items-center gap-2.5 rounded-full border border-emerald-400/30 bg-charcoal-900/95 px-5 py-3 text-sm text-white shadow-2xl shadow-black/50">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
          <IconCheck className="h-3 w-3" />
        </span>
        {toast}
      </div>
    </div>
  );
}
