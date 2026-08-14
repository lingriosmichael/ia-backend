import {
  databaseSession,
  type DatabaseSession,
} from "../../shared/database/databaseClient.js";
import type { LlmUsageSummary } from "../../shared/contracts.js";
import type { ActivityRepository } from "./activityRepository.js";

export class ActivityLlmTokenLedgerService {
  constructor(private readonly activityRepository: ActivityRepository) {}

  // activityId is nullable because not every LLM call that should count
  // toward a project's usage is activity-scoped (e.g. an upload not yet
  // linked to an activity) — those calls still record against the project
  // ledger, they just have nothing to add here.
  async recordUsage(
    activityId: string | null | undefined,
    usage: LlmUsageSummary | null | undefined,
    session: DatabaseSession = databaseSession,
  ): Promise<void> {
    if (!activityId || !usage || usage.totalTokens <= 0) {
      return;
    }

    await this.activityRepository.incrementLlmTokenLedger(
      activityId,
      {
        totalPromptTokensLifetime: usage.totalPromptTokens,
        totalCompletionTokensLifetime: usage.totalCompletionTokens,
        totalTokensLifetime: usage.totalTokens,
      },
      session,
    );
  }

  async recordUsages(
    activityId: string | null | undefined,
    usages: Array<LlmUsageSummary | null | undefined>,
    session: DatabaseSession = databaseSession,
  ): Promise<void> {
    if (!activityId) {
      return;
    }

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

    await this.activityRepository.incrementLlmTokenLedger(
      activityId,
      {
        totalPromptTokensLifetime,
        totalCompletionTokensLifetime,
        totalTokensLifetime,
      },
      session,
    );
  }
}
