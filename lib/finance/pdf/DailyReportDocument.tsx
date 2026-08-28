import { Document, Page, View, Text } from "@react-pdf/renderer";
import { pdfStyles, formatUsd } from "./styles";
import type { DailySnapshot } from "@/lib/finance/reports";

export function DailyReportDocument({ snapshot }: { snapshot: DailySnapshot }) {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <View style={pdfStyles.header}>
          <Text style={pdfStyles.title}>Dokuma — Daily Finance Report</Text>
          <Text style={pdfStyles.subtitle}>{snapshot.date}</Text>
        </View>

        <View style={pdfStyles.section}>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.rowLabel}>Opening Balance</Text>
            <Text style={pdfStyles.rowValue}>{formatUsd(snapshot.openingBalance)}</Text>
          </View>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.rowLabel}>Transactions In</Text>
            <Text style={pdfStyles.rowValue}>{formatUsd(snapshot.transactionsIn)}</Text>
          </View>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.rowLabel}>Transactions Out</Text>
            <Text style={pdfStyles.rowValue}>{formatUsd(snapshot.transactionsOut)}</Text>
          </View>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.rowLabel}>Closing Balance</Text>
            <Text style={pdfStyles.rowValue}>{formatUsd(snapshot.closingBalance)}</Text>
          </View>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Flagged Unusual Transactions</Text>
          {snapshot.unusualTransactions.length === 0 ? (
            <Text style={pdfStyles.bodyText}>None — no transaction today exceeded 2x the account&apos;s 30-day average.</Text>
          ) : (
            <View style={pdfStyles.table}>
              <View style={pdfStyles.tableHeaderRow}>
                <Text style={pdfStyles.tableHeaderCell}>Type</Text>
                <Text style={pdfStyles.tableHeaderCell}>Amount</Text>
                <Text style={pdfStyles.tableHeaderCell}>Category</Text>
                <Text style={pdfStyles.tableHeaderCell}>Counterparty</Text>
              </View>
              {snapshot.unusualTransactions.map((t) => (
                <View key={t.id} style={pdfStyles.tableRow}>
                  <Text style={pdfStyles.tableCell}>{t.type}</Text>
                  <Text style={[pdfStyles.tableCell, pdfStyles.flagged]}>{formatUsd(t.amount)}</Text>
                  <Text style={pdfStyles.tableCell}>{t.category ?? "—"}</Text>
                  <Text style={pdfStyles.tableCell}>{t.counterparty ?? "—"}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <Text style={pdfStyles.footer} fixed>
          Dokuma Command Centre — generated {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC
        </Text>
      </Page>
    </Document>
  );
}
