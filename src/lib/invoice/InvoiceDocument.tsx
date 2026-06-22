import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export type InvoiceData = {
  number: string;
  issuedAt: number;
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
};

const gbp = (n: number) => `£${(Math.round(n * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
const d = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).format(new Date(ms));

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
              <Text style={s.label}>Fulfilment</Text>
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
        </View>

        <Text style={s.footer}>
          Db Cinema Rentals · dbcinemarentals.com · dbcinemaproductions@gmail.com{"\n"}
          Thank you for renting with us.
        </Text>
      </Page>
    </Document>
  );
}
