import type {
  AIContextObject,
  DatasetContext,
  ProjectContext,
} from "../context/aiContextTypes.js";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResponse,
} from "./aiProvider.js";

function getDatasetContext(contexts: AIContextObject[]): DatasetContext | null {
  return contexts.find(
    (context) => context.kind === "dataset",
  ) as DatasetContext | null;
}

function getProjectContext(contexts: AIContextObject[]): ProjectContext | null {
  return contexts.find(
    (context) => context.kind === "project",
  ) as ProjectContext | null;
}

function buildInterpretationOutput(contexts: AIContextObject[]) {
  const dataset = getDatasetContext(contexts);

  return {
    summary: {
      title: dataset
        ? `Dataset interpretation for ${dataset.originalFileName}`
        : "Dataset interpretation",
      description: dataset
        ? `Prepared an initial schema interpretation for ${dataset.originalFileName}.`
        : "Prepared an initial schema interpretation.",
    },
    findings: [
      {
        type: "schema",
        message: dataset
          ? `Detected ${dataset.columns.length} columns in the uploaded dataset.`
          : "No dataset columns were provided for interpretation.",
      },
    ],
    privacyRisks: [],
    recommendations: [
      {
        type: "next_step",
        message: "Review semantic column mapping before deriving KPI outputs.",
      },
    ],
    confidence: dataset && dataset.columns.length > 0 ? 0.78 : 0.42,
  };
}

function buildAnalysisOutput(contexts: AIContextObject[]) {
  const project = getProjectContext(contexts);
  const dataset = getDatasetContext(contexts);

  return {
    summary: {
      title: project ? `Analysis for ${project.name}` : "Analysis output",
      description:
        "Generated chart-ready metrics and dashboard configuration placeholders.",
    },
    metrics: {
      datasetCount: dataset ? 1 : 0,
      beneficiarySegments: project?.targetBeneficiaries.length ?? 0,
      sdgCount: project?.sdgs.length ?? 0,
    },
    charts: [
      {
        type: "bar",
        title: "Evidence coverage by indicator",
      },
    ],
    trends: [
      {
        direction: "stable",
        message:
          "Trend analysis requires parsed tabular values to become more specific.",
      },
    ],
    recommendations: [
      {
        type: "data_quality",
        message: "Enrich column semantics before publishing dashboard outputs.",
      },
    ],
    confidence: 0.61,
  };
}

function buildInsightOutput(contexts: AIContextObject[]) {
  const project = getProjectContext(contexts);

  return {
    summary: {
      title: project ? `Insights for ${project.name}` : "Generated insights",
      description:
        "Produced narrative findings and recommended actions from available evidence context.",
    },
    findings: [
      {
        type: "coverage",
        message:
          "Current evidence supports high-level narrative insight generation.",
      },
    ],
    anomalies: [],
    opportunities: [
      {
        type: "improvement",
        message:
          "Capture normalized indicator values to strengthen comparative insight quality.",
      },
    ],
    recommendedActions: [
      {
        type: "next_step",
        message:
          "Confirm interpreted schema assumptions with a reviewer before sharing insights externally.",
      },
    ],
    confidence: 0.67,
  };
}

function buildReportOutput(contexts: AIContextObject[]) {
  const project = getProjectContext(contexts);

  return {
    summary: {
      title: project ? `Report draft for ${project.name}` : "Report draft",
      description:
        "Prepared structured report sections suitable for donor or executive outputs.",
    },
    sections: [
      {
        title: "Overview",
        content: "Structured report section generated from AI context.",
      },
      {
        title: "Evidence Summary",
        content: "Add validated metrics and insights to complete this export.",
      },
    ],
    exports: [
      {
        format: "json",
        ready: true,
      },
    ],
    confidence: 0.64,
  };
}

function buildChatOutput(contexts: AIContextObject[]) {
  const chatContext = contexts.find((context) => context.kind === "chat");

  return {
    summary: {
      title: "Chat response",
      description: "Generated a structured conversational answer.",
    },
    answer: {
      message:
        chatContext && "latestUserMessage" in chatContext
          ? `Structured response placeholder for: ${chatContext.latestUserMessage}`
          : "Structured response placeholder.",
    },
    followUpQuestions: ["Which evidence segment should be explored next?"],
    confidence: 0.58,
  };
}

export class MockAIProvider implements AIProvider {
  readonly providerKey = "mock";

  async generateStructuredOutput(
    request: AIProviderRequest,
  ): Promise<AIProviderResponse> {
    const output =
      request.pipelineKey === "interpret_dataset" ||
      request.pipelineKey === "review_dataset"
        ? buildInterpretationOutput(request.contexts)
        : request.pipelineKey === "generate_metrics" ||
            request.pipelineKey === "generate_dashboard"
          ? buildAnalysisOutput(request.contexts)
          : request.pipelineKey === "generate_insights"
            ? buildInsightOutput(request.contexts)
            : request.pipelineKey === "generate_report"
              ? buildReportOutput(request.contexts)
              : buildChatOutput(request.contexts);

    return {
      providerKey: this.providerKey,
      model: request.model,
      output,
      usage: {
        inputTokens: null,
        outputTokens: null,
      },
    };
  }
}
