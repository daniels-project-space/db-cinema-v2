import {rentalEmail, emailRows} from "./rentalEmail";
import type { InspectionInput, InspectionItem } from "./returnInspection";
export type ReturnStatementData = {
  inspection?: (InspectionInput & InspectionItem)[];
  number: string; issuedAt: number; actualReturnedAt: number;
  agreedReturnTime?: string;
  supplierName: string; supplierAddress?: string;
  customerName?: string; customerEmail: string; billingAddress?: string;
  lineItems: { title: string; start: number; end: number; qty: number; lineTotal: number; returnTime?: string }[];
  subtotal: number; discount: number; deliveryFee: number; creditApplied: number;
  checkoutPaid: number; rentalRefunded?: number; securityPaid: number; securityRefunded: number;
  holdStatus?: string; damageTotal: number; damageFromHold: number; damageNote?: string;
  lateAssessed: number; lateWaived: number;
  lateBreakdown: { title: string; days: number; dailyRate: number; amount: number }[];
};
const amount = (value: number) => `£${value.toFixed(2)}`;
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Itemised advance notice: a successful send precedes any damage collection. */
export function damageDeductionEmail({to,bookingId,damage,reason,url}:{to:string;bookingId:string;damage:number;reason:string;url:string}) {
  return {to,subject:`DB Cinema Rentals · ${amount(damage)} return deduction`,
    html:rentalEmail({title:"Your return inspection",preview:`Please review the documented ${amount(damage)} deduction.`,url,button:"View your rental conversation",
      body:`<p>Our return inspection recorded a damage or loss deduction for your rental.</p>${emailRows([["Rental reference",`DBC-${bookingId.slice(-8).toUpperCase()}`],["Documented deduction",amount(damage)]])}<h3>Evidence and calculation</h3><p>${esc(reason)}</p><p>We will use the available card authorisation first, then the refundable deposit for any remaining amount. The same deduction will not be collected twice. Your final return statement will show the amount retained, any deposit refund and the release of any remaining authorisation separately.</p><p>If the evidence or amount is wrong, reply to this email or contact us in your rental conversation.</p>`})};
}
/** The same escaped content is used for the pre-confirmation review and issued email. */
export function returnStatementEmail(s: ReturnStatementData, draft = false, url="https://dbcinemarentals.com/account#invoices") {
  const lines = s.lineItems.map(line => `<li>${esc(line.title)} × ${line.qty}: ${amount(line.lineTotal)}${line.returnTime ? ` · return ${new Date(line.end).toISOString().slice(0, 10)} at ${esc(line.returnTime)} London time` : ""}</li>`).join("");
  const inspection = s.inspection?.length ? `<h3>Equipment inspection</h3><ul>${s.inspection.map(item => `<li>${esc(item.title)}: ${item.condition === "good" ? "Good condition" : `Issue found — ${esc(item.details)}${item.openCase ? draft ? " (damage case selected for review)" : " (damage case opened)" : ""}`}</li>`).join("")}</ul>` : "";
  const damageDetail = s.damageNote ? `<p>Deduction evidence and calculation: ${esc(s.damageNote)}</p>` : "";
  const late = s.lateAssessed > 0 ? `<p><b>Separate late rental time assessed: ${amount(s.lateAssessed)}.</b> This is not yet collected. An itemised notice and seven-day dispute period follow separately.</p>` : s.lateWaived > 0 ? `<p>Late rental time of ${amount(s.lateWaived)} ${draft ? "will be" : "was"} waived.</p>` : "";
  return { to: s.customerEmail, subject: `Db Cinema return statement ${s.number}`,
    html: rentalEmail({title:draft?"Draft rental return statement":"Your rental return statement",preview:draft?"Review the proposed return settlement before confirming.":"Your inspection and return settlement are ready.",url,button:"View return statement",body:`<p>${draft ? "Preview only: this review does not execute refunds, captures, case creation or email delivery. The following totals depend on successful settlement." : "Your itemised PDF return statement is attached."} Db Cinema Rentals is not VAT registered, so this is not a VAT invoice.</p><ul>${lines}</ul>${inspection}<p>Rental subtotal ${amount(s.subtotal)}; discount −${amount(s.discount)}; delivery ${amount(s.deliveryFee)}; store credit used −${amount(s.creditApplied)}.</p><p>Confirmed rental payment refunds ${amount(s.rentalRefunded ?? 0)}. Refundable security payment paid ${amount(s.securityPaid)}; ${draft ? "expected refund" : "refunded"} ${amount(s.securityRefunded)}. Documented damage/loss ${draft ? "to retain" : "retained"} ${amount(s.damageTotal)}, including ${amount(s.damageFromHold)} from the authorised hold.</p>${damageDetail}${late}<p>If any return detail is wrong, reply to this email.</p>`}) };
}
