import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";

const outcomeEvidenceLinkSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    outcomeId: { type: String, required: true, index: true },
    // Deterministic identity of the confirmed column pairing/column itself
    // (see buildPairedDeltaProposalId/buildSingleDistributionProposalId in
    // outcomeEvidenceApprovalSafetyCheck.ts) — NOT scoped by outcomeId,
    // matching assertNotAlreadyConfirmed's existing "this pairing is
    // already confirmed for the project" semantics. Backed by the unique
    // index below so that two concurrent approve requests for the same
    // recommendation can no longer both pass the application-level
    // read-then-write check and persist duplicate links: the second
    // insert now fails at the database with a duplicate-key error instead.
    proposalId: { type: String, required: true },
    shape: {
      type: String,
      required: true,
      enum: ["paired_delta", "single_distribution"],
    },
    // Shape-specific fields below are each optional at the schema level —
    // which ones are populated depends on `shape`, enforced by the
    // OutcomeEvidenceLink discriminated union in contracts.ts, not by
    // Mongoose. paired_delta only:
    activityIdBefore: { type: String, default: null },
    activityIdAfter: { type: String, default: null },
    beforeUploadMetadataId: { type: String, default: null },
    beforeTableName: { type: String, default: null },
    beforeColumnName: { type: String, default: null },
    afterUploadMetadataId: { type: String, default: null },
    afterTableName: { type: String, default: null },
    afterColumnName: { type: String, default: null },
    matchKey: { type: String, default: null },
    matchDiagnostics: { type: Schema.Types.Mixed, default: null },
    pairingGroupKey: { type: String, default: null },
    // single_distribution only:
    activityId: { type: String, default: null },
    uploadMetadataId: { type: String, default: null },
    tableName: { type: String, default: null },
    categoryColumnName: { type: String, default: null },
    confirmedById: { type: String, required: true },
    confirmedAt: { type: Date, required: true },
  },
  {
    collection: "outcome_evidence_links",
    timestamps: true,
  },
);

outcomeEvidenceLinkSchema.index({ projectId: 1, outcomeId: 1 });
outcomeEvidenceLinkSchema.index(
  { projectId: 1, proposalId: 1 },
  { unique: true },
);

export type OutcomeEvidenceLinkMongoDocument = InferSchemaType<
  typeof outcomeEvidenceLinkSchema
>;
export type OutcomeEvidenceLinkMongoHydratedDocument =
  HydratedDocument<OutcomeEvidenceLinkMongoDocument>;
export const OutcomeEvidenceLinkMongoModel = createModel(
  "OutcomeEvidenceLink",
  outcomeEvidenceLinkSchema,
);
