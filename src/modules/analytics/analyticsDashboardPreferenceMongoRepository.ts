import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  AnalyticsDashboardPreferenceMongoModel,
  type AnalyticsDashboardPreferenceMongoHydratedDocument,
} from "./analyticsDashboardPreferenceModel.js";
import type { AnalyticsDashboardPreferenceRepository } from "./analyticsDashboardPreferenceRepository.js";
import type { AnalyticsScope } from "./analyticsContracts.js";
import type {
  AnalyticsDashboardPreferencePersistenceRecord,
  AnalyticsDashboardPreferenceUpsertInput,
} from "./analyticsDashboardPreferencePersistence.js";

function toRecord(
  document: AnalyticsDashboardPreferenceMongoHydratedDocument | null,
): AnalyticsDashboardPreferencePersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    scopeType: document.scopeType,
    dashboardSchemaVersion: document.dashboardSchemaVersion,
    orderedWidgetIds: document.orderedWidgetIds ?? [],
    hiddenWidgetIds: document.hiddenWidgetIds ?? [],
    updatedById: document.updatedById,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoAnalyticsDashboardPreferenceRepository implements AnalyticsDashboardPreferenceRepository {
  async findByScope(
    scope: AnalyticsScope,
    session: DatabaseSession,
  ): Promise<AnalyticsDashboardPreferencePersistenceRecord | null> {
    const document = await applyMongoSession(
      AnalyticsDashboardPreferenceMongoModel.findOne({
        projectId: scope.projectId,
        activityId: scope.activityId,
        scopeType: scope.type,
      }),
      session,
    ).exec();

    return toRecord(document);
  }

  async upsertByScope(
    input: AnalyticsDashboardPreferenceUpsertInput,
    session: DatabaseSession,
  ): Promise<AnalyticsDashboardPreferencePersistenceRecord> {
    const document = await applyMongoSession(
      AnalyticsDashboardPreferenceMongoModel.findOneAndUpdate(
        {
          projectId: input.projectId,
          activityId: input.activityId,
          scopeType: input.scopeType,
        },
        {
          $set: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            activityId: input.activityId,
            scopeType: input.scopeType,
            dashboardSchemaVersion: input.dashboardSchemaVersion,
            orderedWidgetIds: input.orderedWidgetIds,
            hiddenWidgetIds: input.hiddenWidgetIds,
            updatedById: input.updatedById,
          },
          $setOnInsert: {
            _id: createDocumentId(),
          },
        },
        {
          upsert: true,
          returnDocument: "after",
          ...getMongoSessionOptions(session),
        },
      ),
      session,
    ).exec();

    return toRecord(document) as AnalyticsDashboardPreferencePersistenceRecord;
  }

  async deleteByScope(
    scope: AnalyticsScope,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      AnalyticsDashboardPreferenceMongoModel.deleteMany({
        projectId: scope.projectId,
        activityId: scope.activityId,
        scopeType: scope.type,
      }),
      session,
    ).exec();

    return result.deletedCount ?? 0;
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      AnalyticsDashboardPreferenceMongoModel.deleteMany({
        projectId,
      }),
      session,
    ).exec();

    return result.deletedCount ?? 0;
  }
}
