import { loadConfig } from "../shared/config/env.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "../shared/database/mongoose.js";
import { databaseSession } from "../shared/database/databaseClient.js";
import { MongoProjectKnowledgeModelRepository } from "../modules/knowledge/projectKnowledgeModelMongoRepository.js";
import { MongoKnowledgeEntityRepository } from "../modules/knowledge/knowledgeEntityMongoRepository.js";
import { MongoKnowledgeRelationshipRepository } from "../modules/knowledge/knowledgeRelationshipMongoRepository.js";
import { MongoKnowledgeIndicatorRepository } from "../modules/knowledge/knowledgeIndicatorMongoRepository.js";

/**
 * Developer-only inspection tool — dumps a project's current Project
 * Knowledge Model (the model record plus every entity, relationship, and
 * indicator under it) as JSON. There is deliberately no HTTP route for
 * this: the PKM has no real consumer yet (that's Phase 5's job), and a
 * "dump the knowledge graph" endpoint is not something to expose over
 * HTTP speculatively, even behind auth. This is inspection tooling for
 * local development, not a product feature — run it directly:
 *
 *   node --import tsx src/scripts/inspectProjectKnowledgeModel.ts <projectId>
 */
async function run() {
  const projectId = process.argv[2];
  if (!projectId) {
    throw new Error("Usage: inspectProjectKnowledgeModel.ts <projectId>");
  }

  const config = loadConfig();
  await connectMongoDatabase(config);

  const projectKnowledgeModelRepository =
    new MongoProjectKnowledgeModelRepository();
  const knowledgeEntityRepository = new MongoKnowledgeEntityRepository();
  const knowledgeRelationshipRepository =
    new MongoKnowledgeRelationshipRepository();
  const knowledgeIndicatorRepository = new MongoKnowledgeIndicatorRepository();

  const model = await projectKnowledgeModelRepository.findByProjectId(
    projectId,
    databaseSession,
  );
  if (!model) {
    console.error(
      `No Project Knowledge Model exists yet for project ${projectId}. Run buildProjectKnowledgeModel.ts first.`,
    );
    process.exitCode = 1;
    return;
  }

  const [entities, relationships, indicators] = await Promise.all([
    knowledgeEntityRepository.listByProjectKnowledgeModelId(
      model.id,
      databaseSession,
    ),
    knowledgeRelationshipRepository.listByProjectKnowledgeModelId(
      model.id,
      databaseSession,
    ),
    knowledgeIndicatorRepository.listByProjectKnowledgeModelId(
      model.id,
      databaseSession,
    ),
  ]);

  console.log(
    `Project Knowledge Model ${model.id} for project ${projectId}: version ${model.version}, status ${model.status}, ${entities.length} entities, ${relationships.length} relationships, ${indicators.length} indicators.`,
  );
  console.log(
    JSON.stringify({ model, entities, relationships, indicators }, null, 2),
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
