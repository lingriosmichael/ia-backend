import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { registerActivityRoutes } from "./modules/activity/activity.routes.js";
import { registerResultRoutes } from "./modules/ai/artifact/result.routes.js";
import { registerProcessingJobRoutes } from "./modules/ai/execution/processing-job.routes.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerHealthRoutes } from "./modules/health/health.routes.js";
import { registerOrganizationRoutes } from "./modules/organization/organization.routes.js";
import { registerProjectRoutes } from "./modules/project/project.routes.js";
import { registerActivityUploadRoutes } from "./modules/upload/activity-upload.routes.js";
import { registerUploadMetadataRoutes } from "./modules/upload/upload-metadata.routes.js";
import type { BackendConfig } from "./shared/config/env.js";
import { createApplicationContext } from "./shared/bootstrap/create-application-context.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "./shared/database/mongoose.js";
import { registerErrorHandler } from "./shared/errors/error-handler.js";

export async function buildApp(config: BackendConfig) {
  const app = Fastify({
    logger: false,
  });

  await connectMongoDatabase(config);
  app.addHook("onClose", async () => {
    await disconnectMongoDatabase();
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: false,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 1,
    },
  });

  const context = createApplicationContext(config);

  await registerHealthRoutes(app, context.healthController);
  await registerAuthRoutes(app, context.authController, context.authenticate);
  await registerOrganizationRoutes(
    app,
    context.organizationController,
    context.authenticate,
  );
  await registerProjectRoutes(app, context.projectController, context.authenticate);
  await registerActivityRoutes(app, context.activityController, context.authenticate);
  await registerActivityUploadRoutes(
    app,
    context.activityUploadController,
    context.authenticate,
  );
  await registerUploadMetadataRoutes(
    app,
    context.uploadMetadataController,
    context.authenticate,
  );
  await registerProcessingJobRoutes(
    app,
    context.processingJobController,
    context.authenticate,
  );
  await registerResultRoutes(app, context.resultController, context.authenticate);

  registerErrorHandler(app);

  return app;
}
