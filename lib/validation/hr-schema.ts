import { z } from "zod";

export const submitLeaveRequestSchema = z.object({
  leave_type_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days_requested: z.coerce.number().positive(),
  reason: z.string().trim().min(1, "A reason is required").max(2000),
});

export const leaveDecisionSchema = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(2000).optional().nullable(),
});

export const createEmployeeTaskSchema = z.object({
  employee_id: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).optional().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export const createPerformanceReviewSchema = z.object({
  employee_id: z.string().uuid(),
  period: z.string().trim().min(1).max(100),
  goals: z.string().trim().max(4000).optional().default(""),
  rating: z.string().trim().max(50).optional().nullable(),
  comments: z.string().trim().max(4000).optional().nullable(),
  status: z.enum(["draft", "submitted", "acknowledged"]).optional().default("draft"),
});

export const createTrainingRecordSchema = z.object({
  employee_id: z.string().uuid(),
  course_name: z.string().trim().min(1).max(300),
  provider: z.string().trim().max(200).optional().nullable(),
  completed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export const createJobOpeningSchema = z.object({
  title: z.string().trim().min(1).max(200),
  department: z.string().trim().max(200).optional().nullable(),
});

export const createCandidateSchema = z.object({
  job_opening_id: z.string().uuid(),
  full_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().optional().or(z.literal("")).nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
});

export const updateApplicationStageSchema = z.object({
  application_id: z.string().uuid(),
  stage: z.enum(["applied", "shortlisted", "interview", "offer", "hired", "rejected"]),
});
