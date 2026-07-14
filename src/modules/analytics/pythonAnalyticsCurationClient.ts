import { AppError } from "../../shared/errors/appError.js";
import type {
  DashboardCuration,
  EvidenceCatalog,
  ProjectContextForCuration,
} from "./analyticsContracts.js";

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
}
