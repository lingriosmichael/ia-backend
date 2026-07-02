import type { ProcessingJobType } from "../../shared/contracts.js";

export const aiDomainValues = [
  "interpretation",
  "analysis",
  "insights",
  "reporting",
  "chat",
] as const;

export type AIDomain = (typeof aiDomainValues)[number];

export const aiPipelineKeyValues = [
  "interpret_dataset",
  "review_dataset",
  "generate_metrics",
  "generate_dashboard",
  "generate_insights",
  "generate_report",
  "chat",
] as const;

export type AIPipelineKey = (typeof aiPipelineKeyValues)[number];

export interface AIExecutionMetadata {
  pipelineKey: AIPipelineKey;
  promptTemplateId: string;
  promptVersion: string;
  providerKey: string | null;
  requiredContextKinds: string[];
  requestedAt: string;
}

export interface AIJobMapping {
  jobType: ProcessingJobType;
}
