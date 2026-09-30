import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

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
  lineItems: { title: string; start: number; end: number; qty: number; lineTotal: number }[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  creditApplied: number;
  depositAmount: number;
  total: number;
  promoCode: string | null;
  returnStatement?: ReturnStatementData | null;
};

export type ReturnStatementData = {
  number: string; issuedAt: number; actualReturnedAt: number;
  agreedReturnTime?: string;
  supplierName: string; supplierAddress?: string;
  customerName?: string; customerEmail: string; billingAddress?: string;
  lineItems: { title: string; start: number; end: number; qty: number; lineTotal: number }[];
  subtotal: number; discount: number; deliveryFee: number; creditApplied: number;
  checkoutPaid: number; securityPaid: number; securityRefunded: number;
  holdStatus?: string; damageTotal: number; damageFromHold: number; damageNote?: string;
  lateAssessed: number; lateWaived: number;
  lateBreakdown: { title: string; days: number; dailyRate: number; amount: number }[];
};

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
  cItem: { width: "46%" },
  cDates: { width: "30%", color: C.muted },
  cQty: { width: "10%", textAlign: "center", color: C.muted },
  cAmt: { width: "14%", textAlign: "right" },
  totals: { marginTop: 18, marginLeft: "auto", width: "46%" },
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
            <Text style={s.meta}>Status: {data.status}</Text>
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
              <Text style={s.strong}>{data.supplierName ?? "Db Cinema Rentals"}</Text>
              {data.supplierAddress ? <Text>{data.supplierAddress}</Text> : null}
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
            <Text style={s.cDates}>{d(li.start)} – {d(li.end)}</Text>
            <Text style={s.cQty}>{li.qty}</Text>
            <Text style={s.cAmt}>{gbp(li.lineTotal)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.totRow}><Text style={{ color: C.muted }}>Subtotal</Text><Text>{gbp(data.subtotal)}</Text></View>
          {data.discount > 0 ? (
            <View style={s.totRow}><Text style={{ color: C.muted }}>Discount{data.promoCode ? ` (${data.promoCode})` : ""}</Text><Text>−{gbp(data.discount)}</Text></View>
          ) : null}
          {data.creditApplied > 0 ? (
            <View style={s.totRow}><Text style={{ color: C.muted }}>Store credit</Text><Text>−{gbp(data.creditApplied)}</Text></View>
          ) : null}
          {data.deliveryFee > 0 ? (
            <View style={s.totRow}><Text style={{ color: C.muted }}>Delivery</Text><Text>{gbp(data.deliveryFee)}</Text></View>
          ) : null}
          <View style={s.grand}><Text style={s.grandTxt}>Total paid</Text><Text style={s.grandTxt}>{gbp(data.total)}</Text></View>
          {data.depositAmount > 0 ? (
            <Text style={s.note}>Includes {gbp(data.depositAmount)} refundable deposit, returned after the gear is back in good condition.</Text>
          ) : null}
          <Text style={s.note}>Db Cinema Rentals is not VAT registered. No VAT is charged. This receipt is not a VAT invoice.</Text>
        </View>

        <Text style={s.footer}>
          Db Cinema Rentals · dbcinemarentals.com · dbcinemarentals@gmail.com{"\n"}
          Thank you for renting with us.
        </Text>
      </Page>
    </Document>
  );
}

