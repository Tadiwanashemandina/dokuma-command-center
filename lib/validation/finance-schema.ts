import { z } from "zod";

export const createTransactionSchema = z.object({
  account_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  type: z.enum(["debit", "credit"]),
  amount: z.coerce.number().positive(),
  category: z.string().trim().max(200).optional().nullable(),
  counterparty: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  reference_no: z.string().trim().max(200).optional().nullable(),
  is_dlap: z.coerce.boolean().optional().default(false),
  dlap_share_pct: z.coerce.number().min(0).max(100).optional().nullable(),
});
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const reverseTransactionSchema = z.object({
  transaction_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required for every reversal").max(1000),
});

export const createCreditorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  amount_owed: z.coerce.number().positive(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(["outstanding", "partially_paid", "paid"]).optional().default("outstanding"),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const createPaymentNoticeSchema = z.object({
  period: z.string().trim().min(1).max(50),
  payee: z.string().trim().min(1).max(200),
  amount: z.coerce.number().positive(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["scheduled", "sent", "paid"]).optional().default("scheduled"),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const weeklyReportFreeTextSchema = z.object({
  executive_summary: z.string().trim().max(5000),
  key_advancements: z.string().trim().max(5000),
  challenges: z.string().trim().max(5000),
  next_week_plan: z.string().trim().max(5000),
});

export const monthlyReportFreeTextSchema = z.object({
  executive_summary: z.string().trim().max(5000),
  key_advancements: z.string().trim().max(5000),
  challenges: z.string().trim().max(5000),
  next_month_plan: z.string().trim().max(5000),
});
