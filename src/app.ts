import { randomUUID } from "node:crypto";
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
import { registerInterpretationRoutes } from "./modules/interpretation/interpretationRoutes.js";
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
  const isProduction = process.env.NODE_ENV === "production";

  const app = Fastify({
    // A per-request UUID (rather than Fastify's default incrementing
    // counter) so request IDs stay unique across restarts and can be
    // correlated with the same request's logs at the Python service if it
    // reflects the header back.
    genReqId: () => randomUUID(),
    // Fastify's built-in request/response logging doesn't pick up the
    // authenticated userId attached in authenticate.ts (it captures its own
    // logger reference earlier in the request lifecycle), so it's disabled
    // in favor of the two explicit hooks below, which do.
    disableRequestLogging: true,
    logger: {
      level: isProduction ? "info" : "debug",
      // Raw JSON in production for log aggregation; pretty-printed in dev
      // for readability at the terminal.
      transport: isProduction
        ? undefined
        : { target: "pino-pretty", options: { colorize: true } },
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['x-internal-service-token']",
        ],
        censor: "[redacted]",
      },
    },
  });

  // The frontend polls job-status endpoints on a fixed interval (e.g. once a
  // second) while a job is in flight — logging every poll at the same level
  // as every other request buries the one line that's actually actionable.
  // Polling requests are still handled normally; they're just excluded from
  // this access log. Real progress is logged separately, once per actual
  // status change, by ProcessingJobService.
  function isPollingRoute(url: string): boolean {
    return url.includes("/sync") || /\/jobs$/.test(url.split("?")[0] ?? "");
  }

  // Every request logs on arrival (before auth, so even a rejected or
  // crashed request leaves a trace) and again on completion. The
  // completion line picks up `userId` automatically once authenticate.ts
  // has bound it to request.log, giving a full trail of who called what,
  // when, and with what outcome — without needing to add logging to every
  // individual route handler.
  app.addHook("onRequest", async (request) => {
    if (isPollingRoute(request.url)) {
      return;
    }
    request.log.info(
      { method: request.method, url: request.url },
      "request received",
    );
  });

  app.addHook("onResponse", async (request, reply) => {
    if (isPollingRoute(request.url) && reply.statusCode < 400) {
      return;
    }
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
      },
      "request completed",
    );
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

  const context = createApplicationContext(config, app.log);

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
    context.requireInternalServiceSecret,
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
  await registerInterpretationRoutes(
    app,
    context.interpretationController,
    context.authenticate,
  );

  registerErrorHandler(app);

  return app;
}
