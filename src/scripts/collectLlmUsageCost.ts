import { loadConfig } from "../shared/config/env.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "../shared/database/mongoose.js";
import { databaseSession } from "../shared/database/databaseClient.js";
import { mergeLlmUsage } from "../shared/utils/llmUsage.js";
import type { LlmUsageCall, LlmUsageSummary } from "../shared/contracts.js";
import { MongoProjectRepository } from "../modules/project/projectMongoRepository.js";
import { MongoActivityRepository } from "../modules/activity/activityMongoRepository.js";
import { MongoInterpretationResultRepository } from "../modules/interpretation/interpretationResultMongoRepository.js";
import { MongoActivityAnalysisRunV2Repository } from "../modules/interpretation/activityAnalysisRunV2MongoRepository.js";
import { MongoProjectImpactStoryRepository } from "../modules/projectImpactStory/projectImpactStoryMongoRepository.js";
import type { ActivityPersistenceRecord } from "../modules/activity/activityPersistence.js";

/**
 * Developer-only cost/usage inspection tool — sums every persisted
 * LlmUsageSummary for one project (optionally scoped further to one
 * activity within it) and prints a plain-text summary: cost and tokens
 * per feature, per pipeline stage, and a cross-check against the
 * project/activity's lifetime token ledger (see
 * projectLlmTokenLedgerService.ts / activityLlmTokenLedgerService.ts) so
 * gaps in what's captured are visible rather than silently absorbed.
 *
 * There is deliberately no HTTP route for this — it's a one-off reporting
 * script for manually costing a single fresh end-to-end run, not a
 * product feature. Run it directly:
 *
 *   node --import tsx src/scripts/collectLlmUsageCost.ts <projectId> [activityId]
 */

interface FeatureUsage {
  featureName: string;
  usage: LlmUsageSummary | null;
}

function formatUsd(amount: number | null): string {
  if (amount === null) {
    return "unknown";
  }
  return `$${amount.toFixed(4)}`;
}

function formatInt(value: number | null): string {
  return value === null ? "unknown" : value.toLocaleString("en-US");
}

function printFeatureRow(feature: FeatureUsage) {
  const usage = feature.usage;
  if (!usage) {
    console.log(`  ${feature.featureName.padEnd(28)} no calls recorded`);
    return;
  }
  console.log(
    `  ${feature.featureName.padEnd(28)} calls=${usage.totalCalls
      .toString()
      .padEnd(
        5,
      )} tokens=${formatInt(usage.totalTokens).padEnd(12)} cost=${formatUsd(
      usage.totalEstimatedCostUsd,
    )}`,
  );
}

/**
 * Groups every individual call across every feature by stageName, so
 * "which stage actually costs the most" is a real number instead of the
 * structural guess (chain length, prompt size) OPENAI_CALL_INVENTORY had
 * to fall back on before this data existed.
 */
function summarizeByStage(calls: LlmUsageCall[]) {
  const byStage = new Map<
    string,
    {
      calls: number;
      tokens: number;
      knownCostUsd: number;
      unpricedCalls: number;
    }
  >();

  for (const call of calls) {
    const entry = byStage.get(call.stageName) ?? {
      calls: 0,
      tokens: 0,
      knownCostUsd: 0,
      unpricedCalls: 0,
    };
    entry.calls += 1;
    entry.tokens += call.totalTokens;
    if (call.estimatedCostUsd === null) {
      entry.unpricedCalls += 1;
    } else {
      entry.knownCostUsd += call.estimatedCostUsd;
    }
    byStage.set(call.stageName, entry);
  }

  return Array.from(byStage.entries()).sort(
    (a, b) => b[1].knownCostUsd - a[1].knownCostUsd,
  );
}

