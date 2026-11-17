import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { CONTACT_EMAIL } from "../site";

export type SwapAdjustmentDocumentData = {
  documentType: "supplementary_invoice" | "credit_note" | "account_adjustment";
  documentNumber: string;
  issuedAt: number;
  originalInvoiceNumber: string;
  rentalReference: string;
  customerName: string | null;
  customerEmail: string | null;
  currency: "GBP";
  changes: {
    oldTitle: string;
    newTitle: string;
    oldQty: number;
    newQty: number;
    oldLineTotalPence: number;
    newLineTotalPence: number;
  }[];
  cardChargePence: number;
  cardRefundPence: number;
  accountCreditRestoredPence: number;
};

const COMPANY_NAME = "DB CINEMA RENTALS LTD";
const COMPANY_ADDRESS = ["The Grand Building", "Trafalgar Square", "London", "WC2N 5EJ"];
const colors = { ink: "#1a1a1a", muted: "#686868", line: "#e6e6e6", accent: "#c58a45", soft: "#faf6ef" };
const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 58, paddingHorizontal: 48, fontSize: 10, color: colors.ink, fontFamily: "Helvetica" },
  accent: { height: 4, backgroundColor: colors.accent, marginBottom: 24, borderRadius: 2 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  brandSub: { fontSize: 8, color: colors.muted, marginTop: 2, letterSpacing: 2 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", color: colors.accent, textAlign: "right", maxWidth: 250 },
  meta: { fontSize: 9, color: colors.muted, textAlign: "right", marginTop: 4 },
  parties: { flexDirection: "row", justifyContent: "space-between", marginTop: 28 },
  party: { width: "48%" },
  label: { fontSize: 8, color: colors.muted, letterSpacing: 1, marginBottom: 5, textTransform: "uppercase" },
  strong: { fontFamily: "Helvetica-Bold" },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 28, marginBottom: 7 },
  tableHead: { flexDirection: "row", backgroundColor: colors.soft, paddingVertical: 7, paddingHorizontal: 7 },
  tableRow: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 7, borderBottomWidth: 1, borderBottomColor: colors.line },
  equipment: { width: "34%", paddingRight: 8 },
  qty: { width: "10%", textAlign: "center", color: colors.muted },
  previous: { width: "26%", paddingRight: 6, textAlign: "right" },
  updated: { width: "30%", textAlign: "right" },
  heading: { fontSize: 8, color: colors.muted, fontFamily: "Helvetica-Bold" },
  totals: { width: "54%", marginTop: 18, marginLeft: "auto" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.line },
  totalLabel: { maxWidth: "75%", paddingRight: 8 },
  totalValue: { flexShrink: 0, textAlign: "right", fontFamily: "Helvetica-Bold" },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, marginTop: 5, borderTopWidth: 2, borderTopColor: colors.ink },
  grandText: { fontSize: 12, fontFamily: "Helvetica-Bold", maxWidth: "75%", paddingRight: 8 },
  grandValue: { fontSize: 12, fontFamily: "Helvetica-Bold", flexShrink: 0 },
  note: { marginTop: 12, fontSize: 8, color: colors.muted, lineHeight: 1.45 },
  footer: { position: "absolute", bottom: 32, left: 48, right: 48, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, fontSize: 8, color: colors.muted, textAlign: "center" },
});

const pounds = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (ms: number) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).format(new Date(ms));

const titleFor = (kind: SwapAdjustmentDocumentData["documentType"]) => kind === "supplementary_invoice"
  ? "SUPPLEMENTARY INVOICE"
  : kind === "credit_note" ? "CREDIT NOTE" : "ACCOUNT CREDIT ADJUSTMENT";

export function SwapAdjustmentDocument({ data }: { data: SwapAdjustmentDocumentData }) {
  const isInvoice = data.documentType === "supplementary_invoice";
  const isCreditNote = data.documentType === "credit_note";
  const settlementAmount = isInvoice ? data.cardChargePence : isCreditNote ? data.cardRefundPence : 0;
  const settlementLabel = isInvoice ? "Additional card payment received" : isCreditNote ? "Refund to original payment method" : "No card payment or refund";
  const settlementTitle = isInvoice ? "Amount paid" : isCreditNote ? "Credit note total" : "Account credit restored";

  return (
    <Document title={`DB Cinema ${titleFor(data.documentType)} ${data.documentNumber}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.accent} />
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>DB CINEMA</Text>
            <Text style={styles.brandSub}>RENTALS · LONDON</Text>
          </View>
          <View>
            <Text style={styles.title}>{titleFor(data.documentType)}</Text>
            <Text style={styles.meta}>Document no. {data.documentNumber}</Text>
            <Text style={styles.meta}>Issued {date(data.issuedAt)}</Text>
            <Text style={styles.meta}>Rental {data.rentalReference}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.label}>Billed to</Text>
            {data.customerName ? <Text style={styles.strong}>{data.customerName}</Text> : null}
            {data.customerEmail ? <Text>{data.customerEmail}</Text> : null}
          </View>
          <View style={styles.party}>
            <Text style={styles.label}>Supplier</Text>
            <Text style={styles.strong}>{COMPANY_NAME}</Text>
            {COMPANY_ADDRESS.map((line) => <Text key={line}>{line}</Text>)}
            <Text>{CONTACT_EMAIL}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Equipment changed</Text>
        <View style={styles.tableHead}>
          <Text style={[styles.equipment, styles.heading]}>Previous item</Text>
          <Text style={[styles.qty, styles.heading]}>Qty</Text>
          <Text style={[styles.previous, styles.heading]}>Previous line</Text>
          <Text style={[styles.updated, styles.heading]}>Updated item and line</Text>
        </View>
        {data.changes.map((change, index) => (
          <View style={styles.tableRow} key={`${change.oldTitle}-${change.newTitle}-${index}`}>
            <Text style={styles.equipment}>{change.oldTitle}</Text>
            <Text style={styles.qty}>{change.oldQty} → {change.newQty}</Text>
            <Text style={styles.previous}>{pounds(change.oldLineTotalPence)}</Text>
            <Text style={styles.updated}>{change.newTitle}{"\n"}{pounds(change.newLineTotalPence)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          {settlementAmount > 0 ? (
            <View style={styles.grand}>
              <Text style={styles.grandText}>{settlementTitle}</Text>
              <Text style={styles.grandValue}>{pounds(settlementAmount)}</Text>
            </View>
          ) : (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{settlementLabel}</Text>
              <Text style={styles.totalValue}>£0.00</Text>
            </View>
          )}
          {data.accountCreditRestoredPence > 0 ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Account credit restored separately</Text>
              <Text style={styles.totalValue}>{pounds(data.accountCreditRestoredPence)}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.note}>This document records the accepted equipment change for original invoice {data.originalInvoiceNumber}. The original rental invoice remains unchanged. Equipment line values show the previous and updated rental lines; any discounts and account credit are reflected in the settlement amount above.</Text>
        {isCreditNote ? <Text style={styles.note}>The credit note records a refund to the original payment method. Your bank controls when that refund appears.</Text> : null}
        {data.accountCreditRestoredPence > 0 ? <Text style={styles.note}>Restored account credit is held on your DB Cinema account and is separate from any card payment or refund shown here.</Text> : null}
        <Text style={styles.note}>DB Cinema Rentals Ltd is not VAT registered. No VAT is charged.</Text>
        <Text style={styles.footer}>Keep this adjustment with rental invoice {data.originalInvoiceNumber}.</Text>
      </Page>
    </Document>
  );
}
