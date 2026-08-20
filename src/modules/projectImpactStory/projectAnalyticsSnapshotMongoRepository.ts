import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { applyMongoSession } from "../../shared/database/mongoSession.js";
import {
  ProjectAnalyticsSnapshotMongoModel,
  type ProjectAnalyticsSnapshotMongoHydratedDocument,
} from "./projectAnalyticsSnapshotModel.js";
import type { ProjectAnalyticsSnapshotRepository } from "./projectAnalyticsSnapshotRepository.js";
import type {
  ProjectAnalyticsSnapshotCreateInput,
  ProjectAnalyticsSnapshotPersistenceRecord,
} from "./projectAnalyticsSnapshotPersistence.js";

function toProjectAnalyticsSnapshotRecord(
  document: ProjectAnalyticsSnapshotMongoHydratedDocument | null,
): ProjectAnalyticsSnapshotPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    status:
      document.status as ProjectAnalyticsSnapshotPersistenceRecord["status"],
    sourceSnapshot: (document.sourceSnapshot ??
      []) as ProjectAnalyticsSnapshotPersistenceRecord["sourceSnapshot"],
    activityCards: (document.activityCards ??
      []) as ProjectAnalyticsSnapshotPersistenceRecord["activityCards"],
    headlineKpis: (document.headlineKpis ??
      []) as ProjectAnalyticsSnapshotPersistenceRecord["headlineKpis"],
    chartPlan: (document.chartPlan ??
      []) as ProjectAnalyticsSnapshotPersistenceRecord["chartPlan"],
    contextCharts: (document.contextCharts ??
      []) as ProjectAnalyticsSnapshotPersistenceRecord["contextCharts"],
    diagnostics:
      document.diagnostics as ProjectAnalyticsSnapshotPersistenceRecord["diagnostics"],
    llmUsage:
      (document.llmUsage as ProjectAnalyticsSnapshotPersistenceRecord["llmUsage"]) ??
      null,
    errorMessage: document.errorMessage ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoProjectAnalyticsSnapshotRepository implements ProjectAnalyticsSnapshotRepository {
  async create(
    input: ProjectAnalyticsSnapshotCreateInput,
    session: DatabaseSession,
  ): Promise<ProjectAnalyticsSnapshotPersistenceRecord> {
    const [document] = await ProjectAnalyticsSnapshotMongoModel.create(
      [input],
      {
        session: session ?? undefined,
      },
    );

    return toProjectAnalyticsSnapshotRecord(
      document,
    ) as ProjectAnalyticsSnapshotPersistenceRecord;
  }

  async findLatestByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectAnalyticsSnapshotPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProjectAnalyticsSnapshotMongoModel.findOne({ projectId }).sort({
        createdAt: -1,
      }),
      session,
    ).exec();
    return toProjectAnalyticsSnapshotRecord(document);
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ProjectAnalyticsSnapshotMongoModel.deleteMany({ projectId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
