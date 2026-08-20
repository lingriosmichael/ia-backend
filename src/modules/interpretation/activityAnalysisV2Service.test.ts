import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ActivityAnalysisRunV2Repository } from "./activityAnalysisRunV2Repository.js";
import { ActivityAnalysisV2Service } from "./activityAnalysisV2Service.js";
import type { ActivityAnalysisV2ToolExecutor } from "./activityAnalysisV2ToolExecutor.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { QualitativeCodingReviewRepository } from "../processing/qualitativeCodingReviewRepository.js";
import { CurrentActivityEvidenceLoader } from "./currentActivityEvidenceLoader.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import type { DatasetPreparationService } from "./datasetPreparationService.js";

const NOW = new Date("2026-08-08T10:00:00.000Z");

function createServiceFixture(options?: {
  uploads?: Array<{
    id: string;
    organizationId: string;
    projectId: string;
    activityId: string;
    logicalEvidenceId: string;
    versionNumber: number;
    originalFileName: string;
    createdAt: Date;
  }>;
  privacySafeRepresentations?: Array<{
    id: string;
    uploadMetadataId: string;
    payload: Record<string, unknown>;
  }>;
  interpretationResults?: Array<{
    id: string;
    uploadMetadataId: string;
    datasetProfile?: {
      tables: Array<{
        columns: Array<{
          epistemicRole:
            | "identifier"
            | "temporal"
            | "validated_scale"
            | "metric_count"
            | "subjective_code"
            | "free_text"
            | "flag"
            | null;
        }>;
      }>;
    } | null;
  }>;
  qualitativeCodingReviews?: Array<{
    uploadMetadataId: string;
    status: "pending" | "approved" | "rejected";
    findings?: Record<string, unknown>;
    decisions?: Record<string, unknown> | null;
  }>;
  activityOutput?: string | null;
  plannerError?: Error | Error[];
  plannerResponse?: Record<string, unknown> | Record<string, unknown>[];
  executorResult?: Record<string, unknown>;
  activityAnalysisV2PlanTimeoutMs?: number;
  // Runs at the start of every mocked planner call, before it resolves —
  // used to simulate a call consuming wall-clock time under fake timers.
  plannerCallSideEffect?: () => void;
}) {
  const uploads = options?.uploads ?? [
    {
      id: "upload-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      logicalEvidenceId: "evidence-1",
      versionNumber: 2,
      originalFileName: "mentors.csv",
      createdAt: NOW,
    },
  ];
  const privacySafeRepresentations = options?.privacySafeRepresentations ?? [
    {
      id: "psr-1",
      uploadMetadataId: "upload-1",
      payload: {
        metadata: {
          evidenceModality: "structured_quantitative",
          interpretationDataType: "tabular_structured",
        },
      },
    },
  ];

  const uploadMetadataRepository = {
    listByActivityIds: async (activityIds: string[]) =>
      uploads.filter((upload) => activityIds.includes(upload.activityId)),
  } as unknown as UploadMetadataRepository;

  const privacySafeRepresentationRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      privacySafeRepresentations.filter((representation) =>
        uploadMetadataIds.includes(representation.uploadMetadataId),
      ),
  } as unknown as PrivacySafeRepresentationRepository;
  const qualitativeCodingReviews = options?.qualitativeCodingReviews ?? [];
  const qualitativeCodingReviewRepository = {
    findByUploadMetadataId: async (uploadMetadataId: string) =>
      qualitativeCodingReviews.find(
        (review) => review.uploadMetadataId === uploadMetadataId,
      ) ?? null,
  } as unknown as QualitativeCodingReviewRepository;
  const interpretationResults =
    options?.interpretationResults ??
    uploads.map((upload, index) => ({
      id: `result-${index + 1}`,
      uploadMetadataId: upload.id,
      datasetProfile: null,
    }));

  const loader = new CurrentActivityEvidenceLoader(
    uploadMetadataRepository,
    privacySafeRepresentationRepository,
    qualitativeCodingReviewRepository,
  );
  let activityAnalysisV2ClarificationAnswers: Array<Record<string, unknown>> =
    [];
  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      interpretationResults.filter((result) =>
        uploadMetadataIds.includes(result.uploadMetadataId),
      ),
  } as unknown as InterpretationResultRepository;
  const datasetPreparationService = {
    findByInterpretationResultIds: async (interpretationResultIds: string[]) =>
      interpretationResultIds.map((interpretationResultId) => ({
        interpretationResultId,
        preparedDataset: {
          tables: [
            {
              name: "mentors",
              identifierColumn: "bewerbungs_id",
              identifierHandling: "deduplicate_by_identifier",
              primaryStatusColumn: "status",
              primaryDateColumn: null,
              columns: [
                {
                  name: "bewerbungs_id",
                  role: "identifier",
                  inferredType: "identifier",
                  epistemicRole: "identifier",
                },
                {
                  name: "status",
                  role: "primary_status",
                  inferredType: "categorical",
                  epistemicRole: null,
                },
              ],
            },
          ],
        },
      })),
  } as unknown as DatasetPreparationService;

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
        qualitativeFindings: input.qualitativeFindings ?? [],
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
  } as unknown as ActivityAnalysisRunV2Repository;
  const activityRepository = {
    update: async (_activityId: string, input: Record<string, unknown>) => {
      activityAnalysisV2ClarificationAnswers =
        (input.activityAnalysisV2ClarificationAnswers as Array<
          Record<string, unknown>
        >) ?? activityAnalysisV2ClarificationAnswers;
      return {
        id: "activity-1",
        projectId: "project-1",
        name: "Mentor:innengewinnung und Auswahl",
        description: null,
        activityType: "other",
        startDate: null,
        endDate: null,
        targetAudience: null,
        objectives: "Mentor:innen gewinnen",
        output: options?.activityOutput ?? "Mindestens 70 Bewerbungen sammeln",
        concernTaggingInstruction: null,
        status: "completed",
        interpretationAcknowledgedAt: null,
        interpretationAcknowledgedById: null,
        activityAnalysisV2ClarificationAnswers,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
    upsertClarificationAnswer: async (
      _activityId: string,
      answer: Record<string, unknown>,
    ) => {
      activityAnalysisV2ClarificationAnswers = [
        ...activityAnalysisV2ClarificationAnswers.filter(
          (existing) => existing.questionId !== answer.questionId,
        ),
        answer,
      ];
      return {
        id: "activity-1",
        projectId: "project-1",
        name: "Mentor:innengewinnung und Auswahl",
        description: null,
        activityType: "other",
        startDate: null,
        endDate: null,
        targetAudience: null,
        objectives: "Mentor:innen gewinnen",
        output: options?.activityOutput ?? "Mindestens 70 Bewerbungen sammeln",
        concernTaggingInstruction: null,
        status: "completed",
        interpretationAcknowledgedAt: null,
        interpretationAcknowledgedById: null,
        activityAnalysisV2ClarificationAnswers,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
  } as unknown as ActivityRepository;

  const authorizationService = {
    canEditActivity: async () => ({
      project: {
        id: "project-1",
        organizationId: "org-1",
      },
      activity: {
        id: "activity-1",
        name: "Mentor:innengewinnung und Auswahl",
        activityType: "other",
        objectives: "Mentor:innen gewinnen",
        output: options?.activityOutput ?? "Mindestens 70 Bewerbungen sammeln",
        activityAnalysisV2ClarificationAnswers,
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
  } as unknown as AuthorizationService;
  const activityAnalysisV2ToolExecutor = {
    execute: async () =>
      options?.executorResult
        ? {
            qualitativeFindings: [],
            ...(options.executorResult ?? {}),
          }
        : {
            toolCallTrace: [
              {
                toolCallId: "tool_1_count_distinct",
                toolName: "count_distinct",
                arguments: {
                  uploadMetadataId: "upload-1",
                  tableName: "mentors",
                  columnName: "bewerbungs_id",
                  useAnalysisRows: true,
                },
                calculationIds: ["calc_applications_count"],
                status: "succeeded",
                errorMessage: null,
                startedAt: NOW.toISOString(),
                completedAt: NOW.toISOString(),
                durationMs: 0,
              },
              {
                toolCallId: "tool_2_compare_target",
                toolName: "compare_target",
                arguments: {
                  valueAlias: "applications_count",
                  target: 70,
                  comparison: "at_least",
                  label: "Applications target",
                },
                calculationIds: ["calc_applications_target"],
                status: "succeeded",
                errorMessage: null,
                startedAt: NOW.toISOString(),
                completedAt: NOW.toISOString(),
                durationMs: 0,
              },
            ],
            calculations: [
              {
                calculationId: "calc_applications_count",
                toolName: "count_distinct",
                label: "Distinct applications",
                description: "Counts unique applications.",
                formula: "COUNT_DISTINCT(bewerbungs_id)",
                value: 75,
                unit: "distinct_values",
                sourceUploadMetadataIds: ["upload-1"],
                sourceTableNames: ["mentors"],
                sourceColumns: ["bewerbungs_id"],
                numerator: 75,
                denominator: null,
                denominatorType: "distinct_entities",
                identifierColumn: "bewerbungs_id",
                result: { distinctCount: 75, basis: "analysis_rows" },
              },
              {
                calculationId: "calc_applications_target",
                toolName: "compare_target",
                label: "Applications target",
                description: "Compares applications against the target.",
                formula: "75 at_least 70",
                value: true,
                unit: null,
                sourceUploadMetadataIds: [],
                sourceTableNames: [],
                sourceColumns: [],
                numerator: 75,
                denominator: 70,
                denominatorType: "rows",
                identifierColumn: null,
                result: {
                  achieved: true,
                  gap: 5,
                  comparison: "at_least",
                  value: 75,
                  target: 70,
                },
              },
            ],
            qualitativeFindings: [],
          },
  } as unknown as ActivityAnalysisV2ToolExecutor;
  let plannerCallCount = 0;
  const plannerRequests: Array<Record<string, unknown>> = [];
  const pythonProcessingClient = {
    planActivityAnalysisV2: async (input: Record<string, unknown>) => {
      plannerRequests.push(input);
      options?.plannerCallSideEffect?.();
      const plannerError = Array.isArray(options?.plannerError)
        ? (options?.plannerError[plannerCallCount] ??
          options?.plannerError.at(-1))
        : options?.plannerError;
      if (plannerError) {
        plannerCallCount += 1;
        throw plannerError;
      }
      const plannerResponse = Array.isArray(options?.plannerResponse)
        ? (options?.plannerResponse[plannerCallCount] ??
          options?.plannerResponse.at(-1))
        : options?.plannerResponse;
      plannerCallCount += 1;
      return (
        plannerResponse ?? {
          goalPlans: [
            {
              goalId: "output_1",
              goalType: "output",
              goalText:
                options?.activityOutput ?? "Mindestens 70 Bewerbungen sammeln",
              evaluationMode: "numeric_target",
              status: "planned",
              rationale:
                "A distinct application count can be compared to the target.",
              plannedToolNames: ["count_distinct", "compare_target"],
            },
          ],
          clarificationQuestions: [],
          toolRequests: [
            {
              goalId: "output_1",
              alias: "applications_count",
              toolName: "count_distinct",
              arguments: {
                uploadMetadataId: "upload-1",
                tableName: "mentors",
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
                label: "Applications target",
              },
            },
          ],
          limitations: [],
          validation: {
            status: "passed",
            issues: [],
          },
        }
      );
    },
    activityAnalysisV2PlanTimeoutMs:
      options?.activityAnalysisV2PlanTimeoutMs ?? 300_000,
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
    loader,
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
    createdRuns,
    getActivityAnalysisV2ClarificationAnswers: () =>
      activityAnalysisV2ClarificationAnswers,
    getPlannerCallCount: () => plannerCallCount,
    getPlannerRequests: () => plannerRequests,
  };
}

test("previewActivityAnalysis persists a separate shadow run with current evidence", async () => {
  const fixture = createServiceFixture();

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.analysisRunId, "run-1");
  assert.equal(record.status, "completed");
  assert.equal(record.phase, "phase_4_rendering");
  assert.equal(record.activityName, "Mentor:innengewinnung und Auswahl");
  assert.equal(
    record.goalsSnapshot.output,
    "Mindestens 70 Bewerbungen sammeln",
  );
  assert.equal(record.evidence.length, 1);
  assert.equal(record.evidence[0]?.uploadMetadataId, "upload-1");
  assert.equal(record.evidence[0]?.privacySafeRepresentationId, "psr-1");
  assert.equal(record.evidence[0]?.logicalEvidenceId, "evidence-1");
  assert.equal(record.toolCallTrace.length, 2);
  assert.equal(record.toolCallTrace[0]?.toolName, "count_distinct");
  assert.equal(record.toolCallTrace[1]?.toolName, "compare_target");
  assert.equal(record.calculations.length, 2);
  assert.equal(
    record.calculations[0]?.calculationId,
    "calc_applications_count",
  );
  assert.equal(
    record.calculations[1]?.calculationId,
    "calc_applications_target",
  );
  assert.equal(record.validation.status, "passed");
  assert.ok(record.assessment);
  assert.equal(record.assessment?.goalAssessments.length, 1);
  assert.equal(
    record.assessment?.goalAssessments[0]?.assessmentStatus,
    "achieved",
  );
  assert.equal(record.diagnostics.goalCount, 1);
  assert.equal(record.diagnostics.executedToolCallCount, 2);
  assert.equal(fixture.createdRuns.length, 1);
});

test("previewActivityAnalysis executes context candidates through a separate tool-executor call and persists ContextCatalogEntry records", async () => {
  const fixture = createServiceFixture({
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "Mindestens 70 Bewerbungen sammeln",
          evaluationMode: "numeric_target",
          status: "planned",
          rationale: "No columns support this goal in this fixture.",
          plannedToolNames: [],
        },
      ],
      clarificationQuestions: [],
      // Empty on purpose: the goal-linked execution path is skipped
      // entirely (previewActivityAnalysis short-circuits to a hardcoded
      // empty result when there are no tool requests), isolating this test
      // to the separate context-candidate execution path.
      toolRequests: [],
      contextCandidates: [
        {
          tableName: "mentors",
          columnName: "bezirk",
          uploadMetadataId: "upload-1",
        },
      ],
      limitations: [],
      validation: { status: "passed", issues: [] },
    },
    executorResult: {
      toolCallTrace: [
        {
          toolCallId: "tool_1_group_count",
          toolName: "group_count",
          arguments: {
            uploadMetadataId: "upload-1",
            tableName: "mentors",
            columnName: "bezirk",
          },
          calculationIds: ["calc_bezirk_group_count"],
          status: "succeeded",
          errorMessage: null,
          startedAt: NOW.toISOString(),
          completedAt: NOW.toISOString(),
          durationMs: 0,
        },
      ],
      calculations: [
        {
          calculationId: "calc_bezirk_group_count",
          toolName: "group_count",
          label: "Group counts for bezirk in mentors",
          description: "Counts records per category value in one column.",
          formula: "GROUP_COUNT(bezirk)",
          value: 2,
          unit: "groups",
          sourceUploadMetadataIds: ["upload-1"],
          sourceTableNames: ["mentors"],
          sourceColumns: ["bezirk"],
          numerator: 5,
          denominator: null,
          denominatorType: "rows",
          identifierColumn: null,
          result: {
            groups: [
              { value: "Neukölln", count: 3 },
              { value: "Mitte", count: 2 },
            ],
            basis: "analysis_rows",
            sourceLabel: "mentors",
            filters: [],
          },
        },
      ],
    },
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.status, "completed");
  // The goal path itself executed nothing (empty toolRequests), confirming
  // the context candidates were not folded into the goal-linked execution.
  assert.equal(record.toolCallTrace.length, 0);
  assert.equal(record.calculations.length, 0);

  assert.equal(fixture.createdRuns.length, 1);
  const persistedContextCatalogEntries = fixture.createdRuns[0]
    ?.contextCatalogEntries as Array<Record<string, unknown>>;
  assert.equal(persistedContextCatalogEntries.length, 1);
  assert.deepEqual(persistedContextCatalogEntries[0], {
    entryId: "activity-1:context:mentors.bezirk",
    activityId: "activity-1",
    activityName: "Mentor:innengewinnung und Auswahl",
    labelDe: "Verteilung: Bezirk",
    dimensionLabelDe: "Bezirk",
    shares: [
      { labelDe: "Neukölln", count: 3 },
      { labelDe: "Mitte", count: 2 },
    ],
    n: 5,
    eligibleChartTypes: ["hbar_target", "donut_share"],
    sourceDe: "Quelle: mentors",
  });
});

test("previewActivityAnalysis flags an evidence table with no matching prepared table and counts its columns as missing epistemicRole", async () => {
  const fixture = createServiceFixture({
    privacySafeRepresentations: [
      {
        id: "psr-1",
        uploadMetadataId: "upload-1",
        payload: {
          metadata: {
            evidenceModality: "structured_quantitative",
            interpretationDataType: "tabular_structured",
          },
          // The fixture's datasetPreparationService always returns a
          // prepared table named "mentors" — this payload table is
          // deliberately named something else so it has no match by
          // tableName, forcing buildEvidenceTables's raw-column fallback.
          tables: [
            {
              name: "teilnahme",
              rows: [{ bezirk: "Mitte" }, { bezirk: "Neukölln" }],
            },
          ],
        },
      },
    ],
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "Mindestens 70 Bewerbungen sammeln",
          evaluationMode: "numeric_target",
          status: "planned",
          rationale: "No columns support this goal in this fixture.",
          plannedToolNames: [],
        },
      ],
      clarificationQuestions: [],
      toolRequests: [],
      contextCandidates: [],
      limitations: [],
      validation: { status: "passed", issues: [] },
    },
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.status, "completed");
  assert.equal(
    record.diagnostics.contextExtraction.preparedTableFallbackTableCount,
    1,
  );
  // The payload's only table ("teilnahme") has one raw column ("bezirk");
  // with no matching prepared table it falls back with epistemicRole:
  // null, foreclosing it from ever becoming a context-catalog candidate
  // regardless of what it actually contains.
  assert.equal(
    record.diagnostics.contextExtraction
      .contextCandidatesExcludedByMissingEpistemicRole,
    1,
  );
});

test("previewActivityAnalysis blocks when a current upload still requires qualitative coding review approval", async () => {
  const fixture = createServiceFixture({
    interpretationResults: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        datasetProfile: {
          tables: [
            {
              rowCount: 3,
              columns: [
                { epistemicRole: "free_text", nonNullCount: 3 } as never,
              ],
            } as never,
          ],
        },
      },
    ],
  });

  await assert.rejects(
    fixture.service.previewActivityAnalysis("user-1", "activity-1"),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(
        error.code,
        "activity_analysis_v2_qualitative_review_required",
      );
      assert.deepEqual(error.details, {
        pendingQualitativeCodingReviewUploads: [
          {
            uploadMetadataId: "upload-1",
            originalFileName: "mentors.csv",
          },
        ],
      });
      return true;
    },
  );
});

