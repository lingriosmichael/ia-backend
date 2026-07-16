import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { applyMongoSession } from "../../shared/database/mongoSession.js";
import {
  DeterministicAnalysisMongoModel,
  type DeterministicAnalysisMongoHydratedDocument,
} from "./deterministicAnalysisModel.js";
import type { DeterministicAnalysisRepository } from "./deterministicAnalysisRepository.js";
import type {
  DeterministicAnalysisPersistenceRecord,
  DeterministicAnalysisUpsertInput,
} from "./deterministicAnalysisPersistence.js";

function toDeterministicAnalysisRecord(
  document: DeterministicAnalysisMongoHydratedDocument | null,
): DeterministicAnalysisPersistenceRecord | null {
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
    datasetPreparationId: document.datasetPreparationId,
    status: document.status,
    metrics: (document.metrics ??
      []) as DeterministicAnalysisPersistenceRecord["metrics"],
    distributions: (document.distributions ??
      []) as DeterministicAnalysisPersistenceRecord["distributions"],
    trends: (document.trends ??
      []) as DeterministicAnalysisPersistenceRecord["trends"],
    subgroupBreakdowns: (document.subgroupBreakdowns ??
      []) as DeterministicAnalysisPersistenceRecord["subgroupBreakdowns"],
    categoricalCrosstabs: (document.categoricalCrosstabs ??
      []) as DeterministicAnalysisPersistenceRecord["categoricalCrosstabs"],
    numericCategorySummaries: (document.numericCategorySummaries ??
      []) as DeterministicAnalysisPersistenceRecord["numericCategorySummaries"],
    numericCorrelations: (document.numericCorrelations ??
      []) as DeterministicAnalysisPersistenceRecord["numericCorrelations"],
    warnings: (document.warnings ??
      []) as DeterministicAnalysisPersistenceRecord["warnings"],
    candidateIndicators: (document.candidateIndicators ??
      []) as DeterministicAnalysisPersistenceRecord["candidateIndicators"],
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoDeterministicAnalysisRepository implements DeterministicAnalysisRepository {
  async upsertByInterpretationResultId(
    input: DeterministicAnalysisUpsertInput,
    session: DatabaseSession,
  ): Promise<DeterministicAnalysisPersistenceRecord> {
    const document = await applyMongoSession(
      DeterministicAnalysisMongoModel.findOneAndUpdate(
        { interpretationResultId: input.interpretationResultId },
        {
          $set: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            activityId: input.activityId,
            uploadMetadataId: input.uploadMetadataId,
            privacySafeRepresentationId: input.privacySafeRepresentationId,
            interpretationResultId: input.interpretationResultId,
            datasetPreparationId: input.datasetPreparationId,
            status: input.status,
            metrics: input.metrics,
            distributions: input.distributions,
            trends: input.trends,
            subgroupBreakdowns: input.subgroupBreakdowns,
            categoricalCrosstabs: input.categoricalCrosstabs,
            numericCategorySummaries: input.numericCategorySummaries,
            numericCorrelations: input.numericCorrelations,
            warnings: input.warnings,
            candidateIndicators: input.candidateIndicators,
          },
        },
        { upsert: true, returnDocument: "after" },
      ),
      session,
    ).exec();

    return toDeterministicAnalysisRecord(
      document,
    ) as DeterministicAnalysisPersistenceRecord;
  }

  async findByInterpretationResultId(
    interpretationResultId: string,
    session: DatabaseSession,
  ): Promise<DeterministicAnalysisPersistenceRecord | null> {
    const document = await applyMongoSession(
      DeterministicAnalysisMongoModel.findOne({
        interpretationResultId,
      }),
      session,
    ).exec();
    return toDeterministicAnalysisRecord(document);
  }

  async findByInterpretationResultIds(
    interpretationResultIds: string[],
    session: DatabaseSession,
  ): Promise<DeterministicAnalysisPersistenceRecord[]> {
    if (interpretationResultIds.length === 0) {
      return [];
    }

    const documents = await applyMongoSession(
      DeterministicAnalysisMongoModel.find({
        interpretationResultId: { $in: interpretationResultIds },
      }),
      session,
    ).exec();

    return documents
      .map((document) => toDeterministicAnalysisRecord(document))
      .filter(
        (record): record is DeterministicAnalysisPersistenceRecord =>
          record !== null,
      );
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      DeterministicAnalysisMongoModel.deleteMany({
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
      DeterministicAnalysisMongoModel.deleteMany({
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
      DeterministicAnalysisMongoModel.deleteMany({
        uploadMetadataId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
