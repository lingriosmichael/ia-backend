import { loadConfig } from "../shared/config/env.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "../shared/database/mongoose.js";
import { databaseSession } from "../shared/database/databaseClient.js";
import { ActivityMongoModel } from "../modules/activity/activityModel.js";
import { MongoProjectRepository } from "../modules/project/projectMongoRepository.js";
import { MongoOutcomeEvidenceLinkRepository } from "../modules/outcome/outcomeEvidenceLinkMongoRepository.js";
import { MongoUploadMetadataRepository } from "../modules/upload/uploadMetadataMongoRepository.js";
import { MongoInterpretationResultRepository } from "../modules/interpretation/interpretationResultMongoRepository.js";
import { MongoDatasetPreparationRepository } from "../modules/interpretation/datasetPreparationMongoRepository.js";
import { MongoQualitativeCodingReviewRepository } from "../modules/processing/qualitativeCodingReviewMongoRepository.js";
import { MongoPrivacySafeRepresentationRepository } from "../modules/processing/privacySafeRepresentationMongoRepository.js";
import {
  buildOutcomeEvidenceCandidateCatalog,
  type OutcomeEvidenceCandidateCatalogDependencies,
} from "../modules/outcome/outcomeEvidenceCandidateCatalogBuilder.js";
import type { OutcomeEvidenceLinkPersistenceRecord } from "../modules/outcome/outcomeEvidenceLinkPersistence.js";

/**
 * OUTCOME_EVIDENCE_MERGE_PLAN.md / IMPACT_STORY_NARRATIVE_IMPROVEMENT_PLAN.md
 * §6 step 1 — "audit existing confirmable single_distribution
 * recommendations over subjective_code columns." Per §2a, confirming a
 * subjective_code column via the "Get recommendations" flow is currently
 * the *only* path any coded qualitative evidence has to either the
 * narrative or chart-plan LLM call — so this reports, for every project's
 * outcome_evidence activity, which subjective_code columns are sitting
 * unconfirmed today (nothing a human hasn't already had the chance to see
 * and reject; just evidence nobody has acted on yet).
 *
 * Read-only. Makes no LLM calls and writes nothing — it only reports what
 * the candidate catalog and current confirmed links already say
 * deterministically. Run it directly:
 *
 *   node --import tsx src/scripts/auditSubjectiveCodeSingleDistributionCandidates.ts
 */

interface UnconfirmedCandidate {
  uploadMetadataId: string;
  tableName: string;
  columnName: string;
  label: string;
}

interface AlreadyConfirmedSubjectiveCodeLink {
  columnName: string;
  shape: "single_distribution" | "paired_categorical_shift";
}

interface ActivityAuditResult {
  projectId: string;
  projectName: string;
  activityId: string;
  activityName: string;
  unconfirmedCandidates: UnconfirmedCandidate[];
  alreadyConfirmed: AlreadyConfirmedSubjectiveCodeLink[];
}

function linkedColumnKeys(
  links: OutcomeEvidenceLinkPersistenceRecord[],
): Set<string> {
  const keys = new Set<string>();
  for (const link of links) {
    if (link.shape === "single_distribution") {
      keys.add(
        `${link.uploadMetadataId}::${link.tableName}::${link.categoryColumnName}`,
      );
    } else {
      keys.add(
        `${link.beforeUploadMetadataId}::${link.beforeTableName}::${link.beforeColumnName}`,
      );
      keys.add(
        `${link.afterUploadMetadataId}::${link.afterTableName}::${link.afterColumnName}`,
      );
    }
  }
  return keys;
}

function alreadyConfirmedSubjectiveCodeColumns(
  links: OutcomeEvidenceLinkPersistenceRecord[],
  subjectiveCodeKeys: Set<string>,
): AlreadyConfirmedSubjectiveCodeLink[] {
  const result: AlreadyConfirmedSubjectiveCodeLink[] = [];
  for (const link of links) {
    if (link.shape === "single_distribution") {
      const key = `${link.uploadMetadataId}::${link.tableName}::${link.categoryColumnName}`;
      if (subjectiveCodeKeys.has(key)) {
        result.push({
          columnName: link.categoryColumnName,
          shape: "single_distribution",
        });
      }
      continue;
    }
    if (link.shape === "paired_categorical_shift") {
      const beforeKey = `${link.beforeUploadMetadataId}::${link.beforeTableName}::${link.beforeColumnName}`;
      const afterKey = `${link.afterUploadMetadataId}::${link.afterTableName}::${link.afterColumnName}`;
      if (subjectiveCodeKeys.has(beforeKey)) {
        result.push({
          columnName: link.beforeColumnName,
          shape: "paired_categorical_shift",
        });
      }
      if (subjectiveCodeKeys.has(afterKey)) {
        result.push({
          columnName: link.afterColumnName,
          shape: "paired_categorical_shift",
        });
      }
    }
  }
  return result;
}

