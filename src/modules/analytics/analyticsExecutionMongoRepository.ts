import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import { isMongoDuplicateKeyError } from "../../shared/database/mongoErrors.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  AnalyticsExecutionMongoModel,
  type AnalyticsExecutionMongoHydratedDocument,
} from "./analyticsExecutionModel.js";
import type { AnalyticsScope } from "./analyticsContracts.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type {
  AnalyticsExecutionCreateInput,
  AnalyticsExecutionPersistenceRecord,
  AnalyticsExecutionUpdateInput,
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
    language: document.language ?? "de",
    status: document.status,
    leaseOwner: document.leaseOwner ?? null,
    leaseExpiresAt: document.leaseExpiresAt ?? null,
    lastHeartbeatAt: document.lastHeartbeatAt ?? null,
    attemptCount: document.attemptCount ?? 0,
    nextAttemptAt: document.nextAttemptAt ?? null,
    maxAttempts: document.maxAttempts ?? 10,
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
    try {
      const [document] = await AnalyticsExecutionMongoModel.create(
        [
          {
            _id: createDocumentId(),
            organizationId: input.organizationId,
            projectId: input.projectId,
            activityId: input.activityId,
            scopeType: input.scopeType,
            language: input.language,
            status: input.status,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastHeartbeatAt: null,
            attemptCount: 0,
            nextAttemptAt: null,
            maxAttempts: input.maxAttempts ?? 10,
            startedAt: input.startedAt,
          },
        ],
        getMongoSessionOptions(session),
      );
      return toRecord(document) as AnalyticsExecutionPersistenceRecord;
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new AppError(
          "Analytics generation is already in progress for this scope.",
          409,
          "analytics_generation_already_running",
        );
      }

      throw error;
    }
  }

  async update(
    id: string,
    update: AnalyticsExecutionUpdateInput,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null> {
    const document = await applyMongoSession(
      AnalyticsExecutionMongoModel.findByIdAndUpdate(
        id,
        {
          status: update.status,
          ...(update.leaseOwner !== undefined
            ? { leaseOwner: update.leaseOwner }
            : {}),
          ...(update.leaseExpiresAt !== undefined
            ? { leaseExpiresAt: update.leaseExpiresAt }
            : {}),
          ...(update.lastHeartbeatAt !== undefined
            ? { lastHeartbeatAt: update.lastHeartbeatAt }
            : {}),
          ...(update.attemptCount !== undefined
            ? { attemptCount: update.attemptCount }
            : {}),
          ...(update.nextAttemptAt !== undefined
            ? { nextAttemptAt: update.nextAttemptAt }
            : {}),
          ...(update.maxAttempts !== undefined
            ? { maxAttempts: update.maxAttempts }
            : {}),
          ...(update.startedAt !== undefined
            ? { startedAt: update.startedAt }
            : {}),
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

  async findById(
    id: string,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null> {
    const document = await applyMongoSession(
      AnalyticsExecutionMongoModel.findById(id),
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

  async claimNextRunnable(
    input: {
      workerId: string;
      leaseExpiresAt: Date;
      now: Date;
      claimedStatus: "RUNNING";
    },
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null> {
    await applyMongoSession(
      AnalyticsExecutionMongoModel.findOneAndUpdate(
        {
          status: { $in: ["QUEUED", "RUNNING"] },
          $expr: { $gte: ["$attemptCount", "$maxAttempts"] },
          $and: [
            {
              $or: [
                { nextAttemptAt: null },
                { nextAttemptAt: { $lte: input.now } },
              ],
            },
            {
              $or: [
                { leaseOwner: null },
                { leaseExpiresAt: null },
                { leaseExpiresAt: { $lt: input.now } },
              ],
            },
          ],
        },
        {
          $set: {
            status: "FAILED",
            completedAt: input.now,
            errorCode: "analytics_generation_attempts_exhausted",
            errorMessage:
              "Analytics generation exhausted its retry budget before it could complete.",
            leaseOwner: null,
            leaseExpiresAt: null,
            lastHeartbeatAt: null,
            nextAttemptAt: null,
          },
        },
        { sort: { createdAt: 1 } },
      ),
      session,
    ).exec();

    const document = await applyMongoSession(
      AnalyticsExecutionMongoModel.findOneAndUpdate(
        {
          status: { $in: ["QUEUED", "RUNNING"] },
          $expr: { $lt: ["$attemptCount", "$maxAttempts"] },
          $and: [
            {
              $or: [
                { nextAttemptAt: null },
                { nextAttemptAt: { $lte: input.now } },
              ],
            },
            {
              $or: [
                {
                  status: "QUEUED",
                  $or: [
                    { leaseOwner: null },
                    { leaseExpiresAt: null },
                    { leaseExpiresAt: { $lt: input.now } },
                  ],
                },
                {
                  status: "RUNNING",
                  leaseExpiresAt: { $lt: input.now },
                },
              ],
            },
          ],
        },
        {
          $set: {
            status: input.claimedStatus,
            leaseOwner: input.workerId,
            leaseExpiresAt: input.leaseExpiresAt,
            lastHeartbeatAt: input.now,
            startedAt: input.now,
            completedAt: null,
            errorCode: null,
            errorMessage: null,
            nextAttemptAt: null,
          },
          $inc: {
            attemptCount: 1,
          },
        },
        {
          sort: {
            createdAt: 1,
          },
          new: true,
        },
      ),
      session,
    ).exec();

    return toRecord(document);
  }

  async renewLease(
    input: {
      analyticsExecutionId: string;
      workerId: string;
      leaseExpiresAt: Date;
      heartbeatAt: Date;
    },
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null> {
    const document = await applyMongoSession(
      AnalyticsExecutionMongoModel.findOneAndUpdate(
        {
          _id: input.analyticsExecutionId,
          status: "RUNNING",
          leaseOwner: input.workerId,
        },
        {
          $set: {
            leaseExpiresAt: input.leaseExpiresAt,
            lastHeartbeatAt: input.heartbeatAt,
          },
        },
        { new: true },
      ),
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
