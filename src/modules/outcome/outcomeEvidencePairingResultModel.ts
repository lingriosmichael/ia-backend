import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";

const outcomeEvidencePairingResultSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["needs_review", "resolved"],
      required: true,
      default: "resolved",
    },
    proposals: { type: [Schema.Types.Mixed], default: [] },
    proposalDecisions: { type: [Schema.Types.Mixed], default: [] },
  },
  {
    collection: "outcome_evidence_pairing_results",
    timestamps: true,
  },
);

export type OutcomeEvidencePairingResultMongoDocument = InferSchemaType<
  typeof outcomeEvidencePairingResultSchema
>;
export type OutcomeEvidencePairingResultMongoHydratedDocument =
  HydratedDocument<OutcomeEvidencePairingResultMongoDocument>;
export const OutcomeEvidencePairingResultMongoModel = createModel(
  "OutcomeEvidencePairingResult",
  outcomeEvidencePairingResultSchema,
);