test("previewActivityAnalysis exposes approved synthetic qualitative code columns to the planner", async () => {
  const fixture = createServiceFixture({
    privacySafeRepresentations: [
      {
        id: "psr-1",
        uploadMetadataId: "upload-1",
        payload: {
          metadata: {
            evidenceModality: "structured_qualitative",
            interpretationDataType: "tabular_structured",
          },
          tables: [
            {
              name: "mentors",
              rows: [
                { bewerbungs_id: "A1", reflection_note: "More confident now." },
                { bewerbungs_id: "A2", reflection_note: "Still unsure." },
              ],
            },
          ],
        },
      },
    ],
    interpretationResults: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        datasetProfile: {
          tables: [
            {
              columns: [
                { epistemicRole: "identifier" },
                { epistemicRole: "free_text" },
              ],
            },
          ],
        },
      },
    ],
    qualitativeCodingReviews: [
      {
        uploadMetadataId: "upload-1",
        status: "approved",
        findings: {
          summary: [
            {
              findingKey: "mentors::reflection_note",
              tableName: "mentors",
              textColumnName: "reflection_note",
              syntheticCodeColumnName: "reflection_note_coded",
              proposedAssignments: [
                { rowIndex: 0, assignedCode: "improved" },
                { rowIndex: 1, assignedCode: "uncertain" },
              ],
            },
          ],
        },
        decisions: {
          columnDecisions: [
            {
              findingKey: "mentors::reflection_note",
              decision: "approve_as_proposed",
            },
          ],
        },
      },
    ],
  });

  await fixture.service.previewActivityAnalysis("user-1", "activity-1");

  const plannerRequest = fixture.getPlannerRequests()[0] as {
    evidenceTables: Array<{
      columns: Array<{
        name: string;
        role: string | null;
        inferredType: string | null;
        epistemicRole: string | null;
      }>;
    }>;
  };
  assert.ok(plannerRequest);
  assert.deepEqual(plannerRequest.evidenceTables[0]?.columns, [
    {
      name: "bewerbungs_id",
      role: "identifier",
      inferredType: "identifier",
      epistemicRole: "identifier",
    },
    {
      name: "status",
      role: "primary_status",
      inferredType: "categorical",
      epistemicRole: null,
    },
    {
      name: "reflection_note_coded",
      role: "other",
      inferredType: "categorical",
      epistemicRole: "subjective_code",
    },
  ]);
});

