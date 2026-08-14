import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../../shared/database/createModel.js";
import { activeProcessingJobStatusValues } from "../../../shared/contracts.js";

const processingJobSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null },
    uploadMetadataId: { type: String, default: null },
    triggeredById: { type: String, required: true },
    jobType: {
      type: String,
      enum: [
        "workbook_split",
        "evidence_processing",
        "dataset_interpretation",
        "dataset_review",
        "metrics_generation",
        "dashboard_generation",
        "insight_generation",
        "report_generation",
        "chat",
        "other",
        "activity_analysis_v2",
        "qualitative_coding_review",
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

// General-purpose index backing listByActivity's `find({ activityId })`
// query across all job types/statuses. Declared explicitly (rather than via
// the field-level `index: true` shorthand) so it sits alongside, instead of
// duplicating, the more specific partial unique index below — Mongoose
// warns if the same field is indexed via both styles.
processingJobSchema.index({ activityId: 1 });

// Enforces "only one active V2 analysis run per activity" at the database
// level. Unlike the uploadMetadataId index above, this one is scoped to
// jobType: several other job types (workbook_split, evidence_processing,
// dataset_interpretation) legitimately populate activityId and run
// concurrently for the same activity, so an unscoped index here would break
// those flows. Keyed on {activityId, jobType} rather than {activityId}
// alone — the partial filter already pins jobType to a single value so this
// doesn't change the uniqueness semantics, but it keeps the key pattern
// distinct from the general activityId index above (Mongoose warns on two
// indexes sharing an identical key pattern, regardless of differing
// options).
processingJobSchema.index(
  { activityId: 1, jobType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      activityId: { $type: "string" },
      jobType: "activity_analysis_v2",
      status: { $in: [...activeProcessingJobStatusValues] },
    },
  },
);

export type ProcessingJobMongoDocument = InferSchemaType<
  typeof processingJobSchema
>;
export type ProcessingJobMongoHydratedDocument =
  HydratedDocument<ProcessingJobMongoDocument>;
export const ProcessingJobMongoModel = createModel(
  "ProcessingJob",
  processingJobSchema,
);
