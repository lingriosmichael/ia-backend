import { AppError } from "../../shared/errors/appError.js";
import type { LlmUsageSummary } from "../../shared/contracts.js";
import type {
  AnalyticsDashboardWidgetCopyCandidate,
  AnalyticsDashboardWidgetCopySuggestion,
  DashboardCuration,
  EvidenceCatalog,
  ProjectContextForCuration,
  ReportReadinessActivityCoverage,
  ReportReadinessCheckResult,
  ReportReadinessOpenQuestion,
} from "./analyticsContracts.js";

interface CurateDashboardWidgetCopyResponse {
  widgets: AnalyticsDashboardWidgetCopySuggestion[];
  llmUsage?: LlmUsageSummary | null;
}

interface CurateAnalyticsResponse extends DashboardCuration {
  llmUsage?: LlmUsageSummary | null;
}

interface GenerateReportReadinessCheckResponse extends Omit<
  ReportReadinessCheckResult,
  "generatedAt"
> {
  llmUsage?: LlmUsageSummary | null;
}

export class PythonAnalyticsCurationClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret: string,
  ) {}

  async curate(
    catalog: EvidenceCatalog,
    projectContext: ProjectContextForCuration,
    language: "de" | "en",
  ): Promise<CurateAnalyticsResponse> {
    const response = await fetch(`${this.baseUrl}/internal/analytics/curate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-service-token": this.sharedSecret,
      },
      body: JSON.stringify({ catalog, projectContext, language }),
    });

    if (!response.ok) {
      throw new AppError(
        "The Python analytics service did not accept the curation request.",
        502,
        "python_analytics_curation_unavailable",
      );
    }

    return response.json() as Promise<CurateAnalyticsResponse>;
  }

  async curateWidgetCopy(
    widgets: AnalyticsDashboardWidgetCopyCandidate[],
    projectContext: ProjectContextForCuration,
    language: "de" | "en",
  ): Promise<CurateDashboardWidgetCopyResponse> {
    const response = await fetch(
      `${this.baseUrl}/internal/analytics/curate-widget-copy`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-service-token": this.sharedSecret,
        },
        body: JSON.stringify({ widgets, projectContext, language }),
      },
    );

    if (!response.ok) {
      throw new AppError(
        "The Python analytics service did not accept the widget-copy curation request.",
        502,
        "python_analytics_widget_copy_unavailable",
      );
    }

    return response.json() as Promise<CurateDashboardWidgetCopyResponse>;
  }

  async generateReportReadinessCheck(
    catalog: EvidenceCatalog,
    projectContext: ProjectContextForCuration,
    openQuestions: ReportReadinessOpenQuestion[],
    activityCoverage: ReportReadinessActivityCoverage[],
    language: "de" | "en",
  ): Promise<GenerateReportReadinessCheckResponse> {
    const response = await fetch(
      `${this.baseUrl}/internal/analytics/report-readiness-check`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-service-token": this.sharedSecret,
        },
        body: JSON.stringify({
          catalog,
          projectContext,
          openQuestions,
          activityCoverage,
          language,
        }),
      },
    );

    if (!response.ok) {
      throw new AppError(
        "The Python analytics service did not accept the report readiness check request.",
        502,
        "python_analytics_report_readiness_check_unavailable",
      );
    }

    return response.json() as Promise<GenerateReportReadinessCheckResponse>;
  }
}