async function run() {
  const config = loadConfig();
  await connectMongoDatabase(config);

  const projectRepository = new MongoProjectRepository();
  const outcomeEvidenceLinkRepository =
    new MongoOutcomeEvidenceLinkRepository();
  const catalogDependencies: OutcomeEvidenceCandidateCatalogDependencies = {
    uploadMetadataRepository: new MongoUploadMetadataRepository(),
    interpretationResultRepository: new MongoInterpretationResultRepository(),
    datasetPreparationRepository: new MongoDatasetPreparationRepository(),
    privacySafeRepresentationRepository:
      new MongoPrivacySafeRepresentationRepository(),
    qualitativeCodingReviewRepository:
      new MongoQualitativeCodingReviewRepository(),
  };

  const activities = await ActivityMongoModel.find({
    systemType: "outcome_evidence",
  }).lean();

  const projectNameCache = new Map<string, string>();
  const results: ActivityAuditResult[] = [];
  const errors: { activityId: string; projectId: string; error: string }[] = [];

  for (const activity of activities) {
    const activityId = activity._id;
    const projectId = activity.projectId;

    try {
      const catalog = await buildOutcomeEvidenceCandidateCatalog(
        catalogDependencies,
        activityId,
      );
      const subjectiveCodeCandidates = catalog.filter(
        (entry) => entry.epistemicRole === "subjective_code",
      );
      if (subjectiveCodeCandidates.length === 0) {
        continue;
      }

      const confirmedLinks =
        await outcomeEvidenceLinkRepository.listByActivityId(
          activityId,
          databaseSession,
        );
      const confirmedKeys = linkedColumnKeys(confirmedLinks);

      const subjectiveCodeKeys = new Set(
        subjectiveCodeCandidates.map(
          (entry) =>
            `${entry.uploadMetadataId}::${entry.tableName}::${entry.columnName}`,
        ),
      );

      const unconfirmedCandidates = subjectiveCodeCandidates
        .filter(
          (entry) =>
            !confirmedKeys.has(
              `${entry.uploadMetadataId}::${entry.tableName}::${entry.columnName}`,
            ),
        )
        .map((entry) => ({
          uploadMetadataId: entry.uploadMetadataId,
          tableName: entry.tableName,
          columnName: entry.columnName,
          label: entry.label,
        }));

      const alreadyConfirmed = alreadyConfirmedSubjectiveCodeColumns(
        confirmedLinks,
        subjectiveCodeKeys,
      );

      if (unconfirmedCandidates.length === 0 && alreadyConfirmed.length === 0) {
        continue;
      }

      let projectName = projectNameCache.get(projectId);
      if (projectName === undefined) {
        const project = await projectRepository.findById(
          projectId,
          databaseSession,
        );
        projectName = project?.name ?? "(project not found)";
        projectNameCache.set(projectId, projectName);
      }

      results.push({
        projectId,
        projectName,
        activityId,
        activityName: activity.name,
        unconfirmedCandidates,
        alreadyConfirmed,
      });
    } catch (error) {
      errors.push({
        activityId,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    `Scanned ${activities.length} outcome_evidence activities across all projects.\n`,
  );

  if (results.length === 0) {
    console.log(
      "No project has an unconfirmed subjective_code column, or every subjective_code candidate has already been reviewed.",
    );
  }

  let totalUnconfirmed = 0;
  let totalUpgradeCandidates = 0;
  for (const result of results) {
    totalUnconfirmed += result.unconfirmedCandidates.length;
    if (result.alreadyConfirmed.length >= 2) {
      totalUpgradeCandidates += 1;
    }

    console.log(
      `Project "${result.projectName}" (${result.projectId}) — activity "${result.activityName}" (${result.activityId})`,
    );
    if (result.unconfirmedCandidates.length > 0) {
      console.log(
        `  ${result.unconfirmedCandidates.length} unconfirmed subjective_code column(s) — has never been proposed/confirmed via "Get recommendations":`,
      );
      for (const candidate of result.unconfirmedCandidates) {
        console.log(
          `    - "${candidate.label}" (table "${candidate.tableName}", column "${candidate.columnName}", upload ${candidate.uploadMetadataId})`,
        );
      }
    }
    if (result.alreadyConfirmed.length >= 2) {
      console.log(
        `  ${result.alreadyConfirmed.length} subjective_code column(s) already confirmed on this activity — worth a manual look at whether any pair belongs together as paired_categorical_shift instead (not auto-detected; requires the codebook-reuse provenance check, this script only flags the count):`,
      );
      for (const link of result.alreadyConfirmed) {
        console.log(`    - "${link.columnName}" (currently ${link.shape})`);
      }
    }
    console.log("");
  }

  console.log(
    `Summary: ${totalUnconfirmed} unconfirmed subjective_code column(s) across ${results.length} activity/activities; ${totalUpgradeCandidates} activity/activities have 2+ already-confirmed subjective_code columns worth a manual look for a missed pairing.`,
  );

  if (errors.length > 0) {
    console.log(
      `\n${errors.length} activity/activities could not be scanned (skipped, not fatal):`,
    );
    for (const failure of errors) {
      console.log(
        `  - activity ${failure.activityId} (project ${failure.projectId}): ${failure.error}`,
      );
    }
  }
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
