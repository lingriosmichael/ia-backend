import type { FastifyBaseLogger } from "fastify";

type StageStatus = "completed" | "failed" | "waiting_for_user" | "skipped";

export interface PipelineStageLogContext {
  pipeline: string;
  stage: string;
  processingJobId?: string | null;
  pipelineRunId?: string | null;
  activityId?: string | null;
  uploadMetadataId?: string | null;
  projectId?: string | null;
  inputFingerprint?: string | null;
  attempt?: number | null;
  [key: string]: unknown;
}

function buildStageLogContext(
  context: PipelineStageLogContext,
  startedAt: number,
  extra?: Record<string, unknown>,
) {
  return {
    ...context,
    ...(extra ?? {}),
    durationMs: Date.now() - startedAt,
  };
}

export async function runLoggedPipelineStage<T>(
  logger: FastifyBaseLogger,
  context: PipelineStageLogContext,
  run: () => Promise<T>,
  options?: {
    completedContext?: (result: T) => Record<string, unknown>;
  },
): Promise<T> {
  const startedAt = Date.now();
  logger.info(context, "pipeline stage started");

  try {
    const result = await run();
    logger.info(
      buildStageLogContext(
        context,
        startedAt,
        options?.completedContext?.(result),
      ),
      "pipeline stage completed",
    );
    return result;
  } catch (error) {
    logger.error(
      {
        ...buildStageLogContext(context, startedAt),
        err: error,
      },
      "pipeline stage failed",
    );
    throw error;
  }
}

export function logPipelineStageStatus(
  logger: FastifyBaseLogger,
  context: PipelineStageLogContext,
  status: StageStatus,
  extra?: Record<string, unknown>,
) {
  logger.info(
    {
      ...context,
      ...(extra ?? {}),
      status,
    },
    `pipeline stage ${status}`,
  );
}
