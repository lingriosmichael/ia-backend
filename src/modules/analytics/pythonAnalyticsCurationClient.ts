import { AppError } from "../../shared/errors/appError.js";
import type {
  AnalyticsDashboardWidgetCopyCandidate,
  AnalyticsDashboardWidgetCopySuggestion,
  DashboardCuration,
  EvidenceCatalog,
  ProjectContextForCuration,
} from "./analyticsContracts.js";

interface CurateDashboardWidgetCopyResponse {
  widgets: AnalyticsDashboardWidgetCopySuggestion[];
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
  ): Promise<DashboardCuration> {
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

    return response.json() as Promise<DashboardCuration>;
  }

  async curateWidgetCopy(
    widgets: AnalyticsDashboardWidgetCopyCandidate[],
    projectContext: ProjectContextForCuration,
    language: "de" | "en",
  ): Promise<AnalyticsDashboardWidgetCopySuggestion[]> {
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

    const payload =
      (await response.json()) as CurateDashboardWidgetCopyResponse;
    return payload.widgets;
  }
}
