"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { IconStar } from "@/components/icons";

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1 text-xl">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={n <= value ? "text-accent-400" : "text-white/20"}
        >
          <IconStar filled className="h-5 w-5" />
        </button>
      ))}
    </div>
  );
}

export function BookingReview({
  bookingId,
  reviewed,
  token,
}: {
  bookingId: string;
  reviewed: boolean;
  token: string;
}) {
  const submit = useMutation(api.reviews.submitNative);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (reviewed || done)
    return <div className="text-xs text-emerald-300">Reviewed — thank you!</div>;

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-accent-400 hover:underline"
      >
        Leave a review
      </button>
    );

  async function send() {
    setErr(null);
    try {
      await submit({ token, bookingId: bookingId as any, rating, text });
      setDone(true);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    }
  }

  return (
    <div className="mt-1 w-full rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <Stars value={rating} onChange={setRating} />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="How was the gear & service?"
        rows={2}
        className="mt-2 w-full rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none placeholder:text-white/30"
      />
      {err && <div className="mt-1 text-xs text-red-300">{err}</div>}
      <div className="mt-2 flex gap-2">
        <button onClick={send} className="btn-primary px-4 py-1.5 text-xs">
          Submit review
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-white/40 hover:text-white">
          cancel
        </button>
      </div>
    </div>
  );
}
