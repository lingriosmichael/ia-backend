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
    groups: { type: [Schema.Types.Mixed], default: [] },
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
