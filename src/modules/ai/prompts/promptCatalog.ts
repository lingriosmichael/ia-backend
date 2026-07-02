import type { PromptTemplate } from "./promptTemplate.js";

export const defaultPromptTemplates: PromptTemplate[] = [
  {
    id: "interpretation.dataset.v1",
    domain: "interpretation",
    pipelineKey: "interpret_dataset",
    version: "v1",
    systemPrompt:
      "You interpret uploaded evidence datasets for grant-management workflows. Return structured JSON only.",
    userPrompt:
      "Interpret this dataset context and identify schema meaning, privacy risks, and transformation recommendations.\n\n{{context_json}}",
    requiredVariables: ["context_json"],
  },
  {
    id: "interpretation.review.v1",
    domain: "interpretation",
    pipelineKey: "review_dataset",
    version: "v1",
    systemPrompt:
      "You review dataset interpretations and highlight validation gaps. Return structured JSON only.",
    userPrompt:
      "Review the interpreted dataset context below and identify ambiguities, missing assumptions, and next checks.\n\n{{context_json}}",
    requiredVariables: ["context_json"],
  },
  {
    id: "analysis.metrics.v1",
    domain: "analysis",
    pipelineKey: "generate_metrics",
    version: "v1",
    systemPrompt:
      "You compute evidence metrics and chart-ready analytics. Return structured JSON only.",
    userPrompt:
      "Generate KPIs, trends, and chart recommendations from this analysis context.\n\n{{context_json}}",
    requiredVariables: ["context_json"],
  },
  {
    id: "analysis.dashboard.v1",
    domain: "analysis",
    pipelineKey: "generate_dashboard",
    version: "v1",
    systemPrompt:
      "You design dashboard configurations from grant evidence. Return structured JSON only.",
    userPrompt:
      "Create dashboard sections and chart configuration suggestions from this context.\n\n{{context_json}}",
    requiredVariables: ["context_json"],
  },
  {
    id: "insights.narrative.v1",
    domain: "insights",
    pipelineKey: "generate_insights",
    version: "v1",
    systemPrompt:
      "You surface narrative insights, anomalies, and opportunities from evidence. Return structured JSON only.",
    userPrompt:
      "Generate findings, anomalies, opportunities, and recommended actions from this context.\n\n{{context_json}}",
    requiredVariables: ["context_json"],
  },
  {
    id: "reporting.summary.v1",
    domain: "reporting",
    pipelineKey: "generate_report",
    version: "v1",
    systemPrompt:
      "You prepare structured report sections for donor and executive outputs. Return structured JSON only.",
    userPrompt:
      "Prepare a report-ready structured summary from this context.\n\n{{context_json}}",
    requiredVariables: ["context_json"],
  },
  {
    id: "chat.explainer.v1",
    domain: "chat",
    pipelineKey: "chat",
    version: "v1",
    systemPrompt:
      "You answer questions about grant evidence with traceable explanations. Return structured JSON only.",
    userPrompt:
      "Respond to the user question using the chat context below.\n\n{{context_json}}",
    requiredVariables: ["context_json"],
  },
];
