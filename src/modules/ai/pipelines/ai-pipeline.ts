import type { ProcessingJobType } from "../../../shared/contracts.js";
import type { AIDomain, AIPipelineKey } from "../ai.types.js";
import type { AIContextKind } from "../context/ai-context.types.js";

export interface AIPipelineDefinition {
  key: AIPipelineKey;
  domain: AIDomain;
  displayName: string;
  description: string;
  promptTemplateId: string;
  jobType: ProcessingJobType;
  outputKey: string;
  requiredContextKinds: AIContextKind[];
}