test("previewActivityAnalysis pauses and persists clarification questions when the planner requests them", async () => {
  const fixture = createServiceFixture({
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "Mindestens 70 Bewerbungen sammeln",
          evaluationMode: "numeric_target",
          status: "requires_clarification",
          rationale:
            "The planner needs the operational status definition first.",
          plannedToolNames: [],
          missingCapabilities: [],
        },
      ],
      clarificationQuestions: [
        {
          goalId: "output_1",
          prompt: "Welches Feld definiert den finalen Bewerbungsstatus?",
          kind: "single_choice",
          questionDomain: "interpretation",
          options: ["status", "entscheidung"],
          recommendedOption: "status",
          recommendedConfidence: 0.51,
          isBlocking: true,
          questionCode: "primary_status_field",
          targetTableName: "mentors",
          targetColumnName: null,
        },
      ],
      toolRequests: [],
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

  assert.equal(record.status, "needs_clarification");
  assert.equal(record.clarificationQuestions.length, 1);
  assert.equal(record.clarificationQuestions[0]?.goalId, "output_1");
  assert.equal(record.clarificationQuestions[0]?.status, "pending");
  assert.equal(record.toolCallTrace.length, 0);
  assert.equal(record.calculations.length, 0);
});

test("previewActivityAnalysis persists concrete planner validation issues when the planner returns an invalid plan", async () => {
  const fixture = createServiceFixture({
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "Mindestens 70 Bewerbungen sammeln",
          evaluationMode: "numeric_target",
          status: "planned",
          rationale: "One goal only.",
          plannedToolNames: ["count_distinct"],
          missingCapabilities: [],
        },
      ],
      clarificationQuestions: [],
      toolRequests: [
        {
          goalId: "output_1",
          alias: "applications_count",
          toolName: "count_distinct",
          arguments: {
            uploadMetadataId: "upload-1",
            tableName: "mentors",
            columnName: "bewerbungs_id",
            useAnalysisRows: true,
          },
        },
      ],
      limitations: [
        "ActivityAnalystV2 planning failed validation and did not return a publishable plan.",
        "Final planner validation issue: Missing goal plans for goal IDs: ['output_2']",
      ],
      validation: {
        status: "failed",
        issues: ["Missing goal plans for goal IDs: ['output_2']"],
      },
    },
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.status, "failed");
  assert.equal(record.validation.status, "failed");
  assert.deepEqual(record.validation.issues, [
    "Missing goal plans for goal IDs: ['output_2']",
  ]);
  assert.equal(
    record.errorMessage,
    "ActivityAnalystV2 planner returned an invalid plan.",
  );
});

