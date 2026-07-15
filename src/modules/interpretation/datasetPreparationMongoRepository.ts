import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { applyMongoSession } from "../../shared/database/mongoSession.js";
import type {
  DatasetPreparationDecisionSummary,
  PreparedDatasetSnapshot,
} from "../../shared/contracts.js";
import {
  DatasetPreparationMongoModel,
  type DatasetPreparationMongoHydratedDocument,
} from "./datasetPreparationModel.js";
import type { DatasetPreparationRepository } from "./datasetPreparationRepository.js";
import type {
  DatasetPreparationPersistenceRecord,
  DatasetPreparationUpsertInput,
} from "./datasetPreparationPersistence.js";

function toDatasetPreparationRecord(
  document: DatasetPreparationMongoHydratedDocument | null,
): DatasetPreparationPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    uploadMetadataId: document.uploadMetadataId,
    privacySafeRepresentationId: document.privacySafeRepresentationId,
    interpretationResultId: document.interpretationResultId,
    status: document.status,
    blockingQuestionCount: document.blockingQuestionCount,
    answeredBlockingQuestionCount: document.answeredBlockingQuestionCount,
    unansweredBlockingQuestionIds: document.unansweredBlockingQuestionIds,
    decisions: document.decisions.map((decision) => ({
      questionId: decision.questionId,
      questionCode: decision.questionCode,
      questionPrompt: decision.questionPrompt,
      tableName: decision.tableName ?? null,
      columnName: decision.columnName ?? null,
      answeredValue: decision.answeredValue,
      answeredById: decision.answeredById ?? null,
      answeredAt: decision.answeredAt ?? null,
    })),
    decisionSummary:
      (document.decisionSummary as DatasetPreparationDecisionSummary) ?? {
        normalizationMerges: [],
        rowGrains: [],
        duplicateIdentifierResolutions: [],
        primaryStatusFields: [],
        positiveStatusDefinitions: [],
        primaryDateFields: [],
      },
    preparedDataset:
      (document.preparedDataset as PreparedDatasetSnapshot | null) ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoDatasetPreparationRepository implements DatasetPreparationRepository {
  async upsertByInterpretationResultId(
    input: DatasetPreparationUpsertInput,
    session: DatabaseSession,
  ): Promise<DatasetPreparationPersistenceRecord> {
    const document = await applyMongoSession(
      DatasetPreparationMongoModel.findOneAndUpdate(
        { interpretationResultId: input.interpretationResultId },
        {
          $set: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            activityId: input.activityId,
            uploadMetadataId: input.uploadMetadataId,
            privacySafeRepresentationId: input.privacySafeRepresentationId,
            interpretationResultId: input.interpretationResultId,
            status: input.status,
            blockingQuestionCount: input.blockingQuestionCount,
            answeredBlockingQuestionCount: input.answeredBlockingQuestionCount,
            unansweredBlockingQuestionIds: input.unansweredBlockingQuestionIds,
            decisions: input.decisions,
            decisionSummary: input.decisionSummary,
            preparedDataset: input.preparedDataset,
          },
        },
        { upsert: true, returnDocument: "after" },
      ),
      session,
    ).exec();

    return toDatasetPreparationRecord(
      document,
    ) as DatasetPreparationPersistenceRecord;
  }

  async findByInterpretationResultId(
    interpretationResultId: string,
    session: DatabaseSession,
  ): Promise<DatasetPreparationPersistenceRecord | null> {
    const document = await applyMongoSession(
      DatasetPreparationMongoModel.findOne({
        interpretationResultId,
      }),
      session,
    ).exec();
    return toDatasetPreparationRecord(document);
  }

  async findByInterpretationResultIds(
    interpretationResultIds: string[],
    session: DatabaseSession,
  ): Promise<DatasetPreparationPersistenceRecord[]> {
    if (interpretationResultIds.length === 0) {
      return [];
    }

    const documents = await applyMongoSession(
      DatasetPreparationMongoModel.find({
        interpretationResultId: { $in: interpretationResultIds },
      }),
      session,
    ).exec();

    return documents
      .map((document) => toDatasetPreparationRecord(document))
      .filter(
        (record): record is DatasetPreparationPersistenceRecord =>
          record !== null,
      );
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      DatasetPreparationMongoModel.deleteMany({
        projectId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      DatasetPreparationMongoModel.deleteMany({
        activityId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      DatasetPreparationMongoModel.deleteMany({
        uploadMetadataId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
