import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { applyMongoSession } from "../../shared/database/mongoSession.js";
import {
  ActivityAnalysisRunV2MongoModel,
  type ActivityAnalysisRunV2MongoHydratedDocument,
} from "./activityAnalysisRunV2Model.js";
import type { ActivityAnalysisRunV2Repository } from "./activityAnalysisRunV2Repository.js";
import type {
  ActivityAnalysisRunV2CreateInput,
  ActivityAnalysisRunV2PersistenceRecord,
} from "./activityAnalysisRunV2Persistence.js";

function toActivityAnalysisRunV2Record(
  document: ActivityAnalysisRunV2MongoHydratedDocument | null,
): ActivityAnalysisRunV2PersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId,
    activityName: document.activityName,
    phase: document.phase,
    status: document.status as ActivityAnalysisRunV2PersistenceRecord["status"],
    goalsSnapshot:
      document.goalsSnapshot as ActivityAnalysisRunV2PersistenceRecord["goalsSnapshot"],
    evidence: (document.evidence ??
      []) as ActivityAnalysisRunV2PersistenceRecord["evidence"],
    runLimits:
      document.runLimits as ActivityAnalysisRunV2PersistenceRecord["runLimits"],
    clarificationQuestions: (document.clarificationQuestions ??
      []) as ActivityAnalysisRunV2PersistenceRecord["clarificationQuestions"],
    toolCallTrace: (document.toolCallTrace ??
      []) as ActivityAnalysisRunV2PersistenceRecord["toolCallTrace"],
    calculations: (document.calculations ??
      []) as ActivityAnalysisRunV2PersistenceRecord["calculations"],
    assessment:
      (document.assessment as ActivityAnalysisRunV2PersistenceRecord["assessment"]) ??
      null,
    diagnostics:
      document.diagnostics as ActivityAnalysisRunV2PersistenceRecord["diagnostics"],
    shadowComparison:
      document.shadowComparison as ActivityAnalysisRunV2PersistenceRecord["shadowComparison"],
    renderedSummary: document.renderedSummary ?? null,
    validation:
      document.validation as ActivityAnalysisRunV2PersistenceRecord["validation"],
    errorMessage: document.errorMessage ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoActivityAnalysisRunV2Repository implements ActivityAnalysisRunV2Repository {
  async create(
    input: ActivityAnalysisRunV2CreateInput,
    session: DatabaseSession,
  ): Promise<ActivityAnalysisRunV2PersistenceRecord> {
    const [document] = await ActivityAnalysisRunV2MongoModel.create([input], {
      session: session ?? undefined,
    });

    return toActivityAnalysisRunV2Record(
      document,
    ) as ActivityAnalysisRunV2PersistenceRecord;
  }

  async findById(
    analysisRunId: string,
    session: DatabaseSession,
  ): Promise<ActivityAnalysisRunV2PersistenceRecord | null> {
    const document = await applyMongoSession(
      ActivityAnalysisRunV2MongoModel.findById(analysisRunId),
      session,
    ).exec();
    return toActivityAnalysisRunV2Record(document);
  }

  async findLatestByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ActivityAnalysisRunV2PersistenceRecord | null> {
    const document = await applyMongoSession(
      ActivityAnalysisRunV2MongoModel.findOne({ activityId }).sort({
        createdAt: -1,
      }),
      session,
    ).exec();
    return toActivityAnalysisRunV2Record(document);
  }

  async listByActivityId(
    activityId: string,
    limit: number,
    session: DatabaseSession,
  ): Promise<ActivityAnalysisRunV2PersistenceRecord[]> {
    const documents = await applyMongoSession(
      ActivityAnalysisRunV2MongoModel.find({ activityId })
        .sort({ createdAt: -1 })
        .limit(limit),
      session,
    ).exec();
    return documents.flatMap((document) => {
      const record = toActivityAnalysisRunV2Record(document);
      return record ? [record] : [];
    });
  }

  async listByProjectId(
    projectId: string,
    limit: number,
    session: DatabaseSession,
  ): Promise<ActivityAnalysisRunV2PersistenceRecord[]> {
    const documents = await applyMongoSession(
      ActivityAnalysisRunV2MongoModel.find({ projectId })
        .sort({ createdAt: -1 })
        .limit(limit),
      session,
    ).exec();
    return documents.flatMap((document) => {
      const record = toActivityAnalysisRunV2Record(document);
      return record ? [record] : [];
    });
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ActivityAnalysisRunV2MongoModel.deleteMany({ projectId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ActivityAnalysisRunV2MongoModel.deleteMany({ activityId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
