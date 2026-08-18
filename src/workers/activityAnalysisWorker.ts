import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { createApplicationContext } from "../shared/bootstrap/createApplicationContext.js";
import { loadConfig } from "../shared/config/env.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "../shared/database/mongoose.js";
import type { ProcessingJobRecord } from "../shared/contracts.js";

const idlePollIntervalMs = 5_000;
const heartbeatIntervalMs = 30_000;
const supportedJobTypes = [
  "activity_analysis_v2",
  "qualitative_coding_review",
  "project_impact_story",
] as const;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function readLanguageFromPayload(
  payload: Record<string, unknown> | null,
): "de" | "en" {
  return payload?.language === "en" ? "en" : "de";
}

async function runClaimedJob(
  context: ReturnType<typeof createApplicationContext>,
  app: FastifyInstance,
  workerId: string,
  job: ProcessingJobRecord,
): Promise<void> {
  app.log.info(
    {
      workerId,
      processingJobId: job.id,
      jobType: job.jobType,
      activityId: job.activityId,
      uploadMetadataId: job.uploadMetadataId,
    },
    "activity analysis job claimed",
  );

  // Runs concurrently with the single long await below rather than being
  // gated on checkpoints between Python calls — network I/O doesn't block
  // Node's event loop or its timers, so this heartbeats correctly straight
  // through one arbitrarily long blocking call or several sequential ones.
  // Uses the same lease-renewal pattern as the other backend workers.
  const heartbeat = setInterval(() => {
    void context.processingJobService
      .renewLease(job.id, workerId)
      .catch((error) => {
        app.log.warn(
          { err: error, workerId, processingJobId: job.id },
          "activity analysis job lease renewal failed",
        );
      });
  }, heartbeatIntervalMs);

  try {
    const language = readLanguageFromPayload(job.payload);

    if (job.jobType === "activity_analysis_v2") {
      if (!job.activityId) {
        throw new Error("activity_analysis_v2 job is missing activityId.");
      }

      // previewActivityAnalysis re-validates readiness itself
      // (assertReadyForV2Run) before doing any Python call, so a job
      // claimed after upstream state changed (e.g. new evidence uploaded
      // since the job was enqueued) fails cleanly here rather than
      // operating on stale assumptions.
      await context.activityAnalysisV2Service.previewActivityAnalysis(
        job.triggeredById,
        job.activityId,
        language,
      );
    } else if (job.jobType === "qualitative_coding_review") {
      if (!job.uploadMetadataId) {
        throw new Error(
          "qualitative_coding_review job is missing uploadMetadataId.",
        );
      }

      await context.qualitativeCodingReviewService.generate(
        job.triggeredById,
        job.uploadMetadataId,
        language,
      );
    } else if (job.jobType === "project_impact_story") {
      // buildProjectImpactStory re-validates readiness itself
      // (assertReadyForImpactStoryRun) before doing any Python call, same
      // reasoning as the activity_analysis_v2 branch above.
      await context.projectImpactStoryService.buildProjectImpactStory(
        job.triggeredById,
        job.projectId,
        language,
      );
    } else {
      throw new Error(
        `Unsupported job type for activity analysis worker: ${job.jobType}`,
      );
    }

    // previewActivityAnalysis/generate persist their own result record
    // (activity_analysis_runs_v2 / qualitative_coding_reviews) as a normal
    // part of doing the work, including for a run that finishes with its
    // own internal "failed" status (e.g. a planner failure that
    // previewActivityAnalysis catches and turns into a persisted failed
    // run rather than throwing). The processing job itself is marked
    // completed whenever the call returns at all — the job's status means
    // "did the worker finish attempting this," not "did the analysis
    // succeed." Only a thrown exception marks the job failed.
    await context.processingJobService.completeBackendExecutedJob(
      job.id,
      workerId,
      { status: "completed" },
    );
  } catch (error) {
    app.log.error(
      { err: error, workerId, processingJobId: job.id },
      "activity analysis job failed",
    );

    await context.processingJobService
      .completeBackendExecutedJob(job.id, workerId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error.",
      })
      .catch((completionError) => {
        app.log.error(
          { err: completionError, workerId, processingJobId: job.id },
          "failed to record activity analysis job failure",
        );
      });
  } finally {
    clearInterval(heartbeat);
  }
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
  const workerId = `activity-analysis-worker:${hostname()}:${process.pid}:${randomUUID()}`;

  let shuttingDown = false;
  const inFlightJobs = new Set<Promise<void>>();

  const stop = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info(
      { workerId, inFlightJobCount: inFlightJobs.size },
      "activity analysis worker shutting down",
    );
    await Promise.allSettled([...inFlightJobs]);
    await disconnectMongoDatabase();
    await app.close();
  };

  process.on("SIGINT", () => {
    void stop().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void stop().finally(() => process.exit(0));
  });

  app.log.info(
    { workerId, concurrency: config.ACTIVITY_ANALYSIS_WORKER_CONCURRENCY },
    "activity analysis worker started",
  );

  while (!shuttingDown) {
    try {
      if (inFlightJobs.size >= config.ACTIVITY_ANALYSIS_WORKER_CONCURRENCY) {
        await Promise.race(inFlightJobs);
        continue;
      }

      const claimedJob =
        await context.processingJobService.claimNextRunnableBackendJob(
          workerId,
          [...supportedJobTypes],
        );

      if (!claimedJob) {
        await sleep(idlePollIntervalMs);
        continue;
      }

      const jobPromise: Promise<void> = runClaimedJob(
        context,
        app,
        workerId,
        claimedJob,
      ).finally(() => {
        inFlightJobs.delete(jobPromise);
      });
      inFlightJobs.add(jobPromise);
    } catch (error) {
      app.log.error(
        { err: error, workerId },
        "activity analysis worker loop failed",
      );
      await sleep(idlePollIntervalMs);
    }
  }
}

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
