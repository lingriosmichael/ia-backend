import {
  activityStatusValues,
  projectStatusValues,
  resultRecordStatusValues,
  resultRecordTypeValues,
} from "../shared/contracts.js";
import { z } from "zod";

const jsonPayloadSchema = z.record(z.string(), z.unknown());
const monthValueSchema = z.string().regex(/^\d{4}-\d{2}$/);
const dateValueSchema = z.string().datetime({ offset: true }).optional();
const dateOnlyValueSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stringArraySchema = z
  .array(z.string().trim().min(1).max(120))
  .max(20)
  .optional();
const nullableTextFieldSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .optional();
const privacyReviewDecisionValueSchema = z.enum(["approved", "rejected"]);

export const idParamSchema = z.object({
  organizationId: z.string().min(1).optional(),
  membershipId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  activityId: z.string().min(1).optional(),
  uploadMetadataId: z.string().min(1).optional(),
  evidenceId: z.string().min(1).optional(),
  processingJobId: z.string().min(1).optional(),
  resultRecordId: z.string().min(1).optional(),
  interpretationResultId: z.string().min(1).optional(),
  questionId: z.string().min(1).optional(),
  indicatorId: z.string().min(1).optional(),
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
  fullName: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(8).max(128).optional(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  mission: nullableTextFieldSchema,
  settings: z
    .object({
      organizationName: z.string().trim().min(2).max(120).optional(),
      legalForm: z.string().trim().max(120).nullable().optional(),
      foundingYear: z.number().int().min(1800).max(3000).nullable().optional(),
      country: z.string().trim().max(120).nullable().optional(),
      employeeCount: z.number().int().min(0).max(1000000).nullable().optional(),
      mission: nullableTextFieldSchema,
      activityAreas: z
        .array(z.string().trim().min(1).max(120))
        .max(20)
        .optional(),
      targetGroups: z
        .array(z.string().trim().min(1).max(120))
        .max(20)
        .optional(),
      operatingRegions: z
        .array(z.string().trim().min(1).max(120))
        .max(20)
        .optional(),
      isRecognizedNonProfit: z.boolean().nullable().optional(),
      taxExemptionValidFrom: dateOnlyValueSchema.nullable().optional(),
    })
    .optional(),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  startMonth: monthValueSchema,
  endMonth: monthValueSchema,
  fundingProgram: z.string().trim().min(2).max(200),
  fundingOrganization: z.string().trim().min(2).max(200),
  targetGroups: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  areaOfOperation: z.string().trim().min(2).max(2000),
  partnerships: z.string().trim().max(2000).optional(),
  sdgs: stringArraySchema,
  impactModel: z.object({
    inputs: z.string().trim().min(2).max(2000),
    activities: z.string().trim().min(2).max(2000),
    outputs: z.string().trim().min(2).max(2000),
    impact: z.string().trim().min(2).max(2000),
    outcomes: z.string().trim().min(2).max(2000),
  }),
  successIndicators: z.string().trim().min(2).max(2000),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  startMonth: monthValueSchema.nullable().optional(),
  endMonth: monthValueSchema.nullable().optional(),
  fundingProgram: z.string().trim().max(200).nullable().optional(),
  fundingOrganization: z.string().trim().max(200).nullable().optional(),
  targetGroups: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  areaOfOperation: z.string().trim().max(2000).nullable().optional(),
  partnerships: z.string().trim().max(2000).nullable().optional(),
  sdgs: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  impactModel: z
    .object({
      inputs: z.string().trim().max(2000).nullable().optional(),
      activities: z.string().trim().max(2000).nullable().optional(),
      outputs: z.string().trim().max(2000).nullable().optional(),
      impact: z.string().trim().max(2000).nullable().optional(),
      outcomes: z.string().trim().max(2000).nullable().optional(),
    })
    .optional(),
  successIndicators: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(projectStatusValues).optional(),
});

export const deleteProjectSchema = z.object({
  projectName: z.string().min(1).max(120),
});

export const transferProjectOwnershipSchema = z.object({
  newOwnerId: z.string().min(1),
});

export const createActivitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  activityType: z.string().trim().max(120).optional(),
  owner: z.string().trim().max(120).optional(),
  startDate: dateValueSchema,
  endDate: dateValueSchema,
  objectives: z.string().trim().max(2000).optional(),
  successIndicators: z.string().trim().max(2000).optional(),
  targetAudience: z.string().trim().max(2000).optional(),
  additionalContext: z.string().trim().max(2000).optional(),
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
  successIndicators: z.string().trim().max(2000).nullable().optional(),
  targetAudience: z.string().trim().max(2000).nullable().optional(),
  additionalContext: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(activityStatusValues).optional(),
});

export const approvePrivacyReviewSchema = z.object({
  decisions: z
    .object({
      // Every entity type can require a decision now, not just free-text
      // risk/special-category — see privacy_tools.py's _recommended_action.
      // decidedById/decidedAt are deliberately not accepted here: the
      // server stamps those itself from the authenticated caller, never
      // trusting a client-supplied identity or timestamp.
      fieldDecisions: z
        .array(
          z.object({
            field: z.string().trim().min(1).max(255),
            entityType: z.string().trim().min(1).max(120),
            decision: privacyReviewDecisionValueSchema,
          }),
        )
        .max(200)
        .optional(),
    })
    .optional(),
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

export const answerInterpretationQuestionSchema = z.object({
  answeredValue: z.string().trim().min(1).max(2000),
});

export const setIndicatorStatusSchema = z.object({
  status: z.enum(["kept", "rejected"]),
});

export const startInterpretationSchema = z.object({
  language: z.enum(["de", "en"]).default("de"),
});

export const processingJobCallbackSchema = z.object({
  externalJobId: z.string().min(1),
  status: z.enum([
    "accepted",
    "processing",
    "awaiting_privacy_review",
    "transforming",
    "completed",
    "failed",
    "cancelled",
  ]),
  updatedAt: z.string().min(1),
  errorMessage: z.string().nullable().optional(),
  details: jsonPayloadSchema.nullable().optional(),
});
