import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { projectKnowledgeModelStatusValues } from "../../shared/contracts.js";

const projectKnowledgeModelSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true, unique: true },
    version: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: [...projectKnowledgeModelStatusValues],
      default: "building",
    },
  },
  {
    collection: "project_knowledge_models",
    timestamps: true,
  },
);

export type ProjectKnowledgeModelMongoDocument = InferSchemaType<
  typeof projectKnowledgeModelSchema
>;
export type ProjectKnowledgeModelMongoHydratedDocument =
  HydratedDocument<ProjectKnowledgeModelMongoDocument>;
export const ProjectKnowledgeModelMongoModel = createModel(
  "ProjectKnowledgeModel",
  projectKnowledgeModelSchema,
);
