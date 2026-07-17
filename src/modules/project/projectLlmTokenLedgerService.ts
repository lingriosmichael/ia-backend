import {
  databaseSession,
  type DatabaseSession,
} from "../../shared/database/databaseClient.js";
import type { LlmUsageSummary } from "../../shared/contracts.js";
import type { ProjectRepository } from "./projectRepository.js";

export class ProjectLlmTokenLedgerService {
  constructor(private readonly projectRepository: ProjectRepository) {}

  async recordUsage(
    projectId: string,
    usage: LlmUsageSummary | null | undefined,
    session: DatabaseSession = databaseSession,
  ): Promise<void> {
    if (!usage || usage.totalTokens <= 0) {
      return;
    }

    await this.projectRepository.incrementLlmTokenLedger(
      projectId,
      {
        totalPromptTokensLifetime: usage.totalPromptTokens,
        totalCompletionTokensLifetime: usage.totalCompletionTokens,
        totalTokensLifetime: usage.totalTokens,
      },
      session,
    );
  }

  async recordUsages(
    projectId: string,
    usages: Array<LlmUsageSummary | null | undefined>,
    session: DatabaseSession = databaseSession,
  ): Promise<void> {
    let totalPromptTokensLifetime = 0;
    let totalCompletionTokensLifetime = 0;
    let totalTokensLifetime = 0;

    for (const usage of usages) {
      if (!usage || usage.totalTokens <= 0) {
        continue;
      }

      totalPromptTokensLifetime += usage.totalPromptTokens;
      totalCompletionTokensLifetime += usage.totalCompletionTokens;
      totalTokensLifetime += usage.totalTokens;
    }

    if (totalTokensLifetime <= 0) {
      return;
    }

    await this.projectRepository.incrementLlmTokenLedger(
      projectId,
      {
        totalPromptTokensLifetime,
        totalCompletionTokensLifetime,
        totalTokensLifetime,
      },
      session,
    );
  }
}