test("previewActivityAnalysis does not seed backend-generated subset clarification answers", async () => {
  const fixture = createServiceFixture({
    activityOutput: "65 geeignete Mentor:innen auswählen",
    privacySafeRepresentations: [
      {
        id: "psr-1",
        uploadMetadataId: "upload-1",
        payload: {
          metadata: {
            evidenceModality: "structured_quantitative",
            interpretationDataType: "tabular_structured",
          },
          tables: [
            {
              name: "mentors",
              rows: [
                {
                  bewerbungs_id: "B001",
                  status: "geeignet",
                },
                {
                  bewerbungs_id: "B002",
                  status: "bedingt",
                },
              ],
            },
          ],
        },
      },
    ],
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "65 geeignete Mentor:innen auswählen",
          evaluationMode: "numeric_target",
          status: "requires_clarification",
          rationale: "The planner wants the operational suitable-status rule.",
          plannedToolNames: [],
          missingCapabilities: [],
        },
      ],
      clarificationQuestions: [
        {
          goalId: "output_1",
          prompt:
            "Welche Regel soll verwendet werden, um geeignete Mentor:innen zu zählen?",
          kind: "free_text",
          questionDomain: "interpretation",
          options: null,
          recommendedOption: null,
          recommendedConfidence: 0.4,
          isBlocking: true,
          questionCode: "positive_status_values",
          targetTableName: "mentors",
          targetColumnName: "status",
        },
      ],
      toolRequests: [],
      limitations: [],
      validation: {
        status: "passed",
        issues: [],
      },
    },
  });

  await fixture.service.previewActivityAnalysis("user-1", "activity-1");

  const plannerRequests = fixture.getPlannerRequests();
  assert.equal(plannerRequests.length, 1);
  const clarificationAnswers = Array.isArray(
    plannerRequests[0]?.clarificationAnswers,
  )
    ? (plannerRequests[0]?.clarificationAnswers as Array<
        Record<string, unknown>
      >)
    : [];
  assert.equal(clarificationAnswers.length, 0);
});

