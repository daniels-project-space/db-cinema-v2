import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { CONTACT_EMAIL } from "../site";
import type { AgreementSnapshot } from "../../../shared/rentalAgreement";
import type { InspectionInput, InspectionItem } from "../../../shared/returnInspection";

export type InvoiceData = {
  number: string;
  issuedAt: number;
  supplierName?: string;
  supplierAddress?: string;
  status: string;
  customerName: string | null;
  email: string | null;
  fulfilment: "pickup" | "delivery";
  address: string | null;
  currency: string;
  lineItems: { title: string; start: number; end: number; qty: number; lineTotal: number; returnTime?: string }[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  creditApplied: number;
  membershipCreditApplied?: number;
  depositAmount: number;
  total: number;
  promoCode: string | null;
  agreementSnapshot?: AgreementSnapshot | null;
  acceptedAgreementEvidence?: {name:string|null;signedAt:number|null;documents:{kind:string;version:string}[]};
  returnStatement?: ReturnStatementData | null;
  rentalRefunds?:{amount:number;status:string;reason:string}[];
  cancellationRefund?:number;accountCreditIssued?:number;accountCreditBonus?:number;
};

import type { ReturnStatementData } from "../../../shared/returnStatement";
export type { ReturnStatementData } from "../../../shared/returnStatement";

const gbp = (n: number) => `£${(Math.round(n * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
const d = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).format(new Date(ms));
const dateTime = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" }).format(new Date(ms));

const C = { ink: "#1a1a1a", muted: "#6b6b6b", line: "#e6e6e6", accent: "#e0992f", soft: "#faf6ef" };

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 48, fontSize: 10, color: C.ink, fontFamily: "Helvetica" },
  topbar: { height: 4, backgroundColor: C.accent, marginBottom: 24, borderRadius: 2 },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  brandSub: { fontSize: 8, color: C.muted, marginTop: 2, letterSpacing: 2 },
  docTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", color: C.accent, textAlign: "right" },
  meta: { fontSize: 9, color: C.muted, textAlign: "right", marginTop: 4 },
  section: { marginTop: 26 },
  label: { fontSize: 8, color: C.muted, letterSpacing: 1, marginBottom: 4, textTransform: "uppercase" },
  billRow: { flexDirection: "row", justifyContent: "space-between" },
  col: { width: "48%" },
  strong: { fontFamily: "Helvetica-Bold" },
  tHead: { flexDirection: "row", backgroundColor: C.soft, paddingVertical: 7, paddingHorizontal: 8, marginTop: 22, borderRadius: 3 },
  tRow: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  cItem: { width: "46%", paddingRight: 10 },
  cDates: { width: "30%", paddingRight: 6, color: C.muted },
  cQty: { width: "10%", textAlign: "center", color: C.muted },
  cAmt: { width: "14%", textAlign: "right" },
  totals: { marginTop: 18, marginLeft: "auto", width: "46%" },
  totLabel:{maxWidth:"75%",flexShrink:1},
  totValue:{flexShrink:0,textAlign:"right"},
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, marginTop: 4, borderTopWidth: 2, borderTopColor: C.ink },
  grandTxt: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  note: { marginTop: 10, fontSize: 8, color: C.muted },
  footer: { position: "absolute", bottom: 32, left: 48, right: 48, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, fontSize: 8, color: C.muted, textAlign: "center" },
});

export function InvoiceDocument({ data }: { data: InvoiceData }) {
  return (
    <Document title={`Db Cinema Receipt ${data.number}`}>
      <Page size="A4" style={s.page}>
        <View style={s.topbar} />
        <View style={s.headRow}>
          <View>
            <Text style={s.brand}>DB CINEMA</Text>
            <Text style={s.brandSub}>RENTALS · LONDON</Text>
          </View>
          <View>
            <Text style={s.docTitle}>RECEIPT</Text>
            <Text style={s.meta}>{data.number}</Text>
            <Text style={s.meta}>Issued {d(data.issuedAt)}</Text>
            <Text style={s.meta}>Payment received</Text>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.billRow}>
            <View style={s.col}>
              <Text style={s.label}>Billed to</Text>
              {data.customerName ? <Text style={s.strong}>{data.customerName}</Text> : null}
              {data.email ? <Text>{data.email}</Text> : null}
            </View>
            <View style={s.col}>
              <Text style={s.label}>Supplier & fulfilment</Text>
              <Text style={s.strong}>DB Cinema Rentals</Text>
              <Text style={s.strong}>{data.fulfilment === "delivery" ? "Delivery" : "Collection"}</Text>
              <Text>{data.fulfilment === "delivery" ? data.address ?? "—" : "Central London"}</Text>
            </View>
          </View>
        </View>

        <View style={s.tHead}>
          <Text style={[s.cItem, s.strong]}>Item</Text>
          <Text style={[s.cDates, s.strong]}>Dates</Text>
          <Text style={[s.cQty, s.strong]}>Qty</Text>
          <Text style={[s.cAmt, s.strong]}>Amount</Text>
        </View>
        {data.lineItems.map((li, i) => (
          <View style={s.tRow} key={i}>
            <Text style={s.cItem}>{li.title}</Text>
            <Text style={s.cDates}>{d(li.start)} – {d(li.end)}{li.returnTime ? `\nReturn ${li.returnTime} London` : ""}</Text>
            <Text style={s.cQty}>{li.qty}</Text>
            <Text style={s.cAmt}>{gbp(li.lineTotal)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.totRow}><Text style={{ color: C.muted }}>Subtotal</Text><Text style={s.totValue}>{gbp(data.subtotal)}</Text></View>
          {data.discount > 0 ? (
            <View style={s.totRow}><Text style={{ color: C.muted }}>Discount{data.promoCode ? ` (${data.promoCode})` : ""}</Text><Text style={s.totValue}>−{gbp(data.discount)}</Text></View>
          ) : null}
          {data.creditApplied > 0 ? (
            <View style={s.totRow}><Text style={{ color: C.muted }}>Store credit</Text><Text style={s.totValue}>−{gbp(data.creditApplied)}</Text></View>
          ) : null}
          {data.deliveryFee > 0 ? (
            <View style={s.totRow}><Text style={{ color: C.muted }}>Delivery</Text><Text style={s.totValue}>{gbp(data.deliveryFee)}</Text></View>
          ) : null}
          {!!data.membershipCreditApplied && <Text style={s.note}>Store credit above includes {gbp(data.membershipCreditApplied)} from the first paid membership month. The subscription fee is itemised separately by Stripe.</Text>}
          <View style={s.grand}><Text style={s.grandTxt}>Total paid</Text><Text style={s.grandTxt}>{gbp(data.total)}</Text></View>
          {data.depositAmount > 0 ? (
            <Text style={s.note}>Includes {gbp(data.depositAmount)} refundable deposit, returned after the gear is back in good condition.</Text>
          ) : null}
          {data.rentalRefunds?.map((r,i)=><View key={i} style={s.totRow}><Text>Rental refund ({r.status})</Text><Text style={s.totValue}>{gbp(r.amount)}</Text></View>)}
          {(data.cancellationRefund??0)>0&&<View style={s.totRow}><Text style={s.totLabel}>Cancellation card refund</Text><Text style={s.totValue}>{gbp(data.cancellationRefund!)}</Text></View>}
          {(data.accountCreditIssued??0)>0&&<View style={s.totRow}><Text style={s.totLabel}>Account credit issued · see credit receipts</Text><Text style={s.totValue}>{gbp(data.accountCreditIssued!)}</Text></View>}
          {(data.accountCreditBonus??0)>0&&<View style={s.totRow}><Text style={s.totLabel}>30% bonus included in that credit</Text><Text style={s.totValue}>{gbp(data.accountCreditBonus!)}</Text></View>}
          <Text style={s.note}>Db Cinema Rentals is not VAT registered. No VAT is charged. This receipt is not a VAT invoice.</Text>
        </View>

        <Text style={s.footer}>
          Db Cinema Rentals · dbcinemarentals.com · {CONTACT_EMAIL}{"\n"}
          Thank you for renting with us.
        </Text>
      </Page>
    </Document>
  );
}

const sStyle=StyleSheet.create({page:{padding:40,fontSize:9,lineHeight:1.5,fontFamily:"Helvetica"},heading:{fontSize:16,marginBottom:15},space:{marginTop:10},strong:{fontFamily:"Helvetica-Bold"}});

export function ReturnStatementDocument({ data, draft = false }: { data: ReturnStatementData; draft?: boolean }) {
  const rentalGross = data.subtotal - data.discount + data.deliveryFee;
  const damageFromPayment = Math.max(0, data.damageTotal - data.damageFromHold);
  const netCardPaid = data.checkoutPaid - (draft?data.securityRefunded:data.depositRefundState?data.securityRefundedConfirmed??0:data.securityRefunded) - (data.rentalRefunded??0) + data.damageFromHold;
  return <Document title={`Db Cinema Return Statement ${data.number}`}>
    <Page size="A4" style={s.page}>
      <View style={s.topbar} />
      <View style={s.headRow}>
        <View><Text style={s.brand}>DB CINEMA</Text><Text style={s.brandSub}>RENTALS · LONDON</Text></View>
        <View><Text style={s.docTitle}>{draft ? "DRAFT RETURN STATEMENT" : "RETURN STATEMENT"}</Text><Text style={s.meta}>{data.number}</Text><Text style={s.meta}>{draft ? "Prepared" : "Issued"} {d(data.issuedAt)}</Text><Text style={s.meta}>Returned {dateTime(data.actualReturnedAt)} London time</Text></View>
      </View>
      {draft ? <Text style={s.note}>DRAFT — previewing does not execute refunds, card captures or email delivery. Totals depend on successful settlement.</Text> : null}
      <View style={s.section}>
        <View style={s.billRow}>
          <View style={s.col}>
            <Text style={s.label}>Supplier</Text><Text style={s.strong}>DB Cinema Rentals</Text>
            <Text>{CONTACT_EMAIL}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>Renter</Text><Text style={s.strong}>{data.customerName || data.customerEmail}</Text>
            <Text>{data.customerEmail}</Text>{data.billingAddress ? <Text>{data.billingAddress}</Text> : null}
          </View>
        </View>
      </View>
      <View style={s.tHead}><Text style={[s.cItem, s.strong]}>Rental item</Text><Text style={[s.cDates, s.strong]}>Dates</Text><Text style={[s.cQty, s.strong]}>Qty</Text><Text style={[s.cAmt, s.strong]}>Charge</Text></View>
      {data.lineItems.map((line, i) => <View style={s.tRow} key={i}>
        <Text style={s.cItem}>{line.title}</Text><Text style={s.cDates}>{d(line.start)} – {d(line.end)}{line.returnTime ? `\nReturn ${line.returnTime} London` : ""}</Text><Text style={s.cQty}>{line.qty}</Text><Text style={s.cAmt}>{gbp(line.lineTotal)}</Text>
      </View>)}
      {data.inspection?.length ? <View style={s.section}><Text style={s.label}>Equipment return inspection</Text>{data.inspection.map(item => <View key={item.key} style={{ marginBottom: 8 }} wrap={false}><Text style={s.strong}>{item.title} · {item.condition === "good" ? "Good condition" : "Issue found"}</Text>{item.details ? <Text style={{ color: C.muted, marginTop: 3 }}>{item.details}</Text> : null}{item.openCase ? <Text style={{ color: C.muted, marginTop: 3 }}>{draft ? "Damage case selected for review." : "Damage case opened for review."}</Text> : null}</View>)}</View> : null}
      <View style={s.totals}>
        <View style={s.totRow}><Text style={s.totLabel}>Rental subtotal</Text><Text style={s.totValue}>{gbp(data.subtotal)}</Text></View>
        {data.discount > 0 ? <View style={s.totRow}><Text style={s.totLabel}>Rental discount</Text><Text style={s.totValue}>−{gbp(data.discount)}</Text></View> : null}
        {data.deliveryFee > 0 ? <View style={s.totRow}><Text style={s.totLabel}>Delivery</Text><Text style={s.totValue}>{gbp(data.deliveryFee)}</Text></View> : null}
        <View style={s.grand}><Text style={[s.grandTxt,{maxWidth:"75%",flexShrink:1}]}>Rental charges</Text><Text style={s.grandTxt}>{gbp(rentalGross)}</Text></View>
        {data.creditApplied > 0 ? <View style={s.totRow}><Text style={s.totLabel}>Store credit used</Text><Text style={s.totValue}>−{gbp(data.creditApplied)}</Text></View> : null}
        <View style={s.totRow}><Text style={s.totLabel}>Refundable security payment taken</Text><Text style={s.totValue}>{gbp(data.securityPaid)}</Text></View>
        {data.savedCardLimit!==undefined&&<><View style={s.totRow}><Text style={s.totLabel}>Saved-card collection limit · not charged or held</Text><Text style={s.totValue}>{gbp(data.savedCardLimit)}</Text></View><View style={s.totRow}><Text style={s.totLabel}>{data.securityPaid>0?"Damage/loss assessed · cash retained below":"Damage/loss assessed · not collected by this return"}</Text><Text style={s.totValue}>{gbp(data.damageAssessed??0)}</Text></View></>}
        <View style={s.totRow}><Text style={s.totLabel}>Card charged at checkout</Text><Text style={s.totValue}>{gbp(data.checkoutPaid)}</Text></View>
        {(data.rentalRefunded??0)>0&&<View style={s.totRow}><Text style={s.totLabel}>Rental payment already refunded</Text><Text style={s.totValue}>−{gbp(data.rentalRefunded!)}</Text></View>}
        <View style={s.totRow}><Text style={s.totLabel}>{draft?"Expected security refund at return":data.depositRefundState?"Deposit refund confirmed":"Security payment refunded at return"}</Text><Text style={s.totValue}>−{gbp(draft?data.securityRefunded:data.depositRefundState?data.securityRefundedConfirmed??0:data.securityRefunded)}</Text></View>
        {!draft&&data.depositRefundState&&data.securityRefunded>(data.securityRefundedConfirmed??0)&&<View style={s.totRow}><Text style={s.totLabel}>{data.depositRefundState==="pending"?"Refund processing at bank":"Refund awaiting resolution"}</Text><Text style={s.totValue}>{gbp(data.securityRefunded-(data.securityRefundedConfirmed??0))}</Text></View>}
        {data.damageTotal > 0 ? <View style={s.totRow}><Text style={s.totLabel}>{draft ? "Documented damage/loss to retain" : "Documented damage/loss retained"}</Text><Text style={s.totValue}>{gbp(data.damageTotal)}</Text></View> : null}
        {data.damageTotal > 0 ? <Text style={s.note}>{draft ? "Expected damage from authorised hold" : "Damage paid from authorised hold"}: {gbp(data.damageFromHold)}. From refundable security payment: {gbp(damageFromPayment)}. These are parts of the same deduction.</Text> : null}
        <View style={s.grand}><Text style={[s.grandTxt,{maxWidth:"75%",flexShrink:1}]}>{draft ? "Expected net card payment" : "Net card paid after return"}</Text><Text style={[s.grandTxt,{flexShrink:0,textAlign:"right"}]}>{gbp(netCardPaid)}</Text></View>
        <Text style={s.note}>All rental card charges, less confirmed rental and security refunds, plus any hold captured for damage. Store credit used: {gbp(data.creditApplied)}. Separate late time is excluded and may be collected later.</Text>
        {data.damageNote ? <Text style={s.note}>Damage/loss detail: {data.damageNote}</Text> : null}
        {data.lateAssessed > 0 ? <Text style={s.note}>Separate late rental time assessed: {gbp(data.lateAssessed)}. Pending itemised notice, seven-day dispute period and later collection; it is not included in the checkout payment or damage deduction.</Text> : null}
        {data.agreedReturnTime ? <Text style={s.note}>Agreed return slots are shown against each item above (legacy default: {data.agreedReturnTime} London time). Actual return: {dateTime(data.actualReturnedAt)} London time.</Text> : null}
        {data.lateWaived > 0 ? <Text style={s.note}>Late rental time waived: {gbp(data.lateWaived)}.</Text> : null}
        {data.lateBreakdown.map((line, i) => <Text key={i} style={s.note}>{line.title}: {line.days} extra day{line.days === 1 ? "" : "s"} × {gbp(line.dailyRate)} = {gbp(line.amount)}</Text>)}
        <Text style={s.note}>{data.securityPolicyVersion==="2026-10-refundable-assessment-v2"?`Refundable deposit paid ${gbp(data.securityPaid)}. Retained deposit ${gbp(data.damageTotal)} is deducted from the same evidenced assessment. Later card payments require an itemised notice and administrator approval. Unused deposit is refunded to the original card.`:data.savedCardLimit!==undefined&&data.securityPaid>0?`Refundable cash deposit paid: ${gbp(data.securityPaid)}. Retained deposit reduces the same assessed damage and combined saved-card limit; ${gbp(Math.max(0,data.savedCardLimit-data.damageTotal))} remains available for later damage/late-fee collection. No additional card hold was created. ${data.depositRefundState==="failed"?"The unresolved original-card refund requires provider review.":data.depositRefundState==="pending"?"The original-card refund is processing at the bank.":""}`:data.savedCardLimit!==undefined?"No security payment or card hold was created. This return statement does not execute a damage or late-fee payment; any collection requires a separate itemised notice, seven-day dispute period and administrator approval.":(draft ? "Expected hold status after settlement" : "Card hold status at return")+": "+(data.holdStatus || "not recorded")+". "+(data.damageTotal > 0 ? "The damage deduction used the hold first; a separate late charge is not taken from that same hold." : "An unused active hold may be applied to a late charge after notice; the issuer controls expiry.")}</Text>
        <Text style={s.note}>Db Cinema Rentals is not VAT registered. No VAT is charged. This return statement is not a VAT invoice.</Text>
      </View>
    </Page>
  </Document>;
}
