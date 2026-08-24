import { MongoProjectRepository } from "../modules/project/projectMongoRepository.js";
import { MongoActivityRepository } from "../modules/activity/activityMongoRepository.js";
import { MongoUploadMetadataRepository } from "../modules/upload/uploadMetadataMongoRepository.js";
import { MongoInterpretationResultRepository } from "../modules/interpretation/interpretationResultMongoRepository.js";
import { MongoProjectKnowledgeModelRepository } from "../modules/knowledge/projectKnowledgeModelMongoRepository.js";
import { MongoKnowledgeEntityRepository } from "../modules/knowledge/knowledgeEntityMongoRepository.js";
import { MongoKnowledgeIndicatorRepository } from "../modules/knowledge/knowledgeIndicatorMongoRepository.js";
import { ProjectKnowledgeBuilderService } from "../modules/knowledge/projectKnowledgeBuilderService.js";
import { databaseSession } from "../shared/database/databaseClient.js";
import { runMigrationScript } from "./shared/migrationScriptRunner.js";

/**
 * Manually builds (or rebuilds) the Project Knowledge Model for one
 * project from its currently verified, acknowledged interpretation data.
 * Deliberately the only invocation path for this phase — there is no
 * public HTTP route yet, since nothing consumes the PKM until Phase 5.
 * Run with: node --import tsx src/scripts/buildProjectKnowledgeModel.ts <projectId> -- --execute
 */
const projectId = process.argv[2];
if (!projectId) {
  throw new Error(
    "Usage: buildProjectKnowledgeModel.ts <projectId> -- --execute",
  );
}

const projectKnowledgeModelRepository =
  new MongoProjectKnowledgeModelRepository();
const builder = new ProjectKnowledgeBuilderService(
  new MongoProjectRepository(),
  new MongoActivityRepository(),
  new MongoUploadMetadataRepository(),
  new MongoInterpretationResultRepository(),
  projectKnowledgeModelRepository,
  new MongoKnowledgeEntityRepository(),
  new MongoKnowledgeIndicatorRepository(),
);

runMigrationScript({
  scriptLabel: `Project Knowledge Model build for project ${projectId}`,
  preview: async () => {
    const existingModel = await projectKnowledgeModelRepository.findByProjectId(
      projectId,
      databaseSession,
    );
    console.log(
      existingModel
        ? `Project ${projectId} currently has a Project Knowledge Model at version ${existingModel.version} (${existingModel.status}). Running would rebuild it from current interpretation data.`
        : `Project ${projectId} has no Project Knowledge Model yet. Running would build its first version.`,
    );
  },
  apply: async () => {
    const result = await builder.buildForProject(projectId);
    console.log(
      `Project Knowledge Model for project ${projectId} is now version ${result.version} (${result.status}).`,
    );
  },
});
