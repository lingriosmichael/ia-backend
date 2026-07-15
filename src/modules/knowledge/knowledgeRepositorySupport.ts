import type { Model } from "mongoose";
import type { KnowledgeSourceInstance } from "../../shared/contracts.js";
import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { getMongoSessionOptions } from "../../shared/database/mongoSession.js";

type SourceInstanceDocumentShape = {
  uploadMetadataId: string;
  interpretationResultId: string;
  activityId: string;
  activityType?: string | null;
  sourceReference: string;
  addedAt: Date;
  computedValue?: KnowledgeSourceInstance["computedValue"];
  qualitativeContext?: KnowledgeSourceInstance["qualitativeContext"];
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
    computedValue: instance.computedValue ?? null,
    qualitativeContext: instance.qualitativeContext ?? null,
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
  session: DatabaseSession,
): Promise<number> {
  const result = await model
    .deleteMany({ [field]: value }, getMongoSessionOptions(session))
    .exec();
  return result.deletedCount ?? 0;
}

export async function deleteAllByProjectId<TDocument>(
  model: Model<TDocument>,
  projectKnowledgeModelModel: Model<{ projectId: string }>,
  projectId: string,
  session: DatabaseSession,
): Promise<number> {
  const projectKnowledgeModels = await projectKnowledgeModelModel
    .find({ projectId }, { _id: 1 }, getMongoSessionOptions(session))
    .exec();
  const projectKnowledgeModelIds = projectKnowledgeModels.map((modelRecord) =>
    modelRecord._id.toString(),
  );
  if (projectKnowledgeModelIds.length === 0) {
    return 0;
  }

  const result = await model
    .deleteMany(
      {
        projectKnowledgeModelId: { $in: projectKnowledgeModelIds },
      },
      getMongoSessionOptions(session),
    )
    .exec();
  return result.deletedCount ?? 0;
}
