import { StyleSheet, Font } from "@react-pdf/renderer";

// @react-pdf/renderer needs its own font registration — it can't use
// next/font. Times-Roman/Helvetica are built in and avoid a network fetch
// at render time (important inside a serverless function).
Font.registerHyphenationCallback((word) => [word]);

export const BRAND = {
  navy: "#0D1B3E",
  steel: "#3E76B0",
  teal: "#4FD1C5",
  gold: "#C8952A",
  statusRed: "#C24444",
  border: "#E2E8F0",
  muted: "#5B6B85",
};

export const pdfStyles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: BRAND.navy },
  header: { marginBottom: 16, borderBottom: `2 solid ${BRAND.navy}`, paddingBottom: 10 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: BRAND.navy },
  subtitle: { fontSize: 10, color: BRAND.muted, marginTop: 2 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", color: BRAND.steel, marginBottom: 6, textTransform: "uppercase" },
  bodyText: { fontSize: 10, lineHeight: 1.5 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottom: `1 solid ${BRAND.border}` },
  rowLabel: { color: BRAND.muted },
  rowValue: { fontFamily: "Helvetica-Bold" },
  table: { marginTop: 4 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: BRAND.navy, paddingVertical: 4, paddingHorizontal: 4 },
  tableHeaderCell: { color: "#FFFFFF", fontSize: 9, fontFamily: "Helvetica-Bold", flex: 1 },
  tableRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 4, borderBottom: `1 solid ${BRAND.border}` },
  tableCell: { fontSize: 9, flex: 1 },
  flagged: { color: BRAND.statusRed, fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 8, color: BRAND.muted, textAlign: "center" },
});

export function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
