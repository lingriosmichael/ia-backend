import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ActivityAnalysisRunV2Repository } from "./activityAnalysisRunV2Repository.js";
import { ActivityAnalysisV2Service } from "./activityAnalysisV2Service.js";
import { ActivityAnalysisV2ToolExecutor } from "./activityAnalysisV2ToolExecutor.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { QualitativeCodingReviewRepository } from "../processing/qualitativeCodingReviewRepository.js";
import { CurrentActivityEvidenceLoader } from "./currentActivityEvidenceLoader.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import type { DatasetPreparationService } from "./datasetPreparationService.js";
import type { DatasetPreparationRepository } from "./datasetPreparationRepository.js";
import type { CurrentActivityEvidenceSnapshot } from "./currentActivityEvidenceLoader.js";

const NOW = new Date("2026-08-09T10:00:00.000Z");
const WORKSPACE_ROOT = path.resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const DATA_ROOT = path.join(WORKSPACE_ROOT, "ia_webapp", "data");

function parseDelimitedLine(line: string, delimiter = ";"): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

async function loadDelimitedTable(
  relativePath: string,
  tableName?: string,
): Promise<{
  originalFileName: string;
  tableName: string;
  rows: Record<string, unknown>[];
}> {
  const absolutePath = path.join(DATA_ROOT, relativePath);
  const raw = await readFile(absolutePath, "utf8");
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const header = parseDelimitedLine(lines[0] ?? "");
  const rows = lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line);
    return Object.fromEntries(
      header.map((columnName, index) => [columnName, values[index] ?? ""]),
    );
  });

  return {
    originalFileName: path.basename(relativePath),
    tableName:
      tableName ?? path.basename(relativePath, path.extname(relativePath)),
    rows,
  };
}

function buildPayload(input: {
  tableName: string;
  rows: Record<string, unknown>[];
}): Record<string, unknown> {
  return {
    metadata: {
      evidenceModality: "structured_quantitative",
      interpretationDataType: "tabular_structured",
    },
    tables: [
      {
        name: input.tableName,
        rows: input.rows,
      },
    ],
  };
}

