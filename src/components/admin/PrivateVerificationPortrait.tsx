"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function PrivateVerificationPortrait({ token, accountId, className }: { token: string; accountId: string; className?: string }) {
  const [refresh, setRefresh] = useState(() => Math.floor(Date.now() / 60000));
  const [image, setImage] = useState<{ url: string; token: string; accountId: string; documentId: string } | null>(null);
  const portrait = useQuery(api.privateVerificationPortrait.selected, { token, accountId: accountId as any, refresh });
  const documentId = portrait?.documentId;
  useEffect(() => {
    const timer = setInterval(() => setRefresh(Math.floor(Date.now() / 60000)), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!documentId || !process.env.NEXT_PUBLIC_CONVEX_SITE_URL) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/admin-private-portrait`, {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, documentId }), cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) return;
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ url: objectUrl, token, accountId, documentId });
      } catch {}
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [token, accountId, documentId]);
  if (!image || image.token !== token || image.accountId !== accountId || image.documentId !== documentId) return null;
  return <img src={image.url} alt="Private verification portrait" className={className} />;
}
