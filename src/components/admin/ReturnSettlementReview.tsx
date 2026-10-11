"use client";
import { useEffect, useState, type ReactNode } from "react";
import { formatGbp } from "@/lib/pricing";
import styles from "./ReturnRentalForm.module.css";

export function ReturnSettlementReview({ data, busy, enabled, onReview, paymentSummary }: { data: any; busy: boolean; enabled: boolean; onReview: () => void; paymentSummary?: ReactNode }) {
  const [pdf, setPdf] = useState<{ source: string; url: string } | null>(null);
  const source = data?.pdf?.base64;
  const pdfUrl = pdf?.source === source ? pdf?.url ?? "" : "";
  useEffect(() => {
    if (!source) { setPdf(null); return; }
    const bytes = Uint8Array.from(atob(source), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); setPdf({ source, url });
    return () => URL.revokeObjectURL(url);
  }, [source]);
  return <section className={styles.review}>
    <div className={styles.reviewHead}><div><h3>Settlement review</h3><p>Review the card balance, itemised statement and email before confirming.</p></div><button type="button" disabled={!enabled || busy} onClick={onReview}>{busy ? "Preparing statement…" : data ? "Refresh review" : "Review statement & email"}</button></div>
    <div className={styles.settlementColumns}>{paymentSummary}<section className={styles.settlementPreview}><h4>Settlement preview</h4>{data ? <>
      <dl className={styles.reviewAmounts}>
        <div><dt>{data.refundProgress ? "Total deposit refund requested" : data.securityAlreadySettled ? "Cash deposit refunded" : "Expected cash deposit refund"}</dt><dd>{formatGbp(data.financial.depositRefund)}</dd></div>
        {data.refundProgress && <><div><dt>Cash refund confirmed by provider</dt><dd>{formatGbp(data.refundProgress.confirmed)}</dd></div><div><dt>Cash refund processing</dt><dd>{formatGbp(data.refundProgress.processing)}</dd></div><div><dt>Cash refund outstanding</dt><dd>{formatGbp(Math.max(0,data.refundProgress.expected-data.refundProgress.confirmed-data.refundProgress.processing))}</dd></div></>}
        <div><dt>Authorisation release in this step · not a cash refund</dt><dd>{formatGbp(data.financial.holdRelease)}</dd></div>
        <div><dt>Damage from card hold</dt><dd>{formatGbp(data.financial.damageFromHold)}</dd></div>
        <div><dt>Damage from cash deposit</dt><dd>{formatGbp(data.financial.damageFromDeposit)}</dd></div>
        <div><dt>Separate late rental assessed · not yet collected</dt><dd>{formatGbp(data.financial.lateAssessed)}</dd></div>
        {data.financial.lateWaived > 0 && <div><dt>Late rental waived</dt><dd>{formatGbp(data.financial.lateWaived)}</dd></div>}
      </dl>
      {data.financial.holdRetainedForLate > 0 && <p>{formatGbp(data.financial.holdRetainedForLate)} remains authorised for the separate late-rental notice and dispute process. It is not charged now.</p>}
      {data.refundProgress?.error&&<p role="alert">{data.refundProgress.error}</p>}
      <p>{data.refundProgress&&data.refundProgress.status!=="succeeded" ? "The deposit refund is not complete. Confirmation checks the saved original-payment refund; it does not create another payout for a pending or failed receipt." : data.draft ? "Draft only. Current card balances are checked again at confirmation; previewing sends no email and moves no money." : "This is the saved issued return statement. Current bank refund amounts are shown above."}</p>
      {!data.draft&&data.refundProgress&&<p>The PDF preserves the saved statement. Reviewing newer bank information does not revise it or send an email; confirming reconciles the saved settlement.</p>}
    </> : <p>Complete the inspection to prepare the review. Editing any return decision requires a fresh review.</p>}</section></div>
    {data && <div className={styles.previewCards}><section><h4>Return statement</h4><p>{data.draft ? "Draft settlement statement" : "Issued settlement statement"}</p>{pdfUrl && <a href={pdfUrl} target="_blank" rel="noopener noreferrer">View {data.draft ? "draft " : ""}return statement PDF ↗</a>}</section><section><h4>Renter email</h4><p className={styles.emailRecipient}>To: {data.email.to || "email address unavailable"}</p><p>Subject: {data.email.subject}</p><details><summary>View renter email preview</summary><iframe title="Return statement email preview" sandbox="" srcDoc={`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;background:#18191c;color:#f1efec;font:14px/1.6 Arial,sans-serif">${data.email.html}</body></html>`}/></details></section></div>}
  </section>;
}
