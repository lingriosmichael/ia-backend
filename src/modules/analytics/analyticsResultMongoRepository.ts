import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import {
  AnalyticsResultMongoModel,
  type AnalyticsResultMongoHydratedDocument,
} from "./analyticsResultModel.js";
import type {
  AnalyticsDashboard,
  AnalyticsDataQuality,
  AnalyticsScope,
  DashboardCuration,
  EvidenceCatalog,
} from "./analyticsContracts.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import type {
  AnalyticsResultCreateInput,
  AnalyticsResultPersistenceRecord,
} from "./analyticsResultPersistence.js";

function toRecord(
  document: AnalyticsResultMongoHydratedDocument | null,
): AnalyticsResultPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    analyticsExecutionId: document.analyticsExecutionId,
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    scopeType: document.scopeType,
    catalogVersion: document.catalogVersion,
    knowledgeModelVersion: document.knowledgeModelVersion,
    catalog: document.catalog as EvidenceCatalog,
    curation: document.curation as DashboardCuration,
    dashboard: (document.dashboard ?? null) as AnalyticsDashboard | null,
    dataQuality: document.dataQuality as AnalyticsDataQuality,
    limitations: document.limitations,
    generatedAt: document.generatedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  } as AnalyticsResultPersistenceRecord;
}

export class MongoAnalyticsResultRepository implements AnalyticsResultRepository {
  async create(
    input: AnalyticsResultCreateInput,
    session: DatabaseSession,
  ): Promise<AnalyticsResultPersistenceRecord> {
    const [document] = await AnalyticsResultMongoModel.create(
      [
        {
          _id: createDocumentId(),
          analyticsExecutionId: input.analyticsExecutionId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          activityId: input.activityId,
          scopeType: input.scopeType,
          catalogVersion: input.catalogVersion,
          knowledgeModelVersion: input.knowledgeModelVersion,
          catalog: input.catalog,
          curation: input.curation,
          dashboard: input.dashboard,
          dataQuality: input.dataQuality,
          limitations: input.limitations,
          generatedAt: input.generatedAt,
        },
      ],
      getMongoSessionOptions(session),
    );
    return toRecord(document) as AnalyticsResultPersistenceRecord;
  }

  async findLatestByScope(
    scope: AnalyticsScope,
    session: DatabaseSession,
  ): Promise<AnalyticsResultPersistenceRecord | null> {
    const document = await applyMongoSession(
      AnalyticsResultMongoModel.findOne({
        projectId: scope.projectId,
        activityId: scope.activityId,
      }).sort({ createdAt: -1 }),
      session,
    ).exec();
    return toRecord(document);
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      AnalyticsResultMongoModel.deleteMany({
        projectId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