test("previewActivityAnalysis auto-resolves planner clarification when recommended confidence is at least 0.8", async () => {
  const fixture = createServiceFixture({
    activityOutput: "65 geeignete Mentor:innen auswählen",
    plannerResponse: [
      {
        goalPlans: [
          {
            goalId: "output_1",
            goalType: "output",
            goalText: "65 geeignete Mentor:innen auswählen",
            evaluationMode: "numeric_target",
            status: "requires_clarification",
            rationale:
              "The planner wants the operational suitable-status rule.",
            plannedToolNames: [],
            missingCapabilities: [],
          },
        ],
        clarificationQuestions: [
          {
            goalId: "output_1",
            prompt:
              "Welche Regel soll verwendet werden, um geeignete Mentor:innen zu zählen?",
            kind: "single_choice",
            questionDomain: "interpretation",
            options: ["geeignet", "bedingt"],
            recommendedOption: "geeignet",
            recommendedConfidence: 0.8,
            isBlocking: true,
            questionCode: "positive_status_values",
            targetTableName: "mentors",
            targetColumnName: "status",
          },
        ],
        toolRequests: [],
        limitations: [],
        validation: {
          status: "passed",
          issues: [],
        },
      },
      {
        goalPlans: [
          {
            goalId: "output_1",
            goalType: "output",
            goalText: "65 geeignete Mentor:innen auswählen",
            evaluationMode: "numeric_target",
            status: "planned",
            rationale:
              "A distinct suitable-application count can be compared to the target.",
            plannedToolNames: ["count_distinct", "compare_target"],
            missingCapabilities: [],
          },
        ],
        clarificationQuestions: [],
        toolRequests: [
          {
            goalId: "output_1",
            alias: "suitable_count",
            toolName: "count_distinct",
            arguments: {
              uploadMetadataId: "upload-1",
              tableName: "mentors",
              columnName: "bewerbungs_id",
              filters: [
                {
                  columnName: "status",
                  operator: "equals",
                  value: "geeignet",
                },
              ],
              useAnalysisRows: true,
            },
          },
          {
            goalId: "output_1",
            toolName: "compare_target",
            arguments: {
              valueAlias: "suitable_count",
              target: 65,
              comparison: "at_least",
              label: "Suitable mentors target",
            },
          },
        ],
        limitations: [],
        validation: {
          status: "passed",
          issues: [],
        },
      },
    ],
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.status, "completed");
  assert.equal(record.clarificationQuestions.length, 0);
  const plannerRequests = fixture.getPlannerRequests();
  assert.equal(plannerRequests.length, 2);
  const firstClarificationAnswers = Array.isArray(
    plannerRequests[0]?.clarificationAnswers,
  )
    ? (plannerRequests[0]?.clarificationAnswers as Array<
        Record<string, unknown>
      >)
    : [];
  assert.equal(firstClarificationAnswers.length, 0);
  const secondClarificationAnswers = Array.isArray(
    plannerRequests[1]?.clarificationAnswers,
  )
    ? (plannerRequests[1]?.clarificationAnswers as Array<
        Record<string, unknown>
      >)
    : [];
  assert.deepEqual(secondClarificationAnswers, [
    {
      questionId: secondClarificationAnswers[0]?.questionId,
      goalId: "output_1",
      prompt:
        "Welche Regel soll verwendet werden, um geeignete Mentor:innen zu zählen?",
      answeredValue: "geeignet",
      questionCode: "positive_status_values",
      targetTableName: "mentors",
      targetColumnName: "status",
    },
  ]);
  assert.equal(fixture.getActivityAnalysisV2ClarificationAnswers().length, 0);
});

test("previewActivityAnalysis does not attempt an auto-resolved replan once the run's time budget can no longer fit another planner call", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });

  const fixture = createServiceFixture({
    activityOutput: "65 geeignete Mentor:innen auswählen",
    // Python's own per-call ceiling for the planner specifically; the
    // guard should compare remaining budget against this dedicated planner
    // timeout rather than a hardcoded number.
    activityAnalysisV2PlanTimeoutMs: 60_000,
    // Simulates the first planner call alone consuming almost all of
    // PHASE_1_RUN_LIMITS.timeoutMs (330_000ms), leaving only 50_000ms —
    // less than the 60_000ms a second call could take.
    plannerCallSideEffect: () => t.mock.timers.tick(280_000),
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "65 geeignete Mentor:innen auswählen",
          evaluationMode: "numeric_target",
          status: "requires_clarification",
          rationale: "The planner wants the operational suitable-status rule.",
          plannedToolNames: [],
          missingCapabilities: [],
        },
      ],
      clarificationQuestions: [
        {
          goalId: "output_1",
          prompt:
            "Welche Regel soll verwendet werden, um geeignete Mentor:innen zu zählen?",
          kind: "single_choice",
          questionDomain: "interpretation",
          options: ["geeignet", "bedingt"],
          recommendedOption: "geeignet",
          recommendedConfidence: 0.8,
          isBlocking: true,
          questionCode: "positive_status_values",
          targetTableName: "mentors",
          targetColumnName: "status",
        },
      ],
      toolRequests: [],
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

  // The question was auto-resolvable (confidence 0.8), so without the
  // budget guard the loop would have attempted a second planner call.
  // It shouldn't have: only 50_000ms of budget was left against a
  // 60_000ms-ceiling call.
  assert.equal(fixture.getPlannerRequests().length, 1);
  // And because the loop never actually merged an answer for it, it must
  // still reach the user instead of being silently hidden by the
  // confidence-based filter buildClarificationQuestions used to apply.
  assert.equal(record.status, "needs_clarification");
  assert.equal(record.clarificationQuestions.length, 1);
  assert.equal(record.clarificationQuestions[0]?.status, "pending");
  assert.equal(record.clarificationQuestions[0]?.recommendedOption, "geeignet");
});

