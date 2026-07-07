import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { registerActivityRoutes } from "./modules/activity/activityRoutes.js";
import { registerResultRoutes } from "./modules/ai/artifact/resultRoutes.js";
import { registerProcessingJobRoutes } from "./modules/ai/execution/processingJobRoutes.js";
import { registerAuthRoutes } from "./modules/auth/authRoutes.js";
import { registerHealthRoutes } from "./modules/health/healthRoutes.js";
import { registerInvitationRoutes } from "./modules/invitation/invitationRoutes.js";
import { registerOrganizationRoutes } from "./modules/organization/organizationRoutes.js";
import { registerProjectRoutes } from "./modules/project/projectRoutes.js";
import { registerPrivacyReviewRoutes } from "./modules/processing/privacyReviewRoutes.js";
import { registerActivityUploadRoutes } from "./modules/upload/activityUploadRoutes.js";
import { registerUploadMetadataRoutes } from "./modules/upload/uploadMetadataRoutes.js";
import type { BackendConfig } from "./shared/config/env.js";
import { createApplicationContext } from "./shared/bootstrap/createApplicationContext.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "./shared/database/mongoose.js";
import { registerErrorHandler } from "./shared/errors/errorHandler.js";

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

  // Registered with global: false so it only applies to routes that opt in
  // via `config: { rateLimit: {...} }` — currently just /auth/login and
  // /auth/register (see authRoutes.ts), the credential-stuffing targets.
  await app.register(rateLimit, {
    global: false,
  });

  const context = createApplicationContext(config);

  await registerHealthRoutes(app, context.healthController);
  await registerAuthRoutes(app, context.authController, context.authenticate);
  await registerInvitationRoutes(
    app,
    context.invitationController,
    context.authenticate,
    context.authenticateIfPresent,
  );
  await registerOrganizationRoutes(
    app,
    context.organizationController,
    context.authenticate,
  );
  await registerProjectRoutes(
    app,
    context.projectController,
    context.authenticate,
  );
  await registerActivityRoutes(
    app,
    context.activityController,
    context.authenticate,
  );
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
  await registerPrivacyReviewRoutes(
    app,
    context.privacyReviewController,
    context.authenticate,
  );
  await registerResultRoutes(
    app,
    context.resultController,
    context.authenticate,
  );

  registerErrorHandler(app);

  return app;
}
