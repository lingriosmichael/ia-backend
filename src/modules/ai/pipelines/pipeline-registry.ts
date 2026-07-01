import { AppError } from "../../../shared/errors/app-error.js";
import type { AIPipelineKey } from "../ai.types.js";
import type { AIPipelineDefinition } from "./ai-pipeline.js";

export class AIPipelineRegistry {
  private readonly pipelinesByKey: Map<AIPipelineKey, AIPipelineDefinition>;

  constructor(pipelines: AIPipelineDefinition[]) {
    this.pipelinesByKey = new Map(
      pipelines.map((pipeline) => [pipeline.key, pipeline]),
    );
  }

  getByKey(pipelineKey: AIPipelineKey): AIPipelineDefinition {
    const pipeline = this.pipelinesByKey.get(pipelineKey);

    if (!pipeline) {
      throw new AppError(
        `AI pipeline "${pipelineKey}" is not registered.`,
        500,
        "ai_pipeline_not_found",
      );
    }

    return pipeline;
  }

  list(): AIPipelineDefinition[] {
    return [...this.pipelinesByKey.values()];
  }
}
