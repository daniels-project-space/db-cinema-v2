"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CancellationPolicyQuickGuide } from "@/components/CancellationPolicyQuickGuide";
import styles from "./CancellationProtection.module.css";
import { COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS } from "@/lib/legal";

export function CancellationProtection({
  showV16RenterPolicy = false,
  version = "2026-11-v18",
}: {
  showV16RenterPolicy?: boolean;
  version?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const broadCompanyCancellation = (COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS as readonly string[]).includes(version);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return <>
    <button type="button" ref={trigger} className={styles.card} onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="cancellation-protection">
      <span className={styles.icon}>
        <svg viewBox="0 0 44 44" fill="none" aria-hidden>
          <path className={styles.shield} d="M22 4.8c5.8 3.5 10.4 4.6 15.3 5.2-.6 16.7-6.1 24-15.3 29.2C12.4 34 6.8 26.7 6.7 10c5.8-.7 10.4-2.4 15.3-5.2Z" pathLength="1" />
          <path className={styles.tick} d="m14.4 22.2 5.1 5.2 10-11.1" pathLength="1" />
          <path className={styles.spark} d="m35 4 1.2 2.4L39 7l-2.6 1.2L35 11l-1-2.8L31.5 7l2.5-.6L35 4Z" pathLength="1" />
        </svg>
      </span>
      <span><strong>Cancellation protection</strong><small>Included free · see your options</small></span>
      <span className={styles.free}>Free</span>
      <span aria-hidden className={styles.arrow}>↗</span>
    </button>

    <dialog
      ref={dialog}
      aria-label="Cancellation protection"
      className={styles.dialog}
      onCancel={event => { event.preventDefault(); close(); }}
      onClose={close}
      onClick={event => {
        if (event.target !== dialog.current) return;
        const rect = dialog.current.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }}
    >
      <header>
        <span className={styles.icon} aria-hidden>✓</span>
        <h2>We’ll help put it right.</h2>
        <button type="button" aria-label="Close cancellation protection" onClick={close}>×</button>
      </header>
      <p>
        {broadCompanyCancellation
          ? "If DB Cinema cancels your confirmed rental before pickup, choose a full refund or, if your account is not restricted or rejected for a terms violation, 130% account credit."
          : "If equipment is unexpectedly unavailable and DB Cinema cancels before pickup, choose a full refund or, if your account is not restricted or rejected for a terms violation, 130% account credit."}
      </p>
      <div className={styles.options}>
        <article><b>Full refund</b><p>Your cash payment returns to its original payment method.</p></article>
        <article><b>Account credit +30%</b><p>For accounts not restricted or rejected for a terms violation; valid for 365 days.</p></article>
      </div>
      <p className={styles.note}>Security is settled separately. Choosing credit replaces the rental refund; it can’t be withdrawn as cash. Statutory rights remain unchanged.</p>
      {showV16RenterPolicy && <CancellationPolicyQuickGuide includeCompanyCancellation={false} version="2026-10-v16" />}
      <p className={styles.note}>Your own cancellation options follow the terms you accept with your booking.</p>
      <Link href={`/legal/cancellation?version=${encodeURIComponent(version)}`}>Read the cancellation terms</Link>
      <button type="button" className={styles.done} onClick={close}>Got it</button>
    </dialog>
  </>;
}
