import { Document, Page, View, Text } from "@react-pdf/renderer";
import { pdfStyles, formatUsd } from "./styles";

export type PaymentNoticeData = {
  period: string;
  payee: string;
  amount: number;
  due_date: string;
  status: string;
  notes: string | null;
};

export function PaymentNoticeDocument({ notice }: { notice: PaymentNoticeData }) {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <View style={pdfStyles.header}>
          <Text style={pdfStyles.title}>Dokuma — Payment Notice</Text>
          <Text style={pdfStyles.subtitle}>Period: {notice.period}</Text>
        </View>

        <View style={pdfStyles.section}>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.rowLabel}>Payee</Text>
            <Text style={pdfStyles.rowValue}>{notice.payee}</Text>
          </View>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.rowLabel}>Amount</Text>
            <Text style={pdfStyles.rowValue}>{formatUsd(notice.amount)}</Text>
          </View>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.rowLabel}>Due Date</Text>
            <Text style={pdfStyles.rowValue}>{notice.due_date}</Text>
          </View>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.rowLabel}>Status</Text>
            <Text style={pdfStyles.rowValue}>{notice.status}</Text>
          </View>
        </View>

        {notice.notes && (
          <View style={pdfStyles.section}>
            <Text style={pdfStyles.sectionTitle}>Notes</Text>
            <Text style={pdfStyles.bodyText}>{notice.notes}</Text>
          </View>
        )}

        <Text style={pdfStyles.footer} fixed>
          Dokuma Command Centre — generated {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC
        </Text>
      </Page>
    </Document>
  );
}
