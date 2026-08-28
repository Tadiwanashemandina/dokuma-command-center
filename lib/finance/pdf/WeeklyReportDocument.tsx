import { Document, Page, View, Text } from "@react-pdf/renderer";
import { pdfStyles, formatUsd } from "./styles";
import type { PeriodReportData } from "@/lib/finance/reports";

export type WeeklyReportContent = PeriodReportData & {
  executive_summary: string;
  key_advancements: string;
  challenges: string;
  next_week_plan: string;
};

/** Renders the weekly report in the exact 10-section order specified. */
export function WeeklyReportDocument({ content }: { content: WeeklyReportContent }) {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <View style={pdfStyles.header}>
          <Text style={pdfStyles.title}>Dokuma — Weekly Finance Report</Text>
          <Text style={pdfStyles.subtitle}>
            {content.periodStart} to {content.periodEnd}
          </Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>1. Executive Summary</Text>
          <Text style={pdfStyles.bodyText}>{content.executive_summary || "—"}</Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>2. Opening Balance</Text>
          <Text style={pdfStyles.bodyText}>{formatUsd(content.openingBalance)}</Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>3. Current Balance</Text>
          <Text style={pdfStyles.bodyText}>{formatUsd(content.currentBalance)}</Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>4. DLAP Transactions and Dokuma&apos;s Share</Text>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.rowLabel}>Total DLAP Transaction Value ({content.dlap.transactionCount} transactions)</Text>
            <Text style={pdfStyles.rowValue}>{formatUsd(content.dlap.totalAmount)}</Text>
          </View>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.rowLabel}>Dokuma&apos;s Share</Text>
            <Text style={pdfStyles.rowValue}>{formatUsd(content.dlap.dokumaShare)}</Text>
          </View>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>5. Comparison with Previous Weeks</Text>
          {content.trend.map((t) => (
            <View key={t.label} style={pdfStyles.row}>
              <Text style={pdfStyles.rowLabel}>{t.label}</Text>
              <Text style={pdfStyles.rowValue}>{formatUsd(t.closingBalance)}</Text>
            </View>
          ))}
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>6. Creditors</Text>
          {content.creditors.length === 0 ? (
            <Text style={pdfStyles.bodyText}>No outstanding creditors.</Text>
          ) : (
            content.creditors.map((c) => (
              <View key={c.id} style={pdfStyles.row}>
                <Text style={pdfStyles.rowLabel}>
                  {c.name} ({c.status}){c.dueDate ? ` — due ${c.dueDate}` : ""}
                </Text>
                <Text style={pdfStyles.rowValue}>{formatUsd(c.amountOwed)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>7. Closing Balance</Text>
          <Text style={pdfStyles.bodyText}>{formatUsd(content.closingBalance)}</Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>8. Key Advancements</Text>
          <Text style={pdfStyles.bodyText}>{content.key_advancements || "—"}</Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>9. Challenges and How They Were Tackled</Text>
          <Text style={pdfStyles.bodyText}>{content.challenges || "—"}</Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>10. Next Week Plan</Text>
          <Text style={pdfStyles.bodyText}>{content.next_week_plan || "—"}</Text>
        </View>

        <Text style={pdfStyles.footer} fixed>
          Dokuma Command Centre — generated {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC
        </Text>
      </Page>
    </Document>
  );
}
