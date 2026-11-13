"use client";
import { useEffect, useState, type ReactNode } from "react";
import { formatGbp } from "@/lib/pricing";
import styles from "./ReturnRentalForm.module.css";

function emailDeliveryStatus(delivery: { status: string; ambiguous?: boolean } | null | undefined) {
  if (!delivery) return null;
  if (delivery.status === "sent") return { label: "Accepted by email service · inbox delivery not confirmed", state: "sent" };
  if (delivery.status === "delivery_unknown") return { label: "Delivery uncertain · check Resend before sending again", state: "delivery_unknown" };
  if (delivery.status === "sending") return { label: "Email is sending", state: "sending" };
  if (delivery.status === "failed" && delivery.ambiguous) return { label: "Provider response uncertain · safe retry is in progress", state: "ambiguous" };
  if (delivery.status === "failed") return { label: "Provider rejected the email · retry is queued", state: "failed" };
  return { label: "Email is queued", state: "pending" };
}

export function ReturnSettlementReview({ data, busy, enabled, onReview, paymentSummary }: { data: any; busy: boolean; enabled: boolean; onReview: () => void; paymentSummary?: ReactNode }) {
  const [pdf, setPdf] = useState<{ source: string; url: string } | null>(null);
  const source = data?.pdf?.base64;
  const pdfUrl = pdf?.source === source ? pdf?.url ?? "" : "";
  const deliveryStatus = !data?.draft ? emailDeliveryStatus(data?.emailDelivery) : null;
  useEffect(() => {
    if (!source) { setPdf(null); return; }
    const bytes = Uint8Array.from(atob(source), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); setPdf({ source, url });
    return () => URL.revokeObjectURL(url);
  }, [source]);
  return <section className={styles.review}>
    <div className={styles.reviewHead}><div><h3>Settlement review</h3><p>Review the card balance, itemised statement and email before confirming.</p></div><button type="button" disabled={!enabled || busy} onClick={onReview}>{busy ? "Preparing statement…" : data ? "Refresh review" : "Review statement & email"}</button></div>
    <div className={styles.settlementColumns}>{paymentSummary}<section className={styles.settlementPreview}><h4>Settlement preview</h4>{data ? <>
      {data.financial.savedCardLimit!==undefined?<><dl className={styles.reviewAmounts}><div><dt>Damage/loss assessed</dt><dd>{formatGbp(data.financial.damageAssessed)}</dd></div><div><dt>Late time assessed</dt><dd>{formatGbp(data.financial.lateAssessed)}</dd></div><div><dt>Combined saved-card collection limit</dt><dd>{formatGbp(data.financial.savedCardLimit)}</dd></div></dl><p>{data.financial.immediateClaim ? "Only a claim you explicitly select sends an itemised notice and makes one saved-card attempt. No claim means no charge." : "An itemised claim follows this rental’s agreed notice and dispute period. No unclaimed amount is charged."} Further amounts above the limit require a separate payment agreement.</p></>:<><dl className={styles.reviewAmounts}>
        <div><dt>{data.securityAlreadySettled ? "Cash deposit refunded" : "Expected cash deposit refund"}</dt><dd>{formatGbp(data.financial.depositRefund)}</dd></div>
        <div><dt>Authorisation release in this step · not a cash refund</dt><dd>{formatGbp(data.financial.holdRelease)}</dd></div>
        <div><dt>Damage from card hold</dt><dd>{formatGbp(data.financial.damageFromHold)}</dd></div>
        <div><dt>Damage from cash deposit</dt><dd>{formatGbp(data.financial.damageFromDeposit)}</dd></div>
        <div><dt>Separate late rental assessed · not yet collected</dt><dd>{formatGbp(data.financial.lateAssessed)}</dd></div>
        {data.financial.lateWaived > 0 && <div><dt>Late rental waived</dt><dd>{formatGbp(data.financial.lateWaived)}</dd></div>}
      </dl></>}
      {data.financial.holdRetainedForLate > 0 && <p>{formatGbp(data.financial.holdRetainedForLate)} remains authorised for the separate late-rental notice and dispute process. It is not charged now.</p>}
      <p>{data.draft ? "Draft only. Current card balances are checked again at confirmation; previewing sends no email and moves no money." : "This is the issued return statement. Security has already been settled."}</p>
    </> : <p>Complete the inspection to prepare the review. Editing any return decision requires a fresh review.</p>}</section></div>
    {data && <div className={styles.previewCards}><section><h4>Return statement</h4><p>{data.draft ? "Draft settlement statement" : "Issued settlement statement"}</p>{pdfUrl && <a href={pdfUrl} target="_blank" rel="noopener noreferrer">View {data.draft ? "draft " : ""}return statement PDF ↗</a>}</section><section><h4>Renter email</h4><p className={styles.emailRecipient}>To: {data.email.to || "email address unavailable"}</p><p>Subject: {data.email.subject}</p>{deliveryStatus && <p role="status" aria-live="polite" className={styles.emailDelivery} data-state={deliveryStatus.state}>{deliveryStatus.label}</p>}<details><summary>View renter email preview</summary><iframe title="Return statement email preview" sandbox="" srcDoc={`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;background:#18191c;color:#f1efec;font:14px/1.6 Arial,sans-serif">${data.email.html}</body></html>`}/></details></section></div>}
  </section>;
}
