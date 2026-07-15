import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import {
  AnalyticsExecutionMongoModel,
  type AnalyticsExecutionMongoHydratedDocument,
} from "./analyticsExecutionModel.js";
import type { AnalyticsScope } from "./analyticsContracts.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type {
  AnalyticsExecutionCreateInput,
  AnalyticsExecutionPersistenceRecord,
  AnalyticsExecutionStatusUpdate,
} from "./analyticsExecutionPersistence.js";

function toRecord(
  document: AnalyticsExecutionMongoHydratedDocument | null,
): AnalyticsExecutionPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    scopeType: document.scopeType,
    status: document.status,
    startedAt: document.startedAt ?? null,
    completedAt: document.completedAt ?? null,
    errorCode: document.errorCode ?? null,
    errorMessage: document.errorMessage ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  } as AnalyticsExecutionPersistenceRecord;
}

export class MongoAnalyticsExecutionRepository implements AnalyticsExecutionRepository {
  async create(
    input: AnalyticsExecutionCreateInput,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const [document] = await AnalyticsExecutionMongoModel.create(
      [
        {
          _id: createDocumentId(),
          organizationId: input.organizationId,
          projectId: input.projectId,
          activityId: input.activityId,
          scopeType: input.scopeType,
          status: input.status,
          startedAt: input.startedAt,
        },
      ],
      getMongoSessionOptions(session),
    );
    return toRecord(document) as AnalyticsExecutionPersistenceRecord;
  }

  async updateStatus(
    id: string,
    update: AnalyticsExecutionStatusUpdate,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null> {
    const document = await applyMongoSession(
      AnalyticsExecutionMongoModel.findByIdAndUpdate(
        id,
        {
          status: update.status,
          ...(update.completedAt !== undefined
            ? { completedAt: update.completedAt }
            : {}),
          ...(update.errorCode !== undefined
            ? { errorCode: update.errorCode }
            : {}),
          ...(update.errorMessage !== undefined
            ? { errorMessage: update.errorMessage }
            : {}),
        },
        { new: true },
      ),
      session,
    ).exec();
    return toRecord(document);
  }

  async findLatestByScope(
    scope: AnalyticsScope,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null> {
    const document = await applyMongoSession(
      AnalyticsExecutionMongoModel.findOne({
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
      AnalyticsExecutionMongoModel.deleteMany({
        projectId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