test("answerClarificationQuestion persists the answer without triggering a replan", async () => {
  const fixture = createServiceFixture({
    plannerResponse: [
      {
        goalPlans: [
          {
            goalId: "output_1",
            goalType: "output",
            goalText: "Mindestens 70 Bewerbungen sammeln",
            evaluationMode: "numeric_target",
            status: "requires_clarification",
            rationale:
              "The planner needs the operational status definition first.",
            plannedToolNames: [],
            missingCapabilities: [],
          },
        ],
        clarificationQuestions: [
          {
            goalId: "output_1",
            prompt: "Welches Feld definiert den finalen Bewerbungsstatus?",
            kind: "single_choice",
            questionDomain: "interpretation",
            options: ["status", "entscheidung"],
            recommendedOption: "status",
            recommendedConfidence: 0.51,
            isBlocking: true,
            questionCode: "primary_status_field",
            targetTableName: "mentors",
            targetColumnName: null,
          },
        ],
        toolRequests: [],
        limitations: [],
        validation: {
          status: "passed",
          issues: [],
        },
      },
      {
        goalPlans: [
          {
            goalId: "output_1",
            goalType: "output",
            goalText: "Mindestens 70 Bewerbungen sammeln",
            evaluationMode: "numeric_target",
            status: "planned",
            rationale:
              "A distinct application count can be compared to the target.",
            plannedToolNames: ["count_distinct", "compare_target"],
            missingCapabilities: [],
          },
        ],
        clarificationQuestions: [],
        toolRequests: [
          {
            goalId: "output_1",
            alias: "applications_count",
            toolName: "count_distinct",
            arguments: {
              uploadMetadataId: "upload-1",
              tableName: "mentors",
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
              label: "Applications target",
            },
          },
        ],
        limitations: [],
        validation: {
          status: "passed",
          issues: [],
        },
      },
    ],
  });

  const initialRun = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );
  const questionId = initialRun.clarificationQuestions[0]?.id;
  assert.ok(questionId);

  assert.equal(fixture.getPlannerRequests().length, 1);

  // answerClarificationQuestion only validates and persists the answer now
  // — replanning is LLM-round-trip work that moves into a processing job
  // (activityAnalysisWorker.ts), triggered by the controller after this
  // resolves, not by this method itself.
  const result = await fixture.service.answerClarificationQuestion(
    "user-1",
    "activity-1",
    questionId!,
    "status",
  );

  assert.equal(result, undefined);
  assert.equal(fixture.getPlannerRequests().length, 1);
  assert.equal(fixture.getActivityAnalysisV2ClarificationAnswers().length, 1);
  assert.equal(
    fixture.getActivityAnalysisV2ClarificationAnswers()[0]?.questionId,
    questionId,
  );

  // Simulates what activityAnalysisWorker.ts does next: a separate
  // previewActivityAnalysis call picks up the persisted answer and replans.
  const resumedRun = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );
  assert.equal(resumedRun.status, "completed");
  assert.equal(fixture.getPlannerRequests().length, 2);
});

test("answerClarificationQuestion rejects an answer that isn't one of the question's offered options", async () => {
  const fixture = createServiceFixture({
    plannerResponse: [
      {
        goalPlans: [
          {
            goalId: "output_1",
            goalType: "output",
            goalText: "Mindestens 70 Bewerbungen sammeln",
            evaluationMode: "numeric_target",
            status: "requires_clarification",
            rationale:
              "The planner needs the operational status definition first.",
            plannedToolNames: [],
            missingCapabilities: [],
          },
        ],
        clarificationQuestions: [
          {
            goalId: "output_1",
            prompt: "Welches Feld definiert den finalen Bewerbungsstatus?",
            kind: "single_choice",
            questionDomain: "interpretation",
            options: ["status", "entscheidung"],
            recommendedOption: "status",
            recommendedConfidence: 0.79,
            isBlocking: true,
            questionCode: "primary_status_field",
            targetTableName: "mentors",
            targetColumnName: null,
          },
        ],
        toolRequests: [],
        limitations: [],
        validation: {
          status: "passed",
          issues: [],
        },
      },
    ],
  });

  const initialRun = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );
  const questionId = initialRun.clarificationQuestions[0]?.id;
  assert.ok(questionId);

  await assert.rejects(
    () =>
      fixture.service.answerClarificationQuestion(
        "user-1",
        "activity-1",
        questionId!,
        // Not one of ["status", "entscheidung"] — a single_choice question
        // must only accept its offered options.
        "some_other_value_the_ui_never_offered",
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "activity_analysis_v2_question_invalid_answer");
      assert.equal(error.statusCode, 422);
      return true;
    },
  );
  // The rejected answer must not have been persisted.
  assert.equal(fixture.getActivityAnalysisV2ClarificationAnswers().length, 0);
});