function createFixture(options: {
  uploads: Array<{
    id: string;
    logicalEvidenceId: string;
    originalFileName: string;
    payload: Record<string, unknown>;
    createdAt?: Date;
  }>;
  preparedDatasetsByUploadId: Record<string, Record<string, unknown>>;
  activityName: string;
  activityType?: string | null;
  activityObjectives?: string | null;
  activityOutput: string | null;
  plannerResponse: Awaited<
    ReturnType<PythonProcessingClient["planActivityAnalysisV2"]>
  >;
}) {
  const uploadRecords = options.uploads.map((upload) => ({
    id: upload.id,
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    logicalEvidenceId: upload.logicalEvidenceId,
    versionNumber: 1,
    originalFileName: upload.originalFileName,
    createdAt: upload.createdAt ?? NOW,
  }));

  const privacySafeRepresentations = options.uploads.map((upload) => ({
    id: `psr-${upload.id}`,
    uploadMetadataId: upload.id,
    payload: upload.payload,
  }));

  const uploadMetadataRepository = {
    listByActivityIds: async (activityIds: string[]) =>
      uploadRecords.filter((upload) => activityIds.includes(upload.activityId)),
  } as unknown as UploadMetadataRepository;

  const privacySafeRepresentationRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      privacySafeRepresentations.filter((representation) =>
        uploadMetadataIds.includes(representation.uploadMetadataId),
      ),
  } as unknown as PrivacySafeRepresentationRepository;

  const interpretationResults = options.uploads.map((upload, index) => ({
    id: `result-${index + 1}`,
    uploadMetadataId: upload.id,
  }));

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      interpretationResults.filter((result) =>
        uploadMetadataIds.includes(result.uploadMetadataId),
      ),
  } as unknown as InterpretationResultRepository;

  const preparationRecords = interpretationResults.map((result) => ({
    interpretationResultId: result.id,
    preparedDataset:
      options.preparedDatasetsByUploadId[result.uploadMetadataId],
  }));

  const datasetPreparationRepository = {
    findByInterpretationResultIds: async (interpretationResultIds: string[]) =>
      preparationRecords.filter((preparation) =>
        interpretationResultIds.includes(preparation.interpretationResultId),
      ),
  } as unknown as DatasetPreparationRepository;

  const datasetPreparationService =
    datasetPreparationRepository as unknown as DatasetPreparationService;
  const qualitativeCodingReviewRepository = {
    findByUploadMetadataId: async () => null,
  } as unknown as QualitativeCodingReviewRepository;

  const currentActivityEvidenceLoader = new CurrentActivityEvidenceLoader(
    uploadMetadataRepository,
    privacySafeRepresentationRepository,
    qualitativeCodingReviewRepository,
  );
  const activityAnalysisV2ToolExecutor = new ActivityAnalysisV2ToolExecutor(
    interpretationResultRepository,
    datasetPreparationRepository,
  );

  const createdRuns: Array<Record<string, unknown>> = [];
  let latestRun: Record<string, unknown> | null = null;
  const activityAnalysisRunV2Repository = {
    create: async (input: Record<string, unknown>) => {
      createdRuns.push(input);
      latestRun = {
        id: "run-1",
        organizationId: input.organizationId,
        projectId: input.projectId,
        activityId: input.activityId,
        activityName: input.activityName,
        phase: input.phase,
        status: input.status,
        goalsSnapshot: input.goalsSnapshot,
        evidence: input.evidence,
        runLimits: input.runLimits,
        clarificationQuestions: input.clarificationQuestions ?? [],
        toolCallTrace: input.toolCallTrace,
        calculations: input.calculations,
        assessment: input.assessment,
        diagnostics: input.diagnostics,
        validation: input.validation,
        errorMessage: input.errorMessage,
        createdAt: NOW,
        updatedAt: NOW,
      };
      return latestRun;
    },
    findLatestByActivityId: async () => latestRun,
    listByActivityId: async () => (latestRun ? [latestRun] : []),
    listByProjectId: async () => (latestRun ? [latestRun] : []),
  } as unknown as ActivityAnalysisRunV2Repository;
  const activityRepository = {
    update: async (_activityId: string, input: Record<string, unknown>) => ({
      id: "activity-1",
      projectId: "project-1",
      name: options.activityName,
      description: null,
      activityType: options.activityType ?? "other",
      startDate: null,
      endDate: null,
      targetAudience: null,
      objectives: options.activityObjectives ?? null,
      output: options.activityOutput,
      concernTaggingInstruction: null,
      status: "completed",
      interpretationAcknowledgedAt: null,
      interpretationAcknowledgedById: null,
      activityAnalysisV2ClarificationAnswers:
        input.activityAnalysisV2ClarificationAnswers ?? [],
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as ActivityRepository;

  const authorizationService = {
    canEditActivity: async () => ({
      project: {
        id: "project-1",
        organizationId: "org-1",
      },
      activity: {
        id: "activity-1",
        name: options.activityName,
        activityType: options.activityType ?? "other",
        objectives: options.activityObjectives ?? null,
        output: options.activityOutput,
        activityAnalysisV2ClarificationAnswers: [],
      },
    }),
    canViewActivity: async () => ({
      project: {
        id: "project-1",
        organizationId: "org-1",
      },
      activity: {
        id: "activity-1",
      },
    }),
    canViewProject: async () => ({
      project: {
        id: "project-1",
        organizationId: "org-1",
      },
    }),
  } as unknown as AuthorizationService;

  const plannerInputs: Array<Record<string, unknown>> = [];
  const pythonProcessingClient = {
    activityAnalysisV2PlanTimeoutMs: 300_000,
    planActivityAnalysisV2: async (input: Record<string, unknown>) => {
      plannerInputs.push(input);
      return options.plannerResponse;
    },
  } as unknown as PythonProcessingClient;

  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  const noopLlmTokenLedgerService = { recordUsage: async () => undefined };

  const service = new ActivityAnalysisV2Service(
    authorizationService,
    activityRepository,
    currentActivityEvidenceLoader,
    qualitativeCodingReviewRepository,
    activityAnalysisRunV2Repository,
    activityAnalysisV2ToolExecutor,
    interpretationResultRepository,
    datasetPreparationService,
    pythonProcessingClient,
    noopLlmTokenLedgerService as never,
    noopLlmTokenLedgerService as never,
    logger as never,
  );

  return {
    service,
    plannerInputs,
    createdRuns,
  };
}

test("full V2 pipeline counts recruitment applications from the real recruitment fixture", async () => {
  const recruitmentTable = await loadDelimitedTable(
    "01_mentor_recruitment/mentor_bewerbungen_export_maerz_2026.csv",
  );
  const fixture = createFixture({
    uploads: [
      {
        id: "upload-recruitment",
        logicalEvidenceId: "recruitment-1",
        originalFileName: recruitmentTable.originalFileName,
        payload: buildPayload(recruitmentTable),
      },
    ],
    preparedDatasetsByUploadId: {
      "upload-recruitment": {
        tables: [
          {
            name: recruitmentTable.tableName,
            rowCount: recruitmentTable.rows.length,
            columnCount: Object.keys(recruitmentTable.rows[0] ?? {}).length,
            selectedRowGrain: "application record",
            identifierColumn: "bewerbungs_id",
            identifierHandling: "deduplicate_by_identifier",
            primaryStatusColumn: "fuehrungszeugnis_status",
            primaryDateColumn: null,
            columns: [
              {
                name: "bewerbungs_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "fuehrungszeugnis_status",
                inferredType: "categorical",
                role: "primary_status",
                positiveStatusValues: ["eingereicht"],
                positiveStatusDefinitionText: "eingereicht",
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    },
    activityName: "Mentor:innengewinnung und Auswahl",
    activityObjectives: "Mentor:innen gewinnen und prüfen",
    activityOutput:
      "Mindestens 70 Bewerbungen von interessierten Mentor:innen sammeln",
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText:
            "Mindestens 70 Bewerbungen von interessierten Mentor:innen sammeln",
          evaluationMode: "numeric_target",
          status: "planned",
          rationale:
            "Die Bewerbungsdatei erlaubt eine direkte Zählung eindeutiger Bewerbungen.",
          plannedToolNames: ["count_distinct", "compare_target"],
        },
      ],
      toolRequests: [
        {
          goalId: "output_1",
          alias: "applications_count",
          toolName: "count_distinct",
          arguments: {
            uploadMetadataId: "upload-recruitment",
            tableName: recruitmentTable.tableName,
            columnName: "bewerbungs_id",
            useAnalysisRows: true,
          },
        },
        {
          goalId: "output_1",
          toolName: "compare_target",
          arguments: {
            valueAlias: "applications_count",
            target: 70,
            comparison: "at_least",
            label: "Bewerbungsziel",
          },
        },
      ],
      limitations: [],
      validation: {
        status: "passed",
        issues: [],
      },
    },
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(fixture.plannerInputs.length, 1);
  const plannerInput = fixture.plannerInputs[0] as {
    evidenceTables: Array<{
      rowCount: number;
      identifierColumn: string | null;
      primaryStatusColumn: string | null;
    }>;
  };
  assert.equal(plannerInput.evidenceTables.length, 1);
  assert.equal(plannerInput.evidenceTables[0]?.rowCount, 75);
  assert.equal(
    plannerInput.evidenceTables[0]?.identifierColumn,
    "bewerbungs_id",
  );
  assert.equal(
    plannerInput.evidenceTables[0]?.primaryStatusColumn,
    "fuehrungszeugnis_status",
  );
  assert.equal(record.status, "completed");
  assert.equal(record.validation.status, "passed");
  assert.equal(record.diagnostics.goalCount, 1);
  assert.equal(record.diagnostics.evidenceCount, 1);
  assert.equal(record.toolCallTrace.length, 2);
  assert.equal(record.calculations[0]?.value, 75);
  assert.equal(record.calculations[0]?.grain, "entity");
  assert.equal(
    record.assessment?.goalAssessments[0]?.assessmentStatus,
    "achieved",
  );
  assert.equal(fixture.createdRuns.length, 1);
});

test("previewActivityAnalysis includes date coverage and explicit goal-support hints in planner input", async () => {
  const fixture = createFixture({
    uploads: [
      {
        id: "upload-meetings",
        logicalEvidenceId: "meetings-1",
        originalFileName: "mentoring_treffen_log_april_juni.csv",
        payload: buildPayload({
          tableName: "mentoring_treffen_log_april_juni",
          rows: [
            {
              treffen_id: "t-1",
              tandem_id: "ta-1",
              datum: "2026-04-02",
              ziel_output_90_prozent_tandems_10_treffen_unterstuetzt: "ja",
            },
            {
              treffen_id: "t-2",
              tandem_id: "ta-2",
              datum: "2026-06-30",
              ziel_output_90_prozent_tandems_10_treffen_unterstuetzt: "nein",
            },
          ],
        }),
      },
    ],
    preparedDatasetsByUploadId: {
      "upload-meetings": {
        tables: [
          {
            name: "mentoring_treffen_log_april_juni",
            rowCount: 2,
            columnCount: 4,
            selectedRowGrain: "meeting event",
            identifierColumn: "treffen_id",
            identifierHandling: "allow_duplicate_rows_as_events",
            primaryStatusColumn: null,
            primaryDateColumn: "datum",
            columns: [
              {
                name: "treffen_id",
                inferredType: "identifier",
                role: "identifier",
                epistemicRole: "identifier",
              },
              {
                name: "tandem_id",
                inferredType: "identifier",
                role: "other",
                epistemicRole: "identifier",
              },
              {
                name: "datum",
                inferredType: "date",
                role: "primary_date",
                epistemicRole: "temporal",
              },
              {
                name: "ziel_output_90_prozent_tandems_10_treffen_unterstuetzt",
                inferredType: "boolean",
                role: "other",
                epistemicRole: "flag",
              },
            ],
            notes: [],
          },
        ],
      },
    },
    activityName:
      "Regelmäßige Tandemtreffen zwischen Jugendlichen und Mentor:innen",
    activityOutput:
      "90 % der Tandems führen mindestens 10 Treffen durch innerhalb eines Jahres",
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText:
            "90 % der Tandems führen mindestens 10 Treffen durch innerhalb eines Jahres",
          evaluationMode: "numeric_target",
          status: "requires_clarification",
          rationale: "Only the planner input is under test here.",
          plannedToolNames: [],
        },
      ],
      toolRequests: [],
      clarificationQuestions: [],
      limitations: [],
      validation: {
        status: "failed",
        issues: ["Synthetic validation failure for planner-input test."],
      },
    },
  });

  await fixture.service.previewActivityAnalysis("user-1", "activity-1");

  const plannerInput = fixture.plannerInputs[0] as {
    planningTimeBudgetMs: number;
    evidenceTables: Array<{
      plannerHints?: {
        dateCoverage: Array<{
          columnName: string;
          min: string;
          max: string;
          years: number[];
        }>;
        goalSupportColumns: Array<{
          name: string;
          goalType: string | null;
          inferredType: string | null;
          epistemicRole: string | null;
        }>;
      };
    }>;
  };
  // The planner's own grounding-retry loop needs to know it's on a clock —
  // this must always land strictly below the fixture's
  // activityAnalysisV2PlanTimeoutMs (300_000) so Python has a real chance
  // to return a graceful failure before this HTTP call's own timeout fires.
  assert.equal(plannerInput.planningTimeBudgetMs, 270_000);
  assert.deepEqual(plannerInput.evidenceTables[0]?.plannerHints?.dateCoverage, [
    {
      columnName: "datum",
      min: "2026-04-02",
      max: "2026-06-30",
      years: [2026],
    },
  ]);
  assert.deepEqual(
    plannerInput.evidenceTables[0]?.plannerHints?.goalSupportColumns,
    [
      {
        name: "ziel_output_90_prozent_tandems_10_treffen_unterstuetzt",
        goalType: "output",
        inferredType: "boolean",
        epistemicRole: "flag",
      },
    ],
  );
});

test("full V2 pipeline uses the real training fixtures for cross-file cohort calculations", async () => {
  const day1Table = await loadDelimitedTable(
    "02_mentor_training/teilnahmeliste_mentorinnenschulung_2026-03-14.csv",
  );
  const day2Table = await loadDelimitedTable(
    "02_mentor_training/teilnahmeliste_mentorinnenschulung_2026-03-15.csv",
  );
  const fixture = createFixture({
    uploads: [
      {
        id: "upload-day-1",
        logicalEvidenceId: "training-day-1",
        originalFileName: day1Table.originalFileName,
        payload: buildPayload(day1Table),
      },
      {
        id: "upload-day-2",
        logicalEvidenceId: "training-day-2",
        originalFileName: day2Table.originalFileName,
        payload: buildPayload(day2Table),
      },
    ],
    preparedDatasetsByUploadId: {
      "upload-day-1": {
        tables: [
          {
            name: day1Table.tableName,
            rowCount: day1Table.rows.length,
            columnCount: Object.keys(day1Table.rows[0] ?? {}).length,
            selectedRowGrain: "attendance record",
            identifierColumn: "mentor_id",
            identifierHandling: "assume_unique",
            primaryStatusColumn: "anwesend",
            primaryDateColumn: null,
            columns: [
              {
                name: "mentor_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "anwesend",
                inferredType: "categorical",
                role: "primary_status",
                positiveStatusValues: ["ja", "verspätet"],
                positiveStatusDefinitionText: "ja oder verspätet",
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
      "upload-day-2": {
        tables: [
          {
            name: day2Table.tableName,
            rowCount: day2Table.rows.length,
            columnCount: Object.keys(day2Table.rows[0] ?? {}).length,
            selectedRowGrain: "attendance record",
            identifierColumn: "mentor_id",
            identifierHandling: "assume_unique",
            primaryStatusColumn: "anwesend",
            primaryDateColumn: null,
            columns: [
              {
                name: "mentor_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "anwesend",
                inferredType: "categorical",
                role: "primary_status",
                positiveStatusValues: ["ja", "verspätet"],
                positiveStatusDefinitionText: "ja oder verspätet",
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    },
    activityName: "Mentor:innenschulung",
    activityObjectives: "Mentor:innen schulen",
    activityOutput:
      "Mindestens 80 % der Teilnehmenden nehmen an beiden Schulungstagen teil",
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText:
            "Mindestens 80 % der Teilnehmenden nehmen an beiden Schulungstagen teil",
          evaluationMode: "numeric_target",
          status: "planned",
          rationale:
            "Die beiden Anwesenheitslisten erlauben eine Schnittmengen- und Quotientenberechnung.",
          plannedToolNames: [
            "count_distinct",
            "intersection_count",
            "calculate_ratio",
            "compare_target",
          ],
        },
      ],
      toolRequests: [
        {
          goalId: "output_1",
          alias: "day_1_attendees",
          toolName: "count_distinct",
          arguments: {
            uploadMetadataId: "upload-day-1",
            tableName: day1Table.tableName,
            columnName: "mentor_id",
            useAnalysisRows: true,
          },
        },
        {
          goalId: "output_1",
          alias: "both_days_attendees",
          toolName: "intersection_count",
          arguments: {
            left: {
              uploadMetadataId: "upload-day-1",
              tableName: day1Table.tableName,
            },
            right: {
              uploadMetadataId: "upload-day-2",
              tableName: day2Table.tableName,
            },
          },
        },
        {
          goalId: "output_1",
          alias: "two_day_ratio",
          toolName: "calculate_ratio",
          arguments: {
            numeratorAlias: "both_days_attendees",
            denominatorAlias: "day_1_attendees",
            label: "Zwei-Tage-Teilnahmequote",
          },
        },
        {
          goalId: "output_1",
          toolName: "compare_target",
          arguments: {
            valueAlias: "two_day_ratio",
            target: 0.8,
            comparison: "at_least",
            label: "Zwei-Tage-Teilnahmequote",
          },
        },
      ],
      limitations: [],
      validation: {
        status: "passed",
        issues: [],
      },
    },
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(fixture.plannerInputs.length, 1);
  const plannerInput = fixture.plannerInputs[0] as {
    evidenceTables: Array<{
      rowCount: number;
      identifierColumn: string | null;
    }>;
  };
  assert.equal(plannerInput.evidenceTables.length, 2);
  assert.deepEqual(
    plannerInput.evidenceTables.map((table) => table.rowCount),
    [65, 55],
  );
  assert.deepEqual(
    plannerInput.evidenceTables.map((table) => table.identifierColumn),
    ["mentor_id", "mentor_id"],
  );
  assert.equal(record.status, "completed");
  assert.equal(record.validation.status, "passed");
  assert.equal(record.diagnostics.goalCount, 1);
  assert.equal(record.diagnostics.evidenceCount, 2);
  assert.equal(record.toolCallTrace.length, 4);
  assert.equal(record.calculations[0]?.value, 65);
  assert.equal(record.calculations[1]?.value, 55);
  assert.equal(record.calculations[2]?.value, 55 / 65);
  assert.equal(record.assessment?.goalAssessments.length, 1);
  assert.equal(
    record.assessment?.goalAssessments[0]?.assessmentStatus,
    "achieved",
  );
});

test("real recruitment fixture preserves status distribution under group_count", async () => {
  const recruitmentTable = await loadDelimitedTable(
    "01_mentor_recruitment/mentor_bewerbungen_export_maerz_2026.csv",
  );
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-recruitment",
        privacySafeRepresentationId: "psr-upload-recruitment",
        logicalEvidenceId: "recruitment-1",
        versionNumber: 1,
        originalFileName: recruitmentTable.originalFileName,
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: buildPayload(recruitmentTable),
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async () => [
      {
        id: "result-1",
        uploadMetadataId: "upload-recruitment",
      },
    ],
  } as unknown as InterpretationResultRepository;
  const datasetPreparationRepository = {
    findByInterpretationResultIds: async () => [
      {
        interpretationResultId: "result-1",
        preparedDataset: {
          tables: [
            {
              name: recruitmentTable.tableName,
              rowCount: recruitmentTable.rows.length,
              columnCount: Object.keys(recruitmentTable.rows[0] ?? {}).length,
              selectedRowGrain: "application record",
              identifierColumn: "bewerbungs_id",
              identifierHandling: "deduplicate_by_identifier",
              primaryStatusColumn: "fuehrungszeugnis_status",
              primaryDateColumn: null,
              columns: [
                {
                  name: "bewerbungs_id",
                  inferredType: "identifier",
                  role: "identifier",
                  positiveStatusValues: [],
                  positiveStatusDefinitionText: null,
                  normalizationAccepted: true,
                },
                {
                  name: "fuehrungszeugnis_status",
                  inferredType: "categorical",
                  role: "primary_status",
                  positiveStatusValues: ["eingereicht"],
                  positiveStatusDefinitionText: "eingereicht",
                  normalizationAccepted: true,
                },
              ],
              notes: [],
            },
          ],
        },
      },
    ],
  } as unknown as DatasetPreparationRepository;

  const executor = new ActivityAnalysisV2ToolExecutor(
    interpretationResultRepository,
    datasetPreparationRepository,
  );
  const result = await executor.execute(
    [
      {
        toolName: "group_count",
        arguments: {
          uploadMetadataId: "upload-recruitment",
          tableName: recruitmentTable.tableName,
          columnName: "fuehrungszeugnis_status",
          useAnalysisRows: true,
        },
      },
    ],
    evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations.length, 1);
  assert.deepEqual(result.calculations[0]?.result, {
    groups: [
      { value: "eingereicht", count: 25 },
      { value: "ausstehend", count: 16 },
      { value: "eingereicht - abgelaufen", count: 14 },
      { value: "beantragt", count: 12 },
      { value: "nicht vorhanden", count: 8 },
    ],
    basis: "analysis_rows",
    sourceLabel: "mentor_bewerbungen_export_maerz_2026",
    filters: [],
  });
});
