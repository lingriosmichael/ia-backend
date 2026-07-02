import type { ProcessingJobType } from "../../../shared/contracts.js";
import type { AIDomain, AIPipelineKey } from "../aiTypes.js";
import type { AIContextKind } from "../context/aiContextTypes.js";

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
