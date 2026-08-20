import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";

const projectOutcomeStatementSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    projectId: { type: String, required: true, index: true },
    organizationId: { type: String, required: true, index: true },
    term: { type: String, required: true, enum: ["short", "long"] },
    statement: { type: String, required: true, trim: true },
  },
  {
    collection: "project_outcome_statements",
    timestamps: true,
  },
);

export type ProjectOutcomeStatementMongoDocument = InferSchemaType<
  typeof projectOutcomeStatementSchema
>;
export type ProjectOutcomeStatementMongoHydratedDocument =
  HydratedDocument<ProjectOutcomeStatementMongoDocument>;
export const ProjectOutcomeStatementMongoModel = createModel(
  "ProjectOutcomeStatement",
  projectOutcomeStatementSchema,
);