test("answering one question still leaves the others answerable after the replan job's planner call fails", async () => {
  // Regression test: originally, answering a clarification question always
  // triggered a full replan inline. If that replan call threw (network
  // error, timeout, malformed response), the resulting failed run used to
  // hardcode clarificationQuestions to an empty list — wiping out every
  // other still-unanswered question. The next PATCH for any of them then
  // 404'd ("question not found"), because it could no longer be found on
  // the latest run at all. The fix re-derives the failed run's question
  // list from the previous run instead of discarding it.
  //
  // Replanning now happens in a separate processing job
  // (activityAnalysisWorker.ts calling previewActivityAnalysis) rather than
  // inline inside answerClarificationQuestion, so this test simulates that
  // by calling previewActivityAnalysis directly after each answer, the same
  // way the worker would.
  const twoQuestionPlan = {
    goalPlans: [
      {
        goalId: "output_1",
        goalType: "output",
        goalText: "Mindestens 70 Bewerbungen sammeln",
        evaluationMode: "numeric_target",
        status: "requires_clarification",
        rationale: "Two definitions are still ambiguous.",
        plannedToolNames: [],
        missingCapabilities: [],
      },
    ],
    clarificationQuestions: [
      {
        goalId: "output_1",
        prompt: "Welches Feld definiert den finalen Bewerbungsstatus?",
        kind: "single_choice",
        questionDomain: "interpretation",
        options: ["status", "entscheidung"],
        recommendedOption: null,
        recommendedConfidence: null,
        isBlocking: true,
        questionCode: "primary_status_field",
        targetTableName: "mentors",
        targetColumnName: null,
      },
      {
        goalId: "output_1",
        prompt: "Welches Feld definiert das primäre Datum?",
        kind: "single_choice",
        questionDomain: "interpretation",
        options: ["eingang_datum", "entscheidung_datum"],
        recommendedOption: null,
        recommendedConfidence: null,
        isBlocking: true,
        questionCode: "primary_date_field",
        targetTableName: "mentors",
        targetColumnName: null,
      },
    ],
    toolRequests: [],
    limitations: [],
    validation: { status: "passed", issues: [] },
  };

  let plannerCallCount = 0;
  const fixture = createServiceFixture({
    plannerResponse: [twoQuestionPlan],
    // Only the second call (the replan triggered by answering the first
    // question) fails — the first call must succeed normally.
    plannerCallSideEffect: () => {
      plannerCallCount += 1;
      if (plannerCallCount === 2) {
        throw new AppError(
          "The Python processing service timed out while planning the ActivityAnalystV2 analysis.",
          504,
          "python_processing_activity_analysis_v2_plan_timeout",
        );
      }
    },
  });

  const initialRun = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );
  assert.equal(initialRun.clarificationQuestions.length, 2);
  const [statusQuestion, dateQuestion] = initialRun.clarificationQuestions;
  assert.ok(statusQuestion);
  assert.ok(dateQuestion);

  await fixture.service.answerClarificationQuestion(
    "user-1",
    "activity-1",
    statusQuestion.id,
    "status",
  );
  const runAfterTimeout = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(runAfterTimeout.status, "failed");
  // The other question must still be present and pending, not wiped out.
  assert.equal(runAfterTimeout.clarificationQuestions.length, 2);
  const survivingDateQuestion = runAfterTimeout.clarificationQuestions.find(
    (question) => question.id === dateQuestion.id,
  );
  assert.ok(survivingDateQuestion);
  assert.equal(survivingDateQuestion.status, "pending");
  // The answer that was submitted right before the failure is reflected too.
  const survivingStatusQuestion = runAfterTimeout.clarificationQuestions.find(
    (question) => question.id === statusQuestion.id,
  );
  assert.equal(survivingStatusQuestion?.status, "answered");

  // Answering the surviving question must not 404 — it must still be
  // findable on the latest run.
  await assert.doesNotReject(() =>
    fixture.service.answerClarificationQuestion(
      "user-1",
      "activity-1",
      dateQuestion.id,
      "eingang_datum",
    ),
  );
});

test("answerClarificationQuestions persists a batch of answers, and the resulting replan job costs a single planner call", async () => {
  const fixture = createServiceFixture({
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "Mindestens 70 Bewerbungen sammeln",
          evaluationMode: "numeric_target",
          status: "requires_clarification",
          rationale: "Two definitions are still ambiguous.",
          plannedToolNames: [],
          missingCapabilities: [],
        },
      ],
      clarificationQuestions: [
        {
          goalId: "output_1",
          prompt: "Welches Feld definiert den finalen Bewerbungsstatus?",
          kind: "single_choice",
          questionDomain: "interpretation",
          options: ["status", "entscheidung"],
          recommendedOption: null,
          recommendedConfidence: null,
          isBlocking: true,
          questionCode: "primary_status_field",
          targetTableName: "mentors",
          targetColumnName: null,
        },
        {
          goalId: "output_1",
          prompt: "Welches Feld definiert das primäre Datum?",
          kind: "single_choice",
          questionDomain: "interpretation",
          options: ["eingang_datum", "entscheidung_datum"],
          recommendedOption: null,
          recommendedConfidence: null,
          isBlocking: true,
          questionCode: "primary_date_field",
          targetTableName: "mentors",
          targetColumnName: null,
        },
      ],
      toolRequests: [],
      limitations: [],
      validation: { status: "passed", issues: [] },
    },
  });

  const initialRun = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );
  const [statusQuestion, dateQuestion] = initialRun.clarificationQuestions;
  assert.ok(statusQuestion);
  assert.ok(dateQuestion);
  assert.equal(fixture.getPlannerRequests().length, 1);

  await fixture.service.answerClarificationQuestions("user-1", "activity-1", [
    { questionId: statusQuestion.id, answeredValue: "status" },
    { questionId: dateQuestion.id, answeredValue: "eingang_datum" },
  ]);

  // Persisting the batch must not itself trigger a replan.
  assert.equal(fixture.getPlannerRequests().length, 1);
  assert.equal(fixture.getActivityAnalysisV2ClarificationAnswers().length, 2);

  // Simulates what activityAnalysisWorker.ts does next: a single
  // previewActivityAnalysis call replans with both persisted answers at
  // once — one batch of two answers must still cost exactly one additional
  // planner call, not one per answer.
  const runAfterBatch = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );
  assert.equal(fixture.getPlannerRequests().length, 2);
  assert.ok(
    runAfterBatch.clarificationQuestions.every(
      (question) => question.status === "answered",
    ),
  );
});

test("answerClarificationQuestions rejects the whole batch and persists nothing when one answer is invalid", async () => {
  const fixture = createServiceFixture({
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "Mindestens 70 Bewerbungen sammeln",
          evaluationMode: "numeric_target",
          status: "requires_clarification",
          rationale: "Two definitions are still ambiguous.",
          plannedToolNames: [],
          missingCapabilities: [],
        },
      ],
      clarificationQuestions: [
        {
          goalId: "output_1",
          prompt: "Welches Feld definiert den finalen Bewerbungsstatus?",
          kind: "single_choice",
          questionDomain: "interpretation",
          options: ["status", "entscheidung"],
          recommendedOption: null,
          recommendedConfidence: null,
          isBlocking: true,
          questionCode: "primary_status_field",
          targetTableName: "mentors",
          targetColumnName: null,
        },
        {
          goalId: "output_1",
          prompt: "Welches Feld definiert das primäre Datum?",
          kind: "single_choice",
          questionDomain: "interpretation",
          options: ["eingang_datum", "entscheidung_datum"],
          recommendedOption: null,
          recommendedConfidence: null,
          isBlocking: true,
          questionCode: "primary_date_field",
          targetTableName: "mentors",
          targetColumnName: null,
        },
      ],
      toolRequests: [],
      limitations: [],
      validation: { status: "passed", issues: [] },
    },
  });

  const initialRun = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );
  const [statusQuestion, dateQuestion] = initialRun.clarificationQuestions;
  assert.ok(statusQuestion);
  assert.ok(dateQuestion);

  await assert.rejects(
    () =>
      fixture.service.answerClarificationQuestions("user-1", "activity-1", [
        { questionId: statusQuestion.id, answeredValue: "status" },
        {
          questionId: dateQuestion.id,
          answeredValue: "some_value_never_offered",
        },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "activity_analysis_v2_question_invalid_answer");
      return true;
    },
  );
  // Neither answer must have been persisted — a batch applies atomically.
  assert.equal(fixture.getActivityAnalysisV2ClarificationAnswers().length, 0);
});

