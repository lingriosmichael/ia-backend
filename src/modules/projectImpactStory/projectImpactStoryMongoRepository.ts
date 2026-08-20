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
    analyticsSnapshotId: document.analyticsSnapshotId,
    status: document.status as ProjectImpactStoryPersistenceRecord["status"],
    impactCatalog: (document.impactCatalog ??
      []) as ProjectImpactStoryPersistenceRecord["impactCatalog"],
    narrativeSummary: document.narrativeSummary ?? null,
    narrativeStatus:
      (document.narrativeStatus as ProjectImpactStoryPersistenceRecord["narrativeStatus"]) ??
      null,
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
