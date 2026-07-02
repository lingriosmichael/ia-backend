import {
  activityStatusValues,
  processingJobStatusValues,
  processingJobTypeValues,
  projectStatusValues,
  resultRecordStatusValues,
  resultRecordTypeValues,
  uploadMetadataStatusValues,
} from "../shared/contracts.js";
import { z } from "zod";

const jsonPayloadSchema = z.record(z.string(), z.unknown());
const monthValueSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .optional();
const dateValueSchema = z.string().datetime({ offset: true }).optional();
const stringArraySchema = z.array(z.string().trim().min(1).max(120)).max(20).optional();

export const idParamSchema = z.object({
  organizationId: z.string().min(1).optional(),
  membershipId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  activityId: z.string().min(1).optional(),
  uploadMetadataId: z.string().min(1).optional(),
  processingJobId: z.string().min(1).optional(),
  resultRecordId: z.string().min(1).optional(),
  invitationId: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
});

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export const createInvitationSchema = z.object({
  email: z.string().trim().email(),
  role: z.literal("PROJECT_MANAGER"),
});

export const acceptInvitationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(128),
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  mission: z.string().trim().max(2000).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  programGoal: z.string().trim().max(2000).optional(),
  startMonth: monthValueSchema,
  endMonth: monthValueSchema,
  country: z.string().trim().max(120).optional(),
  regionCity: z.string().trim().max(120).optional(),
  sdgs: stringArraySchema,
  targetBeneficiaries: stringArraySchema,
  fundingSource: z.string().trim().max(200).optional(),
  status: z.enum(projectStatusValues).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  programGoal: z.string().trim().max(2000).nullable().optional(),
  startMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
  endMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  regionCity: z.string().trim().max(120).nullable().optional(),
  sdgs: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  targetBeneficiaries: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  fundingSource: z.string().trim().max(200).nullable().optional(),
  status: z.enum(projectStatusValues).optional(),
});

export const deleteProjectSchema = z.object({
  projectName: z.string().min(1).max(120),
});

export const createActivitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  activityType: z.string().trim().max(120).optional(),
  owner: z.string().trim().max(120).optional(),
  startDate: dateValueSchema,
  endDate: dateValueSchema,
  objectives: z.string().trim().max(2000).optional(),
  expectedOutcomes: z.string().trim().max(2000).optional(),
  successIndicators: z.string().trim().max(2000).optional(),
  targetAudience: z.string().trim().max(2000).optional(),
  additionalContext: z.string().trim().max(2000).optional(),
  beneficiaryGroup: z.string().trim().max(2000).optional(),
  status: z.enum(activityStatusValues).optional(),
});

export const updateActivitySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  activityType: z.string().trim().max(120).nullable().optional(),
  owner: z.string().trim().max(120).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  objectives: z.string().trim().max(2000).nullable().optional(),
  expectedOutcomes: z.string().trim().max(2000).nullable().optional(),
  successIndicators: z.string().trim().max(2000).nullable().optional(),
  targetAudience: z.string().trim().max(2000).nullable().optional(),
  additionalContext: z.string().trim().max(2000).nullable().optional(),
  beneficiaryGroup: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(activityStatusValues).optional(),
});

export const createUploadMetadataSchema = z.object({
  activityId: z.string().min(1).nullable().optional(),
  originalFileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  storageKey: z.string().trim().min(1).max(512).optional(),
});

export const updateUploadMetadataSchema = z.object({
  contentType: z.string().trim().min(1).max(255).nullable().optional(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  storageKey: z.string().trim().min(1).max(512).nullable().optional(),
  status: z.enum(uploadMetadataStatusValues).optional(),
});

export const createProcessingJobSchema = z.object({
  activityId: z.string().min(1).nullable().optional(),
  uploadMetadataId: z.string().min(1).nullable().optional(),
  jobType: z.enum(processingJobTypeValues),
  payload: jsonPayloadSchema.optional(),
});

export const updateProcessingJobSchema = z.object({
  status: z.enum(processingJobStatusValues).optional(),
  payload: jsonPayloadSchema.nullable().optional(),
  errorMessage: z.string().trim().max(4000).nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
});

export const createResultRecordSchema = z.object({
  activityId: z.string().min(1).nullable().optional(),
  uploadMetadataId: z.string().min(1).nullable().optional(),
  processingJobId: z.string().min(1).nullable().optional(),
  resultType: z.enum(resultRecordTypeValues),
  payload: jsonPayloadSchema.optional(),
});

export const updateResultRecordSchema = z.object({
  status: z.enum(resultRecordStatusValues).optional(),
  payload: jsonPayloadSchema.nullable().optional(),
});
