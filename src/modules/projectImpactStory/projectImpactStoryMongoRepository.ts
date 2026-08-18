import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { applyMongoSession } from "../../shared/database/mongoSession.js";
import {
  ProjectImpactStoryMongoModel,
  type ProjectImpactStoryMongoHydratedDocument,
} from "./projectImpactStoryModel.js";
import type { ProjectImpactStoryRepository } from "./projectImpactStoryRepository.js";
import type {
  ProjectImpactStoryCreateInput,
  ProjectImpactStoryPersistenceRecord,
} from "./projectImpactStoryPersistence.js";

function toProjectImpactStoryRecord(
  document: ProjectImpactStoryMongoHydratedDocument | null,
): ProjectImpactStoryPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    status: document.status as ProjectImpactStoryPersistenceRecord["status"],
    sourceSnapshot: (document.sourceSnapshot ??
      []) as ProjectImpactStoryPersistenceRecord["sourceSnapshot"],
    activityCards: (document.activityCards ??
      []) as ProjectImpactStoryPersistenceRecord["activityCards"],
    headlineKpis: (document.headlineKpis ??
      []) as ProjectImpactStoryPersistenceRecord["headlineKpis"],
    chartPlan: (document.chartPlan ??
      []) as ProjectImpactStoryPersistenceRecord["chartPlan"],
    narrativeSummary: document.narrativeSummary ?? null,
    diagnostics:
      document.diagnostics as ProjectImpactStoryPersistenceRecord["diagnostics"],
    llmUsage:
      (document.llmUsage as ProjectImpactStoryPersistenceRecord["llmUsage"]) ??
      null,
    errorMessage: document.errorMessage ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoProjectImpactStoryRepository implements ProjectImpactStoryRepository {
  async create(
    input: ProjectImpactStoryCreateInput,
    session: DatabaseSession,
  ): Promise<ProjectImpactStoryPersistenceRecord> {
    const [document] = await ProjectImpactStoryMongoModel.create([input], {
      session: session ?? undefined,
    });

    return toProjectImpactStoryRecord(
      document,
    ) as ProjectImpactStoryPersistenceRecord;
  }

  async findLatestByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectImpactStoryPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProjectImpactStoryMongoModel.findOne({ projectId }).sort({
        createdAt: -1,
      }),
      session,
    ).exec();
    return toProjectImpactStoryRecord(document);
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ProjectImpactStoryMongoModel.deleteMany({ projectId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
