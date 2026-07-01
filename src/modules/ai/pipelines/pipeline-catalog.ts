import type { AIPipelineDefinition } from "./ai-pipeline.js";

export const defaultAIPipelines: AIPipelineDefinition[] = [
  {
    key: "interpret_dataset",
    domain: "interpretation",
    displayName: "Interpret Dataset",
    description:
      "Understands uploaded dataset structure, semantics, privacy risks, and transformation recommendations.",
    promptTemplateId: "interpretation.dataset.v1",
    jobType: "semantic_ingestion",
    outputKey: "dataset_interpretation",
    requiredContextKinds: ["dataset"],
  },
  {
    key: "review_dataset",
    domain: "interpretation",
    displayName: "Review Dataset",
    description:
      "Validates dataset interpretation outputs and surfaces ambiguities or missing assumptions.",
    promptTemplateId: "interpretation.review.v1",
    jobType: "manual_review",
    outputKey: "dataset_review",
    requiredContextKinds: ["dataset"],
  },
  {
    key: "generate_metrics",
    domain: "analysis",
    displayName: "Generate Metrics",
    description:
      "Computes KPI, trend, and chart-ready metric outputs from interpreted evidence.",
    promptTemplateId: "analysis.metrics.v1",
    jobType: "semantic_ingestion",
    outputKey: "analysis_metrics",
    requiredContextKinds: ["project", "dataset"],
  },
  {
    key: "generate_dashboard",
    domain: "analysis",
    displayName: "Generate Dashboard",
    description:
      "Suggests dashboard sections and chart configuration from project evidence.",
    promptTemplateId: "analysis.dashboard.v1",
    jobType: "other",
    outputKey: "dashboard_configuration",
    requiredContextKinds: ["project", "dataset"],
  },
  {
    key: "generate_insights",
    domain: "insights",
    displayName: "Generate Insights",
    description:
      "Produces narrative findings, anomalies, opportunities, and recommended actions.",
    promptTemplateId: "insights.narrative.v1",
    jobType: "other",
    outputKey: "insight_summary",
    requiredContextKinds: ["project", "dataset"],
  },
  {
    key: "generate_report",
    domain: "reporting",
    displayName: "Generate Report",
    description:
      "Creates structured report sections for donor or executive outputs.",
    promptTemplateId: "reporting.summary.v1",
    jobType: "export",
    outputKey: "report_bundle",
    requiredContextKinds: ["report", "project"],
  },
  {
    key: "chat",
    domain: "chat",
    displayName: "Chat",
    description:
      "Responds conversationally about project evidence with structured explanations.",
    promptTemplateId: "chat.explainer.v1",
    jobType: "other",
    outputKey: "chat_response",
    requiredContextKinds: ["chat"],
  },
];
