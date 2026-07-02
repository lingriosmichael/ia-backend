import { AppError } from "../../../shared/errors/appError.js";
import type { AIPipelineKey } from "../aiTypes.js";
import type { AIPipelineRuntime } from "./pipelineRuntime.js";

export class AIPipelineRuntimeRegistry {
  private readonly runtimesByKey: Map<AIPipelineKey, AIPipelineRuntime>;

  constructor(runtimes: AIPipelineRuntime[]) {
    this.runtimesByKey = new Map(
      runtimes.map((runtime) => [runtime.definition.key, runtime]),
    );
  }

  getByKey(pipelineKey: AIPipelineKey): AIPipelineRuntime {
    const runtime = this.runtimesByKey.get(pipelineKey);

    if (!runtime) {
      throw new AppError(
        `AI pipeline runtime "${pipelineKey}" is not registered.`,
        500,
        "ai_pipeline_runtime_not_found",
      );
    }

    return runtime;
  }
}
