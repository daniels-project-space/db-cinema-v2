"use client";

import { useEffect } from "react";
import { useCart } from "./CartProvider";

export function CartToast() {
  const { toast, clearToast } = useCart();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 2600);
    return () => clearTimeout(t);
  }, [toast, clearToast]);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="toast-in flex items-center gap-2 rounded-full border border-emerald-400/30 bg-charcoal-900/90 px-5 py-3 text-sm text-white shadow-2xl backdrop-blur">
        <span className="text-emerald-400">✓</span> {toast}
      </div>
    </div>
  );
}
