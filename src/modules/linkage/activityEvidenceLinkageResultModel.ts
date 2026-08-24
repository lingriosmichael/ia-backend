import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";

const activityEvidenceLinkageResultSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["needs_review", "resolved"],
      required: true,
      default: "resolved",
    },
    groups: { type: [Schema.Types.Mixed], default: [] },
    proposals: { type: [Schema.Types.Mixed], default: [] },
    proposalDecisions: { type: [Schema.Types.Mixed], default: [] },
    // The concernTaggingInstruction that produced the concern_flag/
    // concern_flag_reason fields currently baked into `groups`' entities —
    // compared against the activity's *current* instruction before reusing
    // any of them as a cache, so an edited instruction can't accidentally
    // reuse tags produced under the old wording. See
    // EvidenceLinkageReconciliationService.applyConcernTaggingIfConfigured.
    concernTaggingInstruction: { type: String, default: null },
  },
  {
    collection: "activity_evidence_linkage_results",
    timestamps: true,
  },
);

export type ActivityEvidenceLinkageResultMongoDocument = InferSchemaType<
  typeof activityEvidenceLinkageResultSchema
>;
export type ActivityEvidenceLinkageResultMongoHydratedDocument =
  HydratedDocument<ActivityEvidenceLinkageResultMongoDocument>;
export const ActivityEvidenceLinkageResultMongoModel = createModel(
  "ActivityEvidenceLinkageResult",
  activityEvidenceLinkageResultSchema,
);
