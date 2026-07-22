import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../../shared/database/createModel.js";
import { activeProcessingJobStatusValues } from "../../../shared/contracts.js";

const processingJobSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadMetadataId: { type: String, default: null },
    triggeredById: { type: String, required: true },
    jobType: {
      type: String,
      enum: [
        "evidence_processing",
        "dataset_interpretation",
        "dataset_review",
        "metrics_generation",
        "dashboard_generation",
        "insight_generation",
        "report_generation",
        "chat",
        "other",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "queued",
        "processing",
        "awaiting_privacy_review",
        "transforming",
        "completed",
        "failed",
        "cancelled",
      ],
      default: "queued",
    },
    payload: { type: Schema.Types.Mixed, default: null },
    errorMessage: { type: String, default: null },
    leaseOwner: { type: String, default: null, index: true },
    leaseExpiresAt: { type: Date, default: null, index: true },
    lastHeartbeatAt: { type: Date, default: null },
    attemptCount: { type: Number, required: true, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: null, index: true },
    failureCode: { type: String, default: null },
    maxAttempts: { type: Number, required: true, default: 3, min: 1 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    // Physical collection name kept as-is (renaming would require a data
    // migration on any environment with existing documents).
    collection: "ai_executions",
    timestamps: true,
  },
);

// Enforces "only one active processing job per evidence version" at the
// database level — the application-level check in EvidenceProcessingService
// is a fast-path for a friendly error, not the real guarantee. The partial
// filter only applies to documents with a real uploadMetadataId (evidence
// processing jobs), so other job types with uploadMetadataId: null never
// collide with each other or with this constraint.
processingJobSchema.index(
  { uploadMetadataId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      uploadMetadataId: { $type: "string" },
      status: { $in: [...activeProcessingJobStatusValues] },
    },
  },
);

processingJobSchema.index({
  jobType: 1,
  status: 1,
  nextAttemptAt: 1,
  leaseExpiresAt: 1,
  createdAt: 1,
});

export type ProcessingJobMongoDocument = InferSchemaType<
  typeof processingJobSchema
>;
export type ProcessingJobMongoHydratedDocument =
  HydratedDocument<ProcessingJobMongoDocument>;
export const ProcessingJobMongoModel = createModel(
  "ProcessingJob",
  processingJobSchema,
);
