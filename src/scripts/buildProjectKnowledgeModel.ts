import { loadConfig } from "../shared/config/env.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "../shared/database/mongoose.js";
import { MongoProjectRepository } from "../modules/project/projectMongoRepository.js";
import { MongoActivityRepository } from "../modules/activity/activityMongoRepository.js";
import { MongoUploadMetadataRepository } from "../modules/upload/uploadMetadataMongoRepository.js";
import { MongoInterpretationResultRepository } from "../modules/interpretation/interpretationResultMongoRepository.js";
import { MongoProjectKnowledgeModelRepository } from "../modules/knowledge/projectKnowledgeModelMongoRepository.js";
import { MongoKnowledgeEntityRepository } from "../modules/knowledge/knowledgeEntityMongoRepository.js";
import { MongoKnowledgeRelationshipRepository } from "../modules/knowledge/knowledgeRelationshipMongoRepository.js";
import { ProjectKnowledgeBuilderService } from "../modules/knowledge/projectKnowledgeBuilderService.js";

/**
 * Manually builds (or rebuilds) the Project Knowledge Model for one
 * project from its currently verified, acknowledged interpretation data.
 * Deliberately the only invocation path for this phase — there is no
 * public HTTP route yet, since nothing consumes the PKM until Phase 5.
 * Run with: node --import tsx src/scripts/buildProjectKnowledgeModel.ts <projectId>
 */
async function run() {
  const projectId = process.argv[2];
  if (!projectId) {
    throw new Error("Usage: buildProjectKnowledgeModel.ts <projectId>");
  }

  const config = loadConfig();
  await connectMongoDatabase(config);

  const builder = new ProjectKnowledgeBuilderService(
    new MongoProjectRepository(),
    new MongoActivityRepository(),
    new MongoUploadMetadataRepository(),
    new MongoInterpretationResultRepository(),
    new MongoProjectKnowledgeModelRepository(),
    new MongoKnowledgeEntityRepository(),
    new MongoKnowledgeRelationshipRepository(),
  );

  const result = await builder.buildForProject(projectId);
  console.log(
    `Project Knowledge Model for project ${projectId} is now version ${result.version} (${result.status}).`,
  );
}

run()
  .then(async () => {
    await disconnectMongoDatabase();
  })
  .catch(async (error) => {
    console.error(error);
    await disconnectMongoDatabase();
    process.exit(1);
  });
