import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createApplicationContext } from "../shared/bootstrap/createApplicationContext.js";
import { loadConfig } from "../shared/config/env.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "../shared/database/mongoose.js";

const idlePollIntervalMs = 5_000;
const heartbeatIntervalMs = 30_000;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function start() {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { colorize: true } },
    },
  });

  await connectMongoDatabase(config);
  const context = createApplicationContext(config, app.log);
  const workerId = `analytics-worker:${hostname()}:${process.pid}:${randomUUID()}`;

  let shuttingDown = false;
  const stop = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info({ workerId }, "analytics worker shutting down");
    await disconnectMongoDatabase();
    await app.close();
  };

  process.on("SIGINT", () => {
    void stop().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void stop().finally(() => process.exit(0));
  });

  app.log.info({ workerId }, "analytics worker started");

  while (!shuttingDown) {
    try {
      const claimedExecution =
        await context.analyticsExecutionService.claimNextRunnableExecution(
          workerId,
        );

      if (!claimedExecution) {
        await sleep(idlePollIntervalMs);
        continue;
      }

      app.log.info(
        {
          workerId,
          analyticsExecutionId: claimedExecution.id,
          scopeType: claimedExecution.scopeType,
          projectId: claimedExecution.projectId,
          activityId: claimedExecution.activityId,
          attemptCount: claimedExecution.attemptCount,
        },
        "analytics execution claimed",
      );

      const heartbeat = setInterval(() => {
        void context.analyticsExecutionService
          .renewLease(claimedExecution.id, workerId)
          .catch((error) => {
            app.log.warn(
              {
                err: error,
                workerId,
                analyticsExecutionId: claimedExecution.id,
              },
              "analytics execution lease renewal failed",
            );
          });
      }, heartbeatIntervalMs);

      try {
        await context.analyticsExecutionService.executeClaimedExecution(
          claimedExecution.id,
          workerId,
        );
      } catch (error) {
        app.log.error(
          {
            err: error,
            workerId,
            analyticsExecutionId: claimedExecution.id,
          },
          "analytics execution failed",
        );
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      app.log.error({ err: error, workerId }, "analytics worker loop failed");
      await sleep(idlePollIntervalMs);
    }
  }
}

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
