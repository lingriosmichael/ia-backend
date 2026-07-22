import { AppError } from "../../shared/errors/appError.js";
import type { LlmUsageSummary } from "../../shared/contracts.js";
import type {
  AnalyticsDashboardWidgetCopyCandidate,
  AnalyticsDashboardWidgetCopySuggestion,
  DashboardCuration,
  EvidenceCatalog,
  ProjectContextForCuration,
} from "./analyticsContracts.js";

interface CurateDashboardWidgetCopyResponse {
  widgets: AnalyticsDashboardWidgetCopySuggestion[];
  llmUsage?: LlmUsageSummary | null;
}

interface CurateAnalyticsResponse extends DashboardCuration {
  llmUsage?: LlmUsageSummary | null;
}

export class PythonAnalyticsCurationClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret: string,
    private readonly timeoutMs: number,
  ) {}

  private async request(
    path: string,
    init: RequestInit,
    unavailableMessage: string,
    unavailableCode: string,
    timeoutMessage: string,
    timeoutCode: string,
  ): Promise<Response> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new AppError(unavailableMessage, 502, unavailableCode);
      }

      return response;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new AppError(timeoutMessage, 504, timeoutCode);
      }

      throw error;
    }
  }

  async curate(
    catalog: EvidenceCatalog,
    projectContext: ProjectContextForCuration,
    language: "de" | "en",
  ): Promise<CurateAnalyticsResponse> {
    const response = await this.request(
      "/internal/analytics/curate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-service-token": this.sharedSecret,
        },
        body: JSON.stringify({ catalog, projectContext, language }),
      },
      "The Python analytics service did not accept the curation request.",
      "python_analytics_curation_unavailable",
      "The Python analytics service timed out while curating the dashboard.",
      "python_analytics_curation_timeout",
    );

    return response.json() as Promise<CurateAnalyticsResponse>;
  }

  async curateWidgetCopy(
    widgets: AnalyticsDashboardWidgetCopyCandidate[],
    projectContext: ProjectContextForCuration,
    language: "de" | "en",
  ): Promise<CurateDashboardWidgetCopyResponse> {
    const response = await this.request(
      "/internal/analytics/curate-widget-copy",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-service-token": this.sharedSecret,
        },
        body: JSON.stringify({ widgets, projectContext, language }),
      },
      "The Python analytics service did not accept the widget-copy curation request.",
      "python_analytics_widget_copy_unavailable",
      "The Python analytics service timed out while curating widget copy.",
      "python_analytics_widget_copy_timeout",
    );

    return response.json() as Promise<CurateDashboardWidgetCopyResponse>;
  }
}
