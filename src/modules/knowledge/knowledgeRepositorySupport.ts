import type { Model } from "mongoose";
import type { KnowledgeSourceInstance } from "../../shared/contracts.js";

type SourceInstanceDocumentShape = {
  uploadMetadataId: string;
  interpretationResultId: string;
  activityId: string;
  activityType?: string | null;
  sourceReference: string;
  addedAt: Date;
};

export function toKnowledgeSourceInstanceRecord(
  instance: SourceInstanceDocumentShape,
): KnowledgeSourceInstance {
  return {
    uploadMetadataId: instance.uploadMetadataId,
    interpretationResultId: instance.interpretationResultId,
    activityId: instance.activityId,
    activityType: instance.activityType ?? null,
    sourceReference: instance.sourceReference,
    addedAt: instance.addedAt.toISOString(),
  };
}

export function toKnowledgeSourceInstanceDocument(
  instance: KnowledgeSourceInstance,
): SourceInstanceDocumentShape {
  return {
    ...instance,
    addedAt: new Date(instance.addedAt),
  };
}

export async function deleteAllByField<TDocument>(
  model: Model<TDocument>,
  field: string,
  value: string,
): Promise<number> {
  const result = await model.deleteMany({ [field]: value }).exec();
  return result.deletedCount ?? 0;
}

export async function deleteAllByProjectId<TDocument>(
  model: Model<TDocument>,
  projectKnowledgeModelModel: Model<{ projectId: string }>,
  projectId: string,
): Promise<number> {
  const projectKnowledgeModels = await projectKnowledgeModelModel
    .find({ projectId }, { _id: 1 })
    .exec();
  const projectKnowledgeModelIds = projectKnowledgeModels.map((modelRecord) =>
    modelRecord._id.toString(),
  );
  if (projectKnowledgeModelIds.length === 0) {
    return 0;
  }

  const result = await model
    .deleteMany({
      projectKnowledgeModelId: { $in: projectKnowledgeModelIds },
    })
    .exec();
  return result.deletedCount ?? 0;
}
