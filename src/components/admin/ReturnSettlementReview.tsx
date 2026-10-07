"use client";
import { useEffect, useState } from "react";
import { formatGbp } from "@/lib/pricing";
import styles from "./ReturnRentalForm.module.css";

export function ReturnSettlementReview({ data, busy, enabled, onReview }: { data: any; busy: boolean; enabled: boolean; onReview: () => void }) {
  const [pdfUrl, setPdfUrl] = useState("");
  useEffect(() => {
    if (!data?.pdf?.base64) { setPdfUrl(""); return; }
    const bytes = Uint8Array.from(atob(data.pdf.base64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data]);
  return <section className={styles.review}>
    <div className={styles.reviewHead}><div><h3>Settlement review</h3><p>Review the card balance, itemised statement and email before confirming.</p></div><button type="button" disabled={!enabled || busy} onClick={onReview}>{busy ? "Preparing statement…" : data ? "Refresh review" : "Review statement & email"}</button></div>
    {data ? <>
      <dl className={styles.reviewAmounts}>
        <div><dt>{data.securityAlreadySettled ? "Cash deposit refunded" : "Expected cash deposit refund"}</dt><dd>{formatGbp(data.financial.depositRefund)}</dd></div>
        <div><dt>Authorisation release in this step · not a cash refund</dt><dd>{formatGbp(data.financial.holdRelease)}</dd></div>
        <div><dt>Damage from card hold</dt><dd>{formatGbp(data.financial.damageFromHold)}</dd></div>
        <div><dt>Damage from cash deposit</dt><dd>{formatGbp(data.financial.damageFromDeposit)}</dd></div>
        <div><dt>Separate late rental assessed · not yet collected</dt><dd>{formatGbp(data.financial.lateAssessed)}</dd></div>
        {data.financial.lateWaived > 0 && <div><dt>Late rental waived</dt><dd>{formatGbp(data.financial.lateWaived)}</dd></div>}
      </dl>
      {data.financial.holdRetainedForLate > 0 && <p>{formatGbp(data.financial.holdRetainedForLate)} remains authorised for the separate late-rental notice and dispute process. It is not charged now.</p>}
      <p>{data.draft ? "Draft only. Current card balances are checked again at confirmation; previewing sends no email and moves no money." : "This is the issued return statement. Security has already been settled."}</p>
      {pdfUrl && <a href={pdfUrl} target="_blank" rel="noopener noreferrer">View {data.draft ? "draft " : ""}return statement PDF ↗</a>}
      <details><summary>Renter email preview · {data.email.to || "email address unavailable"}</summary><p>Subject: {data.email.subject}</p><iframe title="Return statement email preview" sandbox="" srcDoc={`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;background:#18191c;color:#f1efec;font:14px/1.6 Arial,sans-serif">${data.email.html}</body></html>`}/></details>
    </> : <p>Complete the inspection to prepare the review. Editing any return decision requires a fresh review.</p>}
  </section>;
}