async function run() {
  const projectId = process.argv[2];
  const activityIdFilter = process.argv[3] ?? null;
  if (!projectId) {
    throw new Error("Usage: collectLlmUsageCost.ts <projectId> [activityId]");
  }

  const config = loadConfig();
  await connectMongoDatabase(config);

  const projectRepository = new MongoProjectRepository();
  const activityRepository = new MongoActivityRepository();
  const interpretationResultRepository =
    new MongoInterpretationResultRepository();
  const activityAnalysisRunV2Repository =
    new MongoActivityAnalysisRunV2Repository();
  const projectImpactStoryRepository = new MongoProjectImpactStoryRepository();

  const project = await projectRepository.findById(projectId, databaseSession);
  if (!project) {
    console.error(`No project found for id ${projectId}.`);
    process.exitCode = 1;
    return;
  }

  let activity: ActivityPersistenceRecord | null = null;
  if (activityIdFilter) {
    activity = await activityRepository.findById(
      activityIdFilter,
      databaseSession,
    );
    if (!activity || activity.projectId !== projectId) {
      console.error(
        `No activity ${activityIdFilter} found under project ${projectId}.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const [allInterpretationResults, allAnalysisRuns, impactStory, activities] =
    await Promise.all([
      interpretationResultRepository.findAllByProjectId(
        projectId,
        databaseSession,
      ),
      activityAnalysisRunV2Repository.listByProjectId(
        projectId,
        10_000,
        databaseSession,
      ),
      projectImpactStoryRepository.findLatestByProjectId(
        projectId,
        databaseSession,
      ),
      activityRepository.listByProject(projectId, databaseSession),
    ]);

  const interpretationResults = activityIdFilter
    ? allInterpretationResults.filter(
        (result) => result.activityId === activityIdFilter,
      )
    : allInterpretationResults;
  const analysisRuns = activityIdFilter
    ? allAnalysisRuns.filter((run) => run.activityId === activityIdFilter)
    : allAnalysisRuns;

  const interpretationUsage =
    interpretationResults.reduce<LlmUsageSummary | null>(
      (acc, result) => mergeLlmUsage(acc, result.llmUsage),
      null,
    );
  const analysisRunUsage = analysisRuns.reduce<LlmUsageSummary | null>(
    (acc, analysisRun) => mergeLlmUsage(acc, analysisRun.llmUsage),
    null,
  );
  const impactStoryUsage = impactStory?.llmUsage ?? null;

  console.log("=".repeat(72));
  console.log(
    activity
      ? `LLM usage — project "${project.name}" / activity "${activity.name}"`
      : `LLM usage — project "${project.name}" (all activities)`,
  );
  console.log("=".repeat(72));

  console.log("\nPer feature:");
  printFeatureRow({
    featureName: "Interpretation pipeline",
    usage: interpretationUsage,
  });
  printFeatureRow({
    featureName: "ActivityAnalystV2 planning",
    usage: analysisRunUsage,
  });
  if (activity) {
    console.log(
      "  Project Impact Story          project-wide feature, not attributable to a single activity — shown separately below",
    );
  } else {
    printFeatureRow({
      featureName: "Project Impact Story",
      usage: impactStoryUsage,
    });
  }

  // Everything actually attributable to the requested scope (activity, or
  // whole project). Impact Story is project-wide by design (see
  // ProjectImpactStoryRecord's own comment in contracts.ts), so it's only
  // folded into the total when reporting at the project level.
  const scopedUsage = activity
    ? mergeLlmUsage(interpretationUsage, analysisRunUsage)
    : mergeLlmUsage(
        mergeLlmUsage(interpretationUsage, analysisRunUsage),
        impactStoryUsage,
      );

  console.log("\nCombined total (this scope):");
  console.log(`  Calls:              ${scopedUsage?.totalCalls ?? 0}`);
  console.log(
    `  Tokens:             ${formatInt(scopedUsage?.totalTokens ?? 0)}`,
  );
  console.log(
    `  Cost (strict):      ${formatUsd(scopedUsage?.totalEstimatedCostUsd ?? 0)}` +
      (scopedUsage?.totalEstimatedCostUsd === null
        ? "  <- null because at least one call used a model with no pricing entry"
        : ""),
  );

  const allCalls = scopedUsage?.calls ?? [];
  const floorCostUsd = allCalls.reduce(
    (sum, call) => sum + (call.estimatedCostUsd ?? 0),
    0,
  );
  const unpricedCallCount = allCalls.filter(
    (call) => call.estimatedCostUsd === null,
  ).length;
  console.log(
    `  Cost (floor est.):  ${formatUsd(floorCostUsd)}` +
      (unpricedCallCount > 0
        ? `  <- excludes ${unpricedCallCount} call(s) with no pricing entry for their model`
        : ""),
  );

  console.log("\nPer stage (sorted by known cost, descending):");
  const stageBreakdown = summarizeByStage(allCalls);
  if (stageBreakdown.length === 0) {
    console.log("  (no calls recorded in this scope)");
  }
  for (const [stageName, stats] of stageBreakdown) {
    console.log(
      `  ${stageName.padEnd(38)} calls=${stats.calls.toString().padEnd(4)} tokens=${formatInt(
        stats.tokens,
      ).padEnd(10)} cost=${formatUsd(stats.knownCostUsd)}` +
        (stats.unpricedCalls > 0 ? ` (+${stats.unpricedCalls} unpriced)` : ""),
    );
  }

  // Cross-check against the lifetime token ledger (incremented by every
  // recordUsage/recordUsages call, including features with no persisted
  // per-call breakdown — qualitative coding review, outcome-evidence
  // pairing, display-label generation). The delta is exactly the token
  // volume this report cannot price, because no stored record carries
  // those calls' model/cost detail — see the ledger's own comment in
  // activityAnalysisRunV2Persistence.ts.
  const ledgerTokens = activity
    ? (activity.llmTokenLedger?.totalTokensLifetime ?? 0)
    : (project.llmTokenLedger?.totalTokensLifetime ?? 0);
  const reportedTokens = scopedUsage?.totalTokens ?? 0;
  const unaccountedTokens = ledgerTokens - reportedTokens;

  console.log("\nLedger cross-check:");
  console.log(
    `  Lifetime ledger tokens (this scope): ${formatInt(ledgerTokens)}`,
  );
  console.log(
    `  Tokens priced above:                 ${formatInt(reportedTokens)}`,
  );
  if (unaccountedTokens > 0) {
    console.log(
      `  Unaccounted tokens:                  ${formatInt(unaccountedTokens)}  <- qualitative coding review, outcome-evidence pairing, and display-label calls feed the ledger but have no persisted per-call record to price here`,
    );
  } else if (unaccountedTokens < 0) {
    console.log(
      `  Ledger is ${formatInt(-unaccountedTokens)} tokens lower than the reported total — the ledger predates one of these records, or the project/activity ledger was reset. Investigate before trusting either number.`,
    );
  } else {
    console.log("  Ledger matches exactly — nothing unaccounted for.");
  }

  if (!activity) {
    console.log("\nPer-activity breakdown:");
    for (const activityRecord of activities) {
      const activityInterpretation = allInterpretationResults
        .filter((result) => result.activityId === activityRecord.id)
        .reduce<LlmUsageSummary | null>(
          (acc, result) => mergeLlmUsage(acc, result.llmUsage),
          null,
        );
      const activityAnalysisUsage = allAnalysisRuns
        .filter((analysisRun) => analysisRun.activityId === activityRecord.id)
        .reduce<LlmUsageSummary | null>(
          (acc, analysisRun) => mergeLlmUsage(acc, analysisRun.llmUsage),
          null,
        );
      const activityTotal = mergeLlmUsage(
        activityInterpretation,
        activityAnalysisUsage,
      );
      const activityCalls = activityTotal?.calls ?? [];
      const activityFloorCost = activityCalls.reduce(
        (sum, call) => sum + (call.estimatedCostUsd ?? 0),
        0,
      );
      console.log(
        `  ${activityRecord.name.padEnd(32)} calls=${(
          activityTotal?.totalCalls ?? 0
        )
          .toString()
          .padEnd(4)} tokens=${formatInt(
          activityTotal?.totalTokens ?? 0,
        ).padEnd(10)} cost=${formatUsd(activityFloorCost)}`,
      );
    }
    const unassignedInterpretation = allInterpretationResults
      .filter((result) => result.activityId === null)
      .reduce<LlmUsageSummary | null>(
        (acc, result) => mergeLlmUsage(acc, result.llmUsage),
        null,
      );
    if (unassignedInterpretation && unassignedInterpretation.totalCalls > 0) {
      console.log(
        `  ${"(evidence not linked to an activity)".padEnd(32)} calls=${unassignedInterpretation.totalCalls} tokens=${formatInt(
          unassignedInterpretation.totalTokens,
        )}`,
      );
    }
  }

  console.log(
    "\nNot included in this report (no persisted per-call cost record):",
  );
  console.log(
    "  - Qualitative coding review (propose/apply codes) — tracked in the lifetime ledger only",
  );
  console.log(
    "  - Outcome-evidence pairing recommendation — tracked in the lifetime ledger only",
  );
  console.log(
    "  - Display-label generation — cached globally across projects/orgs by content hash, so it is not meaningfully attributable to this project anyway",
  );
}

run()
  .then(async () => {
    await disconnectMongoDatabase();
  })
  .catch(async (error) => {
    console.error(error);
    await disconnectMongoDatabase();
    process.exit(1);
  });
