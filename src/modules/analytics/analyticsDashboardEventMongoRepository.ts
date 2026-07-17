import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import type { AnalyticsScope } from "./analyticsContracts.js";
import {
  AnalyticsDashboardEventMongoModel,
  type AnalyticsDashboardEventMongoHydratedDocument,
} from "./analyticsDashboardEventModel.js";
import type { AnalyticsDashboardEventRepository } from "./analyticsDashboardEventRepository.js";
import type {
  AnalyticsDashboardEventCreateInput,
  AnalyticsDashboardEventPersistenceRecord,
} from "./analyticsDashboardEventPersistence.js";

function toRecord(
  document: AnalyticsDashboardEventMongoHydratedDocument | null,
): AnalyticsDashboardEventPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    scopeType: document.scopeType,
    userId: document.userId,
    resultId: document.resultId,
    interactionType: document.interactionType,
    dashboardSchemaVersion: document.dashboardSchemaVersion,
    dashboardCompatibilitySource: document.dashboardCompatibilitySource,
    orderedWidgetIds: document.orderedWidgetIds,
    hiddenWidgetIds: document.hiddenWidgetIds,
    visibleWidgetIds: document.visibleWidgetIds,
    widgetId: document.widgetId ?? null,
    occurredAt: document.occurredAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  } as AnalyticsDashboardEventPersistenceRecord;
}

export class MongoAnalyticsDashboardEventRepository implements AnalyticsDashboardEventRepository {
  async create(
    input: AnalyticsDashboardEventCreateInput,
    session: DatabaseSession,
  ): Promise<AnalyticsDashboardEventPersistenceRecord> {
    const [document] = await AnalyticsDashboardEventMongoModel.create(
      [
        {
          _id: createDocumentId(),
          organizationId: input.organizationId,
          projectId: input.projectId,
          activityId: input.activityId,
          scopeType: input.scopeType,
          userId: input.userId,
          resultId: input.resultId,
          interactionType: input.interactionType,
          dashboardSchemaVersion: input.dashboardSchemaVersion,
          dashboardCompatibilitySource: input.dashboardCompatibilitySource,
          orderedWidgetIds: input.orderedWidgetIds,
          hiddenWidgetIds: input.hiddenWidgetIds,
          visibleWidgetIds: input.visibleWidgetIds,
          widgetId: input.widgetId,
          occurredAt: input.occurredAt,
        },
      ],
      getMongoSessionOptions(session),
    );

    return toRecord(document) as AnalyticsDashboardEventPersistenceRecord;
  }

  async findByScopeAndResultId(
    scope: AnalyticsScope,
    resultId: string,
    session: DatabaseSession,
  ): Promise<AnalyticsDashboardEventPersistenceRecord[]> {
    const documents = await applyMongoSession(
      AnalyticsDashboardEventMongoModel.find({
        projectId: scope.projectId,
        activityId: scope.activityId,
        scopeType: scope.type,
        resultId,
      }).sort({ occurredAt: 1, _id: 1 }),
      session,
    ).exec();

    return documents
      .map((document) => toRecord(document))
      .filter((record): record is AnalyticsDashboardEventPersistenceRecord =>
        Boolean(record),
      );
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      AnalyticsDashboardEventMongoModel.deleteMany({ projectId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      AnalyticsDashboardEventMongoModel.deleteMany({ activityId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
