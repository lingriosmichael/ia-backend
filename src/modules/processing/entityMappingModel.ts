import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const entityMappingSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadMetadataId: { type: String, required: true, index: true },
    processingJobId: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: "entity_mappings",
    timestamps: true,
  },
);

export type EntityMappingMongoDocument = InferSchemaType<
  typeof entityMappingSchema
>;
export type EntityMappingMongoHydratedDocument =
  HydratedDocument<EntityMappingMongoDocument>;
export const EntityMappingMongoModel = createModel(
  "EntityMapping",
  entityMappingSchema,
);