export function ReturnStatementDocument({ data }: { data: ReturnStatementData }) {
  const rentalGross = data.subtotal - data.discount + data.deliveryFee;
  const damageFromPayment = Math.max(0, data.damageTotal - data.damageFromHold);
  const netCardPaid = data.checkoutPaid - data.securityRefunded + data.damageFromHold;
  return <Document title={`Db Cinema Return Statement ${data.number}`}>
    <Page size="A4" style={s.page}>
      <View style={s.topbar} />
      <View style={s.headRow}>
        <View><Text style={s.brand}>DB CINEMA</Text><Text style={s.brandSub}>RENTALS · LONDON</Text></View>
        <View><Text style={s.docTitle}>RETURN STATEMENT</Text><Text style={s.meta}>{data.number}</Text><Text style={s.meta}>Issued {d(data.issuedAt)}</Text><Text style={s.meta}>Returned {dateTime(data.actualReturnedAt)} London time</Text></View>
      </View>
      <View style={s.section}>
        <View style={s.billRow}>
          <View style={s.col}>
            <Text style={s.label}>Supplier</Text><Text style={s.strong}>{data.supplierName}</Text>
            {data.supplierAddress ? <Text>{data.supplierAddress}</Text> : null}
            <Text>dbcinemarentals@gmail.com</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>Renter</Text><Text style={s.strong}>{data.customerName || data.customerEmail}</Text>
            <Text>{data.customerEmail}</Text>{data.billingAddress ? <Text>{data.billingAddress}</Text> : null}
          </View>
        </View>
      </View>
      <View style={s.tHead}><Text style={[s.cItem, s.strong]}>Rental item</Text><Text style={[s.cDates, s.strong]}>Dates</Text><Text style={[s.cQty, s.strong]}>Qty</Text><Text style={[s.cAmt, s.strong]}>Charge</Text></View>
      {data.lineItems.map((line, i) => <View style={s.tRow} key={i}>
        <Text style={s.cItem}>{line.title}</Text><Text style={s.cDates}>{d(line.start)} – {d(line.end)}</Text><Text style={s.cQty}>{line.qty}</Text><Text style={s.cAmt}>{gbp(line.lineTotal)}</Text>
      </View>)}
      <View style={s.totals}>
        <View style={s.totRow}><Text>Rental subtotal</Text><Text>{gbp(data.subtotal)}</Text></View>
        {data.discount > 0 ? <View style={s.totRow}><Text>Rental discount</Text><Text>−{gbp(data.discount)}</Text></View> : null}
        {data.deliveryFee > 0 ? <View style={s.totRow}><Text>Delivery</Text><Text>{gbp(data.deliveryFee)}</Text></View> : null}
        <View style={s.grand}><Text style={s.grandTxt}>Rental charges</Text><Text style={s.grandTxt}>{gbp(rentalGross)}</Text></View>
        {data.creditApplied > 0 ? <View style={s.totRow}><Text>Store credit used</Text><Text>−{gbp(data.creditApplied)}</Text></View> : null}
        <View style={s.totRow}><Text>Refundable security payment taken</Text><Text>{gbp(data.securityPaid)}</Text></View>
        <View style={s.totRow}><Text>Card charged at checkout</Text><Text>{gbp(data.checkoutPaid)}</Text></View>
        <View style={s.totRow}><Text>Security payment refunded at return</Text><Text>−{gbp(data.securityRefunded)}</Text></View>
        {data.damageTotal > 0 ? <View style={s.totRow}><Text>Documented damage/loss retained</Text><Text>{gbp(data.damageTotal)}</Text></View> : null}
        {data.damageTotal > 0 ? <Text style={s.note}>Damage paid from authorised hold: {gbp(data.damageFromHold)}. From refundable security payment: {gbp(damageFromPayment)}. These are parts of the same deduction.</Text> : null}
        <View style={s.grand}><Text style={s.grandTxt}>Net card paid after return</Text><Text style={s.grandTxt}>{gbp(netCardPaid)}</Text></View>
        <Text style={s.note}>Checkout card charge, less the security refund, plus any hold captured for damage. Store credit used: {gbp(data.creditApplied)}. Separate late time is excluded and may be collected later.</Text>
        {data.damageNote ? <Text style={s.note}>Damage/loss detail: {data.damageNote}</Text> : null}
        {data.lateAssessed > 0 ? <Text style={s.note}>Separate late rental time assessed: {gbp(data.lateAssessed)}. Pending itemised notice, seven-day dispute period and later collection; it is not included in the checkout payment or damage deduction.</Text> : null}
        {data.agreedReturnTime ? <Text style={s.note}>Agreed item return slot: {data.agreedReturnTime} London time on each booked end date. Actual return: {dateTime(data.actualReturnedAt)} London time.</Text> : null}
        {data.lateWaived > 0 ? <Text style={s.note}>Late rental time waived: {gbp(data.lateWaived)}.</Text> : null}
        {data.lateBreakdown.map((line, i) => <Text key={i} style={s.note}>{line.title}: {line.days} extra day{line.days === 1 ? "" : "s"} × {gbp(line.dailyRate)} = {gbp(line.amount)}</Text>)}
        <Text style={s.note}>Card hold status at return: {data.holdStatus || "not recorded"}. {data.damageTotal > 0 ? "The damage deduction used the hold first; a separate late charge is not taken from that same hold." : "An unused active hold may be applied to a late charge after notice; the issuer controls expiry."}</Text>
        <Text style={s.note}>Db Cinema Rentals is not VAT registered. No VAT is charged. This return statement is not a VAT invoice.</Text>
      </View>
    </Page>
  </Document>;
}