test("getLatestActivityAnalysis returns the latest persisted shadow run", async () => {
  const fixture = createServiceFixture();

  await fixture.service.previewActivityAnalysis("user-1", "activity-1");
  const record = await fixture.service.getLatestActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.analysisRunId, "run-1");
});

test("previewActivityAnalysis persists requires_capability goals without executing fallback tools", async () => {
  const fixture = createServiceFixture({
    activityOutput: "Mindestens 70 Bewerbungen sammeln",
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "Mindestens 70 Bewerbungen sammeln",
          evaluationMode: "numeric_target",
          status: "requires_capability",
          rationale:
            "Für dieses Ziel wäre eine Häufigkeitsberechnung pro Zeitraum nötig.",
          plannedToolNames: [],
          missingCapabilities: [
            {
              kind: "deterministic_calculation",
              name: "event_frequency",
              reason:
                "Need events-per-period calculation by entity before target comparison.",
            },
          ],
        },
      ],
      toolRequests: [],
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

  assert.equal(record.status, "completed");
  assert.equal(record.validation.status, "passed");
  assert.equal(record.toolCallTrace.length, 0);
  assert.equal(record.calculations.length, 0);
  assert.equal(
    record.assessment?.goalAssessments[0]?.assessmentStatus,
    "requires_capability",
  );
  assert.deepEqual(record.assessment?.goalAssessments[0]?.missingCapabilities, [
    {
      kind: "deterministic_calculation",
      name: "event_frequency",
      reason:
        "Need events-per-period calculation by entity before target comparison.",
    },
  ]);
  assert.equal(record.diagnostics.executedToolCallCount, 0);
  assert.equal(record.diagnostics.goalStatusCounts.requiresCapability, 1);
});

test("previewActivityAnalysis normalizes percentage goals to decimal targets before planning", async () => {
  const fixture = createServiceFixture({
    activityOutput:
      "65 Mentor:innen schulen\nMindestens 80 % Teilnahmequote an beiden Schulungstagen",
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "65 Mentor:innen schulen",
          evaluationMode: "numeric_target",
          status: "requires_capability",
          rationale: "Not relevant for this parser regression.",
          plannedToolNames: [],
          missingCapabilities: [],
        },
        {
          goalId: "output_2",
          goalType: "output",
          goalText: "Mindestens 80 % Teilnahmequote an beiden Schulungstagen",
          evaluationMode: "numeric_target",
          status: "requires_capability",
          rationale: "Not relevant for this parser regression.",
          plannedToolNames: [],
          missingCapabilities: [],
        },
      ],
      toolRequests: [],
      limitations: [],
      validation: {
        status: "passed",
        issues: [],
      },
    },
  });

  await fixture.service.previewActivityAnalysis("user-1", "activity-1");

  const plannerRequests = fixture.getPlannerRequests();
  assert.equal(plannerRequests.length, 1);
  const goals = Array.isArray(plannerRequests[0]?.goals)
    ? (plannerRequests[0]?.goals as Array<Record<string, unknown>>)
    : [];
  assert.equal(goals.length, 2);
  assert.equal(goals[0]?.targetNumber, 65);
  assert.equal(goals[1]?.targetNumber, 0.8);
});

test("previewActivityAnalysis fails when the Python planner is unavailable", async () => {
  const fixture = createServiceFixture({
    activityOutput:
      "Mindestens 70 Bewerbungen sammeln\n65 geeignete Mentor:innen auswählen",
    privacySafeRepresentations: [
      {
        id: "psr-1",
        uploadMetadataId: "upload-1",
        payload: {
          metadata: {
            evidenceModality: "structured_quantitative",
            interpretationDataType: "tabular_structured",
          },
          tables: [
            {
              name: "mentors",
              rows: [
                {
                  bewerbungs_id: "B001",
                  status: "eingegangen",
                },
              ],
            },
          ],
        },
      },
    ],
    plannerError: new AppError(
      "The Python processing service could not plan the ActivityAnalystV2 analysis.",
      502,
      "python_processing_activity_analysis_v2_plan_unavailable",
      {
        upstreamStatus: 404,
        upstreamBody: '{"detail":"Not Found"}',
      },
    ),
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.status, "failed");
  assert.equal(record.phase, "phase_3_goal_planner");
  assert.equal(record.validation.status, "failed");
  assert.equal(record.toolCallTrace.length, 0);
  assert.equal(record.calculations.length, 0);
  assert.equal(record.assessment, null);
  assert.match(
    record.errorMessage ?? "",
    /could not plan the ActivityAnalystV2 analysis/i,
  );
});

test("previewActivityAnalysis rejects when any current upload is still missing privacy-safe evidence", async () => {
  const fixture = createServiceFixture({
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        logicalEvidenceId: "evidence-1",
        versionNumber: 1,
        originalFileName: "mentors.csv",
        createdAt: NOW,
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        logicalEvidenceId: "evidence-2",
        versionNumber: 1,
        originalFileName: "notes.csv",
        createdAt: NOW,
      },
    ],
    privacySafeRepresentations: [
      {
        id: "psr-1",
        uploadMetadataId: "upload-1",
        payload: {
          metadata: {
            evidenceModality: "structured_quantitative",
            interpretationDataType: "tabular_structured",
          },
        },
      },
    ],
  });

  await assert.rejects(
    fixture.service.previewActivityAnalysis("user-1", "activity-1"),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "activity_analysis_v2_not_ready",
      );
      return true;
    },
  );
  assert.equal(fixture.createdRuns.length, 0);
});
