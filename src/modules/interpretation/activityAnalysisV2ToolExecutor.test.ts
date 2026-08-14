import assert from "node:assert/strict";
import test from "node:test";
import { ActivityAnalysisV2ToolExecutor } from "./activityAnalysisV2ToolExecutor.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "./datasetPreparationRepository.js";
import type { CurrentActivityEvidenceSnapshot } from "./currentActivityEvidenceLoader.js";

const NOW = new Date("2026-08-08T12:00:00.000Z");

function createExecutorFixture(options?: {
  evidence?: CurrentActivityEvidenceSnapshot;
  results?: Array<{ id: string; uploadMetadataId: string }>;
  preparedTablesByResultId?: Map<string, Record<string, unknown>>;
}) {
  const evidence =
    options?.evidence ??
    ({
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      evidence: [
        {
          uploadMetadataId: "upload-1",
          privacySafeRepresentationId: "psr-1",
          logicalEvidenceId: "evidence-1",
          versionNumber: 1,
          originalFileName: "applications.csv",
          evidenceModality: "structured_quantitative",
          uploadedAt: NOW,
          payload: {
            tables: [
              {
                name: "applications",
                rows: [
                  {
                    bewerbungs_id: "A1",
                    eignung_status: "geeignet",
                    safeguarding_status: "ok",
                    motivation_score: "4",
                    eingang_datum: "2026-03-03",
                  },
                  {
                    bewerbungs_id: "A1",
                    eignung_status: "geeignet",
                    safeguarding_status: "ok",
                    motivation_score: "4",
                    eingang_datum: "2026-03-03",
                  },
                  {
                    bewerbungs_id: "A2",
                    eignung_status: "bedingt",
                    safeguarding_status: "ausstehend",
                    motivation_score: "3",
                    eingang_datum: "2026-03-07",
                  },
                  {
                    bewerbungs_id: "A3",
                    eignung_status: "geeignet",
                    safeguarding_status: "ausstehend",
                    motivation_score: "5",
                    eingang_datum: "2026-04-01",
                  },
                ],
              },
            ],
          },
        },
      ],
      missingPrivacySafeUploads: [],
    } satisfies CurrentActivityEvidenceSnapshot);

  const results = options?.results ?? [
    { id: "result-1", uploadMetadataId: "upload-1" },
  ];
  const preparedTablesByResultId =
    options?.preparedTablesByResultId ??
    new Map([
      [
        "result-1",
        {
          evidenceModality: "structured_quantitative",
          isReadyForDeterministicAnalysis: true,
          unresolvedRequirements: [],
          tables: [
            {
              name: "applications",
              rowCount: 4,
              columnCount: 5,
              selectedRowGrain: "application record",
              identifierColumn: "bewerbungs_id",
              identifierHandling: "deduplicate_by_identifier",
              primaryStatusColumn: "eignung_status",
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
                  name: "eignung_status",
                  inferredType: "categorical",
                  role: "primary_status",
                  positiveStatusValues: ["geeignet"],
                  positiveStatusDefinitionText: "geeignet",
                  normalizationAccepted: true,
                },
                {
                  name: "safeguarding_status",
                  inferredType: "categorical",
                  role: "subgroup",
                  positiveStatusValues: [],
                  positiveStatusDefinitionText: null,
                  normalizationAccepted: true,
                },
                {
                  name: "motivation_score",
                  inferredType: "numeric",
                  role: "measure",
                  positiveStatusValues: [],
                  positiveStatusDefinitionText: null,
                  normalizationAccepted: true,
                },
                {
                  name: "eingang_datum",
                  inferredType: "date",
                  role: "primary_date",
                  positiveStatusValues: [],
                  positiveStatusDefinitionText: null,
                  normalizationAccepted: true,
                },
              ],
              notes: [],
            },
          ],
        },
      ],
    ]);

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      results
        .filter((result) => uploadMetadataIds.includes(result.uploadMetadataId))
        .map((result) => ({
          id: result.id,
          uploadMetadataId: result.uploadMetadataId,
        })),
  } as unknown as InterpretationResultRepository;

  const datasetPreparationRepository = {
    findByInterpretationResultIds: async (interpretationResultIds: string[]) =>
      interpretationResultIds
        .filter((id) => preparedTablesByResultId.has(id))
        .map((id) => ({
          interpretationResultId: id,
          preparedDataset: preparedTablesByResultId.get(id),
        })),
  } as unknown as DatasetPreparationRepository;

  return {
    executor: new ActivityAnalysisV2ToolExecutor(
      interpretationResultRepository,
      datasetPreparationRepository,
    ),
    evidence,
  };
}

function createEpistemicRoleGateFixture() {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-qual-1",
        privacySafeRepresentationId: "psr-qual-1",
        logicalEvidenceId: "evidence-qual-1",
        versionNumber: 1,
        originalFileName: "mentor_feedback.csv",
        evidenceModality: "structured_qualitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "mentor_feedback",
              rows: [
                {
                  participant_id: "P1",
                  confidence_code: "5",
                  theme_code: "improved",
                  reflection_note:
                    "Meryem Lange said she feels more confident speaking up.",
                },
                {
                  participant_id: "P2",
                  confidence_code: "4",
                  theme_code: "improved",
                  reflection_note:
                    "Jordan Smith described a much clearer sense of direction.",
                },
                {
                  participant_id: "P3",
                  confidence_code: "2",
                  theme_code: "stalled",
                  reflection_note: "",
                },
              ],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const preparedTablesByResultId = new Map([
    [
      "result-qual-1",
      {
        evidenceModality: "structured_qualitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "mentor_feedback",
            rowCount: 3,
            columnCount: 4,
            selectedRowGrain: "participant record",
            identifierColumn: "participant_id",
            identifierHandling: "deduplicate_by_identifier",
            primaryStatusColumn: null,
            primaryDateColumn: null,
            columns: [
              {
                name: "participant_id",
                inferredType: "identifier",
                role: "identifier",
                epistemicRole: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "confidence_code",
                inferredType: "numeric",
                role: "measure",
                epistemicRole: "subjective_code",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "theme_code",
                inferredType: "categorical",
                role: "subgroup",
                epistemicRole: "subjective_code",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "reflection_note",
                inferredType: "free_text",
                role: "free_text",
                epistemicRole: "free_text",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
  ]);

  return createExecutorFixture({
    evidence,
    results: [{ id: "result-qual-1", uploadMetadataId: "upload-qual-1" }],
    preparedTablesByResultId,
  });
}

test("describe_evidence reports analysis-row counts on deduplicated entity-grain tables", async () => {
  const fixture = createExecutorFixture();

  const result = await fixture.executor.execute(
    [
      {
        toolName: "describe_evidence",
        arguments: {},
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.toolCallTrace.length, 1);
  assert.equal(result.toolCallTrace[0]?.status, "succeeded");
  assert.equal(result.calculations.length, 1);
  assert.equal(result.calculations[0]?.toolName, "describe_evidence");
  assert.equal(result.calculations[0]?.value, 3);
  assert.equal(result.calculations[0]?.grain, "entity");
  assert.equal(result.calculations[0]?.denominatorType, "distinct_entities");
  assert.deepEqual(result.calculations[0]?.result, {
    rawRowCount: 4,
    analysisRowCount: 3,
    columnCount: 5,
    identifierColumn: "bewerbungs_id",
    identifierHandling: "deduplicate_by_identifier",
    identifierDistinctCount: 3,
    primaryStatusColumn: "eignung_status",
    evidenceModalityReady: true,
  });
});

test("count_rows can distinguish raw rows from prepared analysis rows", async () => {
  const fixture = createExecutorFixture();

  const result = await fixture.executor.execute(
    [
      {
        toolName: "count_rows",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "applications",
          useAnalysisRows: false,
        },
      },
      {
        toolName: "count_rows",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "applications",
          useAnalysisRows: true,
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations.length, 2);
  assert.equal(result.calculations[0]?.value, 4);
  assert.equal(result.calculations[0]?.result.basis, "raw_rows");
  assert.equal(result.calculations[1]?.value, 3);
  assert.equal(result.calculations[1]?.result.basis, "analysis_rows");
});

test("aggregate_numeric rejects subjective-code columns for outcome-style claims", async () => {
  const fixture = createEpistemicRoleGateFixture();

  const result = await fixture.executor.execute(
    [
      {
        goalId: "outcome_1",
        toolName: "aggregate_numeric",
        arguments: {
          uploadMetadataId: "upload-qual-1",
          tableName: "mentor_feedback",
          columnName: "confidence_code",
          operation: "avg",
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations.length, 0);
  assert.equal(result.toolCallTrace[0]?.status, "failed");
  assert.match(
    result.toolCallTrace[0]?.errorMessage ?? "",
    /epistemic_role_gate_downgrade/i,
  );
});

test("a goal downgraded by the epistemic-role gate still executes its later excerpt_retrieval call", async () => {
  const fixture = createEpistemicRoleGateFixture();

  const result = await fixture.executor.execute(
    [
      {
        goalId: "outcome_1",
        toolName: "aggregate_numeric",
        arguments: {
          uploadMetadataId: "upload-qual-1",
          tableName: "mentor_feedback",
          columnName: "confidence_code",
          operation: "avg",
        },
      },
      {
        goalId: "outcome_1",
        toolName: "excerpt_retrieval",
        arguments: {
          uploadMetadataId: "upload-qual-1",
          tableName: "mentor_feedback",
          columnName: "reflection_note",
          limit: 2,
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.toolCallTrace[0]?.status, "failed");
  assert.match(
    result.toolCallTrace[0]?.errorMessage ?? "",
    /epistemic_role_gate_downgrade/i,
  );
  // A goal downgraded to qualitative_evidence_only must still be able to
  // collect the qualitative evidence it was downgraded to — the gate must
  // reject only the specific blocked request, not every later request for
  // the same goal.
  assert.equal(result.toolCallTrace[1]?.status, "succeeded");
  assert.equal(result.qualitativeFindings.length, 1);
});

test("paired_change is blocked when its pre/post columns are subjective_code", async () => {
  const fixture = createEpistemicRoleGateFixture();

  const result = await fixture.executor.execute(
    [
      {
        goalId: "outcome_1",
        toolName: "paired_change",
        alias: "confidence_change",
        arguments: {
          uploadMetadataId: "upload-qual-1",
          tableName: "mentor_feedback",
          entityColumnName: "participant_id",
          preColumnName: "confidence_code",
          postColumnName: "confidence_code",
          outputColumnName: "confidence_delta",
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations.length, 0);
  assert.equal(result.toolCallTrace[0]?.status, "failed");
  assert.match(
    result.toolCallTrace[0]?.errorMessage ?? "",
    /epistemic_role_gate_downgrade/i,
  );
});

test("compare_target is blocked when a scalar alias comes from a qualitative-filtered cohort", async () => {
  const fixture = createEpistemicRoleGateFixture();

  const result = await fixture.executor.execute(
    [
      {
        goalId: "outcome_1",
        toolName: "create_cohort",
        alias: "improved_theme_rows",
        arguments: {
          uploadMetadataId: "upload-qual-1",
          tableName: "mentor_feedback",
          filters: [
            {
              columnName: "theme_code",
              operator: "equals",
              value: "improved",
            },
          ],
        },
      },
      {
        goalId: "outcome_1",
        toolName: "count_rows",
        alias: "improved_theme_count",
        arguments: {
          cohortAlias: "improved_theme_rows",
        },
      },
      {
        goalId: "outcome_1",
        toolName: "compare_target",
        arguments: {
          valueAlias: "improved_theme_count",
          target: 2,
          comparison: "at_least",
          label: "Improved coded reflections",
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations.length, 2);
  assert.equal(result.toolCallTrace[0]?.status, "succeeded");
  assert.equal(result.toolCallTrace[1]?.status, "succeeded");
  assert.equal(result.toolCallTrace[2]?.status, "failed");
  assert.match(result.toolCallTrace[2]?.errorMessage ?? "", /subjective_code/i);
  assert.deepEqual(result.calculations[1]?.sourceColumnEpistemicRoles, [
    { columnName: "theme_code", epistemicRole: "subjective_code" },
  ]);
});

test("synthetic qualitative code columns are treated as subjective_code by the executor", async () => {
  const fixture = createExecutorFixture({
    evidence: {
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      evidence: [
        {
          uploadMetadataId: "upload-1",
          privacySafeRepresentationId: "psr-1",
          logicalEvidenceId: "evidence-1",
          versionNumber: 1,
          originalFileName: "mentor_feedback.csv",
          evidenceModality: "structured_qualitative",
          uploadedAt: NOW,
          payload: {
            tables: [
              {
                name: "applications",
                rows: [
                  {
                    bewerbungs_id: "A1",
                    reflection_note: "I feel more confident now.",
                    reflection_note_coded: "improved",
                  },
                  {
                    bewerbungs_id: "A2",
                    reflection_note: "Still uncertain.",
                    reflection_note_coded: "uncertain",
                  },
                  {
                    bewerbungs_id: "A3",
                    reflection_note: "Much clearer direction.",
                    reflection_note_coded: "improved",
                  },
                ],
                syntheticColumnMetadata: [
                  {
                    name: "reflection_note_coded",
                    sourceTextColumnName: "reflection_note",
                    epistemicRole: "subjective_code",
                    inferredType: "categorical",
                  },
                ],
              },
            ],
          },
        },
      ],
      missingPrivacySafeUploads: [],
    },
    preparedTablesByResultId: new Map([
      [
        "result-1",
        {
          evidenceModality: "structured_qualitative",
          isReadyForDeterministicAnalysis: true,
          unresolvedRequirements: [],
          tables: [
            {
              name: "applications",
              rowCount: 3,
              columnCount: 2,
              selectedRowGrain: "application record",
              identifierColumn: "bewerbungs_id",
              identifierHandling: "deduplicate_by_identifier",
              primaryStatusColumn: null,
              primaryDateColumn: null,
              columns: [
                {
                  name: "bewerbungs_id",
                  inferredType: "identifier",
                  role: "identifier",
                  epistemicRole: "identifier",
                  positiveStatusValues: [],
                  positiveStatusDefinitionText: null,
                  normalizationAccepted: true,
                },
                {
                  name: "reflection_note",
                  inferredType: "free_text",
                  role: "free_text",
                  epistemicRole: "free_text",
                  positiveStatusValues: [],
                  positiveStatusDefinitionText: null,
                  normalizationAccepted: true,
                },
              ],
              notes: [],
            },
          ],
        },
      ],
    ]),
  });

  const result = await fixture.executor.execute(
    [
      {
        goalId: "outcome_1",
        toolName: "create_cohort",
        alias: "improved_synthetic_rows",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "applications",
          filters: [
            {
              columnName: "reflection_note_coded",
              operator: "equals",
              value: "improved",
            },
          ],
        },
      },
      {
        goalId: "outcome_1",
        toolName: "count_rows",
        alias: "improved_synthetic_count",
        arguments: {
          cohortAlias: "improved_synthetic_rows",
        },
      },
      {
        goalId: "outcome_1",
        toolName: "compare_target",
        arguments: {
          valueAlias: "improved_synthetic_count",
          target: 2,
          comparison: "at_least",
          label: "Improved coded reflections",
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations.length, 2);
  assert.equal(result.toolCallTrace[0]?.status, "succeeded");
  assert.equal(result.toolCallTrace[1]?.status, "succeeded");
  assert.equal(result.toolCallTrace[2]?.status, "failed");
  assert.match(result.toolCallTrace[2]?.errorMessage ?? "", /subjective_code/i);
  assert.deepEqual(result.calculations[1]?.sourceColumnEpistemicRoles, [
    { columnName: "reflection_note_coded", epistemicRole: "subjective_code" },
  ]);
});

test("excerpt_retrieval returns grounded qualitative findings with excerpt provenance", async () => {
  const fixture = createEpistemicRoleGateFixture();

  const result = await fixture.executor.execute(
    [
      {
        goalId: "outcome_1",
        toolName: "excerpt_retrieval",
        arguments: {
          uploadMetadataId: "upload-qual-1",
          tableName: "mentor_feedback",
          columnName: "reflection_note",
          limit: 2,
          filters: [
            {
              columnName: "theme_code",
              operator: "equals",
              value: "improved",
            },
          ],
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations.length, 0);
  assert.equal(result.qualitativeFindings.length, 1);
  assert.equal(result.toolCallTrace[0]?.status, "succeeded");
  assert.deepEqual(result.toolCallTrace[0]?.qualitativeFindingIds, [
    result.qualitativeFindings[0]?.findingId,
  ]);
  assert.equal(result.qualitativeFindings[0]?.excerptsReturned, 2);
  assert.equal(result.qualitativeFindings[0]?.totalMatchingRows, 2);
  assert.equal(
    result.qualitativeFindings[0]?.excerpts[0]?.sourceColumn,
    "reflection_note",
  );
  assert.deepEqual(result.qualitativeFindings[0]?.sourceColumnEpistemicRoles, [
    { columnName: "reflection_note", epistemicRole: "free_text" },
    { columnName: "theme_code", epistemicRole: "subjective_code" },
  ]);
});

test("intersection_count uses distinct entity sets across two tables", async () => {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-day-1",
        privacySafeRepresentationId: "psr-day-1",
        logicalEvidenceId: "day-1",
        versionNumber: 1,
        originalFileName: "day1.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "attendance_day_1",
              rows: [
                { participant_id: "P01" },
                { participant_id: "P02" },
                { participant_id: "P03" },
              ],
            },
          ],
        },
      },
      {
        uploadMetadataId: "upload-day-2",
        privacySafeRepresentationId: "psr-day-2",
        logicalEvidenceId: "day-2",
        versionNumber: 1,
        originalFileName: "day2.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "attendance_day_2",
              rows: [
                { participant_id: "P02" },
                { participant_id: "P03" },
                { participant_id: "P04" },
              ],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const preparedTablesByResultId = new Map([
    [
      "result-day-1",
      {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "attendance_day_1",
            rowCount: 3,
            columnCount: 1,
            selectedRowGrain: "participant record",
            identifierColumn: "participant_id",
            identifierHandling: "deduplicate_by_identifier",
            primaryStatusColumn: null,
            primaryDateColumn: null,
            columns: [
              {
                name: "participant_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
    [
      "result-day-2",
      {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "attendance_day_2",
            rowCount: 3,
            columnCount: 1,
            selectedRowGrain: "participant record",
            identifierColumn: "participant_id",
            identifierHandling: "deduplicate_by_identifier",
            primaryStatusColumn: null,
            primaryDateColumn: null,
            columns: [
              {
                name: "participant_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
  ]);

  const fixture = createExecutorFixture({
    evidence,
    results: [
      { id: "result-day-1", uploadMetadataId: "upload-day-1" },
      { id: "result-day-2", uploadMetadataId: "upload-day-2" },
    ],
    preparedTablesByResultId,
  });

  const result = await fixture.executor.execute(
    [
      {
        toolName: "intersection_count",
        arguments: {
          left: {
            uploadMetadataId: "upload-day-1",
            tableName: "attendance_day_1",
          },
          right: {
            uploadMetadataId: "upload-day-2",
            tableName: "attendance_day_2",
          },
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations.length, 1);
  assert.equal(result.calculations[0]?.toolName, "intersection_count");
  assert.equal(result.calculations[0]?.value, 2);
  assert.equal(result.calculations[0]?.grain, "entity");
  assert.equal(result.calculations[0]?.denominatorType, "distinct_entities");
  assert.deepEqual(result.calculations[0]?.result, {
    count: 2,
    leftDistinctCount: 3,
    rightDistinctCount: 3,
    sharedDistinctCount: 2,
    leftSourceLabel: "attendance_day_1",
    rightSourceLabel: "attendance_day_2",
    leftFilters: [],
    rightFilters: [],
  });
});

test("intersection_count matches identifiers that differ only by case across two files", async () => {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-left",
        privacySafeRepresentationId: "psr-left",
        logicalEvidenceId: "left",
        versionNumber: 1,
        originalFileName: "left.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "left_table",
              rows: [{ participant_id: "Alpha" }, { participant_id: "Beta" }],
            },
          ],
        },
      },
      {
        uploadMetadataId: "upload-right",
        privacySafeRepresentationId: "psr-right",
        logicalEvidenceId: "right",
        versionNumber: 1,
        originalFileName: "right.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "right_table",
              // "alpha" only differs from the left table's "Alpha" by case —
              // this must still count as the same member.
              rows: [{ participant_id: "alpha" }, { participant_id: "Gamma" }],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const fixture = createExecutorFixture({ evidence });

  const result = await fixture.executor.execute(
    [
      {
        toolName: "intersection_count",
        arguments: {
          left: {
            uploadMetadataId: "upload-left",
            tableName: "left_table",
            columnName: "participant_id",
          },
          right: {
            uploadMetadataId: "upload-right",
            tableName: "right_table",
            columnName: "participant_id",
          },
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations[0]?.value, 1);
  assert.equal(
    (result.calculations[0]?.result as { sharedDistinctCount: number })
      .sharedDistinctCount,
    1,
  );
});

test("intersection_set surfaces a duplicate-identifier count instead of silently dropping the extra rows", async () => {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-left",
        privacySafeRepresentationId: "psr-left",
        logicalEvidenceId: "left",
        versionNumber: 1,
        originalFileName: "left.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "left_table",
              rows: [
                { participant_id: "Alpha" },
                // "Beta" and "beta" are the same member under
                // case-insensitive matching, so the second is a duplicate.
                { participant_id: "Beta" },
                { participant_id: "beta" },
              ],
            },
          ],
        },
      },
      {
        uploadMetadataId: "upload-right",
        privacySafeRepresentationId: "psr-right",
        logicalEvidenceId: "right",
        versionNumber: 1,
        originalFileName: "right.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "right_table",
              rows: [{ participant_id: "alpha" }],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const fixture = createExecutorFixture({ evidence });

  const result = await fixture.executor.execute(
    [
      {
        toolName: "create_cohort",
        alias: "left_cohort",
        arguments: {
          uploadMetadataId: "upload-left",
          tableName: "left_table",
          useAnalysisRows: false,
        },
      },
      {
        toolName: "create_cohort",
        alias: "right_cohort",
        arguments: {
          uploadMetadataId: "upload-right",
          tableName: "right_table",
          useAnalysisRows: false,
        },
      },
      {
        toolName: "intersection_set",
        alias: "shared",
        arguments: {
          left: { cohortAlias: "left_cohort", columnName: "participant_id" },
          right: { cohortAlias: "right_cohort", columnName: "participant_id" },
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  const intersectionCalculation = result.calculations.find(
    (calculation) => calculation.toolName === "intersection_set",
  );
  const intersectionResult = intersectionCalculation?.result as {
    leftDuplicateKeyRowCount: number;
    rightDuplicateKeyRowCount: number;
  };
  assert.equal(intersectionResult.leftDuplicateKeyRowCount, 1);
  assert.equal(intersectionResult.rightDuplicateKeyRowCount, 0);
});

test("days_since_last_event without an explicit referenceDate uses the run's start time, not wall-clock now()", async () => {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-1",
        privacySafeRepresentationId: "psr-1",
        logicalEvidenceId: "evidence-1",
        versionNumber: 1,
        originalFileName: "meetings.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "meetings",
              rows: [{ tandem_id: "T1", meeting_date: "2026-01-01" }],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const fixture = createExecutorFixture({ evidence });
  // Deliberately far from real wall-clock "now" — if the implementation
  // ever falls back to `new Date()` instead of this run's start time, the
  // computed day count below would not match a fixed expectation and this
  // test would fail regardless of when it happens to run.
  const runStartedAt = new Date("2026-01-11T00:00:00.000Z").getTime();

  const result = await fixture.executor.execute(
    [
      {
        toolName: "days_since_last_event",
        alias: "recency",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "meetings",
          entityColumnName: "tandem_id",
          dateColumnName: "meeting_date",
          outputColumnName: "days_since",
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      // This test deliberately sets runStartedAt far from real wall-clock
      // time to prove the tool uses it rather than `new Date()` — the
      // run-timeout guard (which also measures elapsed time since
      // runStartedAt) isn't what's under test here, so give it a budget
      // that can't trip.
      timeoutMs: Number.MAX_SAFE_INTEGER,
      maxEvidenceItems: 25,
    },
    runStartedAt,
  );

  const calculationResult = result.calculations[0]?.result as {
    referenceDate: string;
    rows: Array<{ tandem_id: string; days_since: number }>;
  };
  assert.equal(calculationResult.referenceDate, "2026-01-11");
  assert.deepEqual(calculationResult.rows, [
    { tandem_id: "T1", days_since: 10 },
  ]);
});

test("compare_target can consume a prior aliased deterministic value", async () => {
  const fixture = createExecutorFixture();

  const result = await fixture.executor.execute(
    [
      {
        toolName: "count_distinct",
        alias: "application_count",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "applications",
          columnName: "bewerbungs_id",
          useAnalysisRows: true,
        },
      },
      {
        toolName: "compare_target",
        arguments: {
          valueAlias: "application_count",
          target: 3,
          comparison: "at_least",
          label: "Application goal",
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations.length, 2);
  assert.equal(result.calculations[0]?.value, 3);
  assert.equal(result.calculations[1]?.toolName, "compare_target");
  assert.equal(result.calculations[1]?.value, true);
  assert.deepEqual(result.calculations[1]?.result, {
    achieved: true,
    gap: 0,
    comparison: "at_least",
    value: 3,
    target: 3,
  });
});

test("table tools can filter on categorical and numeric conditions over analysis rows", async () => {
  const fixture = createExecutorFixture();

  const result = await fixture.executor.execute(
    [
      {
        toolName: "count_rows",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "applications",
          useAnalysisRows: true,
          filters: [
            {
              columnName: "eignung_status",
              operator: "equals",
              value: "geeignet",
            },
          ],
        },
      },
      {
        toolName: "aggregate_numeric",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "applications",
          columnName: "motivation_score",
          operation: "avg",
          useAnalysisRows: true,
          filters: [
            {
              columnName: "eignung_status",
              operator: "equals",
              value: "geeignet",
            },
            {
              columnName: "motivation_score",
              operator: "greater_than_or_equal",
              value: 4,
            },
          ],
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations[0]?.value, 2);
  assert.deepEqual(result.calculations[0]?.result.filters, [
    {
      columnName: "eignung_status",
      operator: "equals",
      value: "geeignet",
    },
  ]);
  assert.equal(result.calculations[1]?.value, 4.5);
  assert.equal(result.calculations[1]?.result.numericValueCount, 2);
});

test("group_count and crosstab_count can describe filtered subgroups", async () => {
  const fixture = createExecutorFixture();

  const result = await fixture.executor.execute(
    [
      {
        toolName: "group_count",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "applications",
          columnName: "safeguarding_status",
          useAnalysisRows: true,
          filters: [
            {
              columnName: "eignung_status",
              operator: "equals",
              value: "geeignet",
            },
          ],
        },
      },
      {
        toolName: "crosstab_count",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "applications",
          leftColumnName: "eignung_status",
          rightColumnName: "safeguarding_status",
          useAnalysisRows: true,
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.deepEqual(result.calculations[0]?.result.groups, [
    { value: "ok", count: 1 },
    { value: "ausstehend", count: 1 },
  ]);
  assert.deepEqual(result.calculations[1]?.result.cells, [
    { leftValue: "geeignet", rightValue: "ok", count: 1 },
    { leftValue: "bedingt", rightValue: "ausstehend", count: 1 },
    { leftValue: "geeignet", rightValue: "ausstehend", count: 1 },
  ]);
});

test("time_bucket_count groups deduplicated entities by date bucket", async () => {
  const fixture = createExecutorFixture();

  const result = await fixture.executor.execute(
    [
      {
        toolName: "time_bucket_count",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "applications",
          columnName: "eingang_datum",
          granularity: "month",
          useAnalysisRows: true,
          filters: [
            {
              columnName: "eignung_status",
              operator: "in",
              value: ["geeignet", "bedingt"],
            },
          ],
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations[0]?.toolName, "time_bucket_count");
  assert.equal(result.calculations[0]?.value, 2);
  assert.deepEqual(result.calculations[0]?.result.buckets, [
    { bucket: "2026-03", count: 2 },
    { bucket: "2026-04", count: 1 },
  ]);
});

test("create_cohort can feed later deterministic tools through a reusable cohort alias", async () => {
  const fixture = createExecutorFixture();

  const result = await fixture.executor.execute(
    [
      {
        toolName: "create_cohort",
        alias: "suitable_candidates",
        arguments: {
          uploadMetadataId: "upload-1",
          tableName: "applications",
          useAnalysisRows: true,
          filters: [
            {
              columnName: "eignung_status",
              operator: "equals",
              value: "geeignet",
            },
          ],
        },
      },
      {
        toolName: "count_rows",
        arguments: {
          cohortAlias: "suitable_candidates",
        },
      },
      {
        toolName: "group_count",
        arguments: {
          cohortAlias: "suitable_candidates",
          columnName: "safeguarding_status",
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations[0]?.toolName, "create_cohort");
  assert.equal(result.calculations[0]?.value, 2);
  assert.deepEqual(result.calculations[0]?.result, {
    cohortAlias: "suitable_candidates",
    count: 2,
    basis: "analysis_rows",
    sourceLabel: "applications",
    filters: [
      {
        columnName: "eignung_status",
        operator: "equals",
        value: "geeignet",
      },
    ],
  });
  assert.equal(result.calculations[1]?.value, 2);
  assert.equal(result.calculations[1]?.result.basis, "cohort");
  assert.deepEqual(result.calculations[2]?.result.groups, [
    { value: "ok", count: 1 },
    { value: "ausstehend", count: 1 },
  ]);
});

test("set operations can build reusable member cohorts for later counting", async () => {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-day-1",
        privacySafeRepresentationId: "psr-day-1",
        logicalEvidenceId: "day-1",
        versionNumber: 1,
        originalFileName: "day1.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "attendance_day_1",
              rows: [
                { participant_id: "P01" },
                { participant_id: "P02" },
                { participant_id: "P03" },
              ],
            },
          ],
        },
      },
      {
        uploadMetadataId: "upload-day-2",
        privacySafeRepresentationId: "psr-day-2",
        logicalEvidenceId: "day-2",
        versionNumber: 1,
        originalFileName: "day2.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "attendance_day_2",
              rows: [
                { participant_id: "P02" },
                { participant_id: "P03" },
                { participant_id: "P04" },
              ],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const preparedTablesByResultId = new Map([
    [
      "result-day-1",
      {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "attendance_day_1",
            rowCount: 3,
            columnCount: 1,
            selectedRowGrain: "participant record",
            identifierColumn: "participant_id",
            identifierHandling: "deduplicate_by_identifier",
            primaryStatusColumn: null,
            primaryDateColumn: null,
            columns: [
              {
                name: "participant_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
    [
      "result-day-2",
      {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "attendance_day_2",
            rowCount: 3,
            columnCount: 1,
            selectedRowGrain: "participant record",
            identifierColumn: "participant_id",
            identifierHandling: "deduplicate_by_identifier",
            primaryStatusColumn: null,
            primaryDateColumn: null,
            columns: [
              {
                name: "participant_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
  ]);

  const fixture = createExecutorFixture({
    evidence,
    results: [
      { id: "result-day-1", uploadMetadataId: "upload-day-1" },
      { id: "result-day-2", uploadMetadataId: "upload-day-2" },
    ],
    preparedTablesByResultId,
  });

  const result = await fixture.executor.execute(
    [
      {
        toolName: "create_cohort",
        alias: "day_1",
        arguments: {
          uploadMetadataId: "upload-day-1",
          tableName: "attendance_day_1",
          useAnalysisRows: true,
        },
      },
      {
        toolName: "create_cohort",
        alias: "day_2",
        arguments: {
          uploadMetadataId: "upload-day-2",
          tableName: "attendance_day_2",
          useAnalysisRows: true,
        },
      },
      {
        toolName: "intersection_set",
        alias: "both_days",
        arguments: {
          left: { cohortAlias: "day_1" },
          right: { cohortAlias: "day_2" },
        },
      },
      {
        toolName: "difference_set",
        alias: "day_1_only",
        arguments: {
          left: { cohortAlias: "day_1" },
          right: { cohortAlias: "day_2" },
        },
      },
      {
        toolName: "union_set",
        alias: "either_day",
        arguments: {
          left: { cohortAlias: "day_1" },
          right: { cohortAlias: "day_2" },
        },
      },
      {
        toolName: "count_rows",
        arguments: { cohortAlias: "both_days" },
      },
      {
        toolName: "count_rows",
        arguments: { cohortAlias: "day_1_only" },
      },
      {
        toolName: "count_rows",
        arguments: { cohortAlias: "either_day" },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations[2]?.toolName, "intersection_set");
  assert.equal(result.calculations[2]?.value, 2);
  assert.equal(result.calculations[3]?.toolName, "difference_set");
  assert.equal(result.calculations[3]?.value, 1);
  assert.equal(result.calculations[4]?.toolName, "union_set");
  assert.equal(result.calculations[4]?.value, 4);
  assert.equal(result.calculations[5]?.value, 2);
  assert.equal(result.calculations[6]?.value, 1);
  assert.equal(result.calculations[7]?.value, 4);
});

test("group_aggregate and filter_result support aggregate-of-aggregate flows", async () => {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-meetings",
        privacySafeRepresentationId: "psr-meetings",
        logicalEvidenceId: "meetings",
        versionNumber: 1,
        originalFileName: "meetings.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "meetings",
              rows: [
                { tandem_id: "T01", duration_minutes: "60" },
                { tandem_id: "T01", duration_minutes: "45" },
                { tandem_id: "T01", duration_minutes: "30" },
                { tandem_id: "T02", duration_minutes: "90" },
                { tandem_id: "T02", duration_minutes: "30" },
                { tandem_id: "T03", duration_minutes: "50" },
              ],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const preparedTablesByResultId = new Map([
    [
      "result-meetings",
      {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "meetings",
            rowCount: 6,
            columnCount: 2,
            selectedRowGrain: "meeting record",
            identifierColumn: "tandem_id",
            identifierHandling: "allow_duplicate_rows_as_events",
            primaryStatusColumn: null,
            primaryDateColumn: null,
            columns: [
              {
                name: "tandem_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "duration_minutes",
                inferredType: "numeric",
                role: "measure",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
  ]);

  const fixture = createExecutorFixture({
    evidence,
    results: [{ id: "result-meetings", uploadMetadataId: "upload-meetings" }],
    preparedTablesByResultId,
  });

  const result = await fixture.executor.execute(
    [
      {
        toolName: "group_aggregate",
        alias: "meetings_by_tandem",
        arguments: {
          uploadMetadataId: "upload-meetings",
          tableName: "meetings",
          useAnalysisRows: true,
          groupBy: ["tandem_id"],
          metrics: [
            { alias: "meeting_count", operation: "count" },
            {
              alias: "total_duration",
              operation: "sum",
              columnName: "duration_minutes",
            },
            {
              alias: "avg_duration",
              operation: "avg",
              columnName: "duration_minutes",
            },
          ],
        },
      },
      {
        toolName: "filter_result",
        alias: "active_tandems",
        arguments: {
          resultAlias: "meetings_by_tandem",
          filters: [
            {
              columnName: "meeting_count",
              operator: "greater_than_or_equal",
              value: 3,
            },
          ],
        },
      },
      {
        toolName: "count_rows",
        arguments: {
          resultAlias: "active_tandems",
        },
      },
      {
        toolName: "aggregate_numeric",
        arguments: {
          resultAlias: "active_tandems",
          columnName: "total_duration",
          operation: "sum",
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations[0]?.toolName, "group_aggregate");
  assert.equal(result.calculations[0]?.value, 3);
  assert.deepEqual(result.calculations[0]?.result.rows, [
    {
      tandem_id: "T01",
      meeting_count: 3,
      total_duration: 135,
      avg_duration: 45,
    },
    {
      tandem_id: "T02",
      meeting_count: 2,
      total_duration: 120,
      avg_duration: 60,
    },
    {
      tandem_id: "T03",
      meeting_count: 1,
      total_duration: 50,
      avg_duration: 50,
    },
  ]);
  assert.equal(result.calculations[1]?.toolName, "filter_result");
  assert.equal(result.calculations[1]?.value, 1);
  assert.equal(result.calculations[2]?.value, 1);
  assert.equal(result.calculations[2]?.result.basis, "result");
  assert.equal(result.calculations[3]?.value, 135);
});

test("join_tables, anti_join, and count_distinct_keys support safe cross-table analysis", async () => {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-matching",
        privacySafeRepresentationId: "psr-matching",
        logicalEvidenceId: "matching",
        versionNumber: 1,
        originalFileName: "matching.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "matching",
              rows: [
                { tandem_id: "T01", match_status: "active", mentor_id: "M01" },
                { tandem_id: "T02", match_status: "active", mentor_id: "M02" },
                { tandem_id: "T03", match_status: "paused", mentor_id: "M03" },
              ],
            },
          ],
        },
      },
      {
        uploadMetadataId: "upload-meetings",
        privacySafeRepresentationId: "psr-meetings",
        logicalEvidenceId: "meetings",
        versionNumber: 1,
        originalFileName: "meetings.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "meetings",
              rows: [
                { tandem_id: "T01", meeting_id: "E01", duration_minutes: "60" },
                { tandem_id: "T01", meeting_id: "E02", duration_minutes: "45" },
                { tandem_id: "T02", meeting_id: "E03", duration_minutes: "30" },
                { tandem_id: "T04", meeting_id: "E04", duration_minutes: "50" },
              ],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const preparedTablesByResultId = new Map([
    [
      "result-matching",
      {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "matching",
            rowCount: 3,
            columnCount: 3,
            selectedRowGrain: "tandem record",
            identifierColumn: "tandem_id",
            identifierHandling: "assume_unique",
            primaryStatusColumn: "match_status",
            primaryDateColumn: null,
            columns: [
              {
                name: "tandem_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "match_status",
                inferredType: "categorical",
                role: "primary_status",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "mentor_id",
                inferredType: "identifier",
                role: "subgroup",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
    [
      "result-meetings",
      {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "meetings",
            rowCount: 4,
            columnCount: 3,
            selectedRowGrain: "meeting record",
            identifierColumn: "meeting_id",
            identifierHandling: "assume_unique",
            primaryStatusColumn: null,
            primaryDateColumn: null,
            columns: [
              {
                name: "tandem_id",
                inferredType: "identifier",
                role: "subgroup",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "meeting_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "duration_minutes",
                inferredType: "numeric",
                role: "measure",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
  ]);

  const fixture = createExecutorFixture({
    evidence,
    results: [
      { id: "result-matching", uploadMetadataId: "upload-matching" },
      { id: "result-meetings", uploadMetadataId: "upload-meetings" },
    ],
    preparedTablesByResultId,
  });

  const result = await fixture.executor.execute(
    [
      {
        toolName: "count_distinct_keys",
        arguments: {
          uploadMetadataId: "upload-meetings",
          tableName: "meetings",
          columnNames: ["tandem_id", "meeting_id"],
          useAnalysisRows: true,
        },
      },
      {
        toolName: "join_tables",
        alias: "matched_meetings",
        arguments: {
          left: {
            uploadMetadataId: "upload-matching",
            tableName: "matching",
            useAnalysisRows: true,
          },
          right: {
            uploadMetadataId: "upload-meetings",
            tableName: "meetings",
            useAnalysisRows: true,
          },
          keys: [{ leftColumnName: "tandem_id", rightColumnName: "tandem_id" }],
          leftPrefix: "match",
          rightPrefix: "meeting",
        },
      },
      {
        toolName: "count_rows",
        arguments: {
          resultAlias: "matched_meetings",
        },
      },
      {
        toolName: "anti_join",
        alias: "tandems_without_meetings",
        arguments: {
          left: {
            uploadMetadataId: "upload-matching",
            tableName: "matching",
            useAnalysisRows: true,
          },
          right: {
            uploadMetadataId: "upload-meetings",
            tableName: "meetings",
            useAnalysisRows: true,
          },
          keys: [{ leftColumnName: "tandem_id", rightColumnName: "tandem_id" }],
        },
      },
      {
        toolName: "count_rows",
        arguments: {
          resultAlias: "tandems_without_meetings",
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations[0]?.toolName, "count_distinct_keys");
  assert.equal(result.calculations[0]?.value, 4);
  assert.equal(result.calculations[1]?.toolName, "join_tables");
  assert.equal(result.calculations[1]?.value, 3);
  assert.deepEqual(result.calculations[1]?.result.rows, [
    {
      tandem_id: "T01",
      match_match_status: "active",
      match_mentor_id: "M01",
      meeting_meeting_id: "E01",
      meeting_duration_minutes: "60",
    },
    {
      tandem_id: "T01",
      match_match_status: "active",
      match_mentor_id: "M01",
      meeting_meeting_id: "E02",
      meeting_duration_minutes: "45",
    },
    {
      tandem_id: "T02",
      match_match_status: "active",
      match_mentor_id: "M02",
      meeting_meeting_id: "E03",
      meeting_duration_minutes: "30",
    },
  ]);
  assert.equal(result.calculations[2]?.value, 3);
  assert.equal(result.calculations[3]?.toolName, "anti_join");
  assert.equal(result.calculations[3]?.value, 1);
  assert.deepEqual(result.calculations[3]?.result.rows, [
    {
      tandem_id: "T03",
      match_status: "paused",
      mentor_id: "M03",
    },
  ]);
  assert.equal(result.calculations[4]?.value, 1);
});

test("derive_numeric_column, compare_columns, and scalar math support planned-vs-actual analysis", async () => {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-visits",
        privacySafeRepresentationId: "psr-visits",
        logicalEvidenceId: "visits",
        versionNumber: 1,
        originalFileName: "visits.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "visits",
              rows: [
                {
                  besuch_id: "V01",
                  geplante_plaetze: "10",
                  teilnehmende_tatsaechlich: "12",
                },
                {
                  besuch_id: "V02",
                  geplante_plaetze: "8",
                  teilnehmende_tatsaechlich: "6",
                },
                {
                  besuch_id: "V03",
                  geplante_plaetze: "12",
                  teilnehmende_tatsaechlich: "12",
                },
              ],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const preparedTablesByResultId = new Map([
    [
      "result-visits",
      {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "visits",
            rowCount: 3,
            columnCount: 3,
            selectedRowGrain: "visit record",
            identifierColumn: "besuch_id",
            identifierHandling: "assume_unique",
            primaryStatusColumn: null,
            primaryDateColumn: null,
            columns: [
              {
                name: "besuch_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "geplante_plaetze",
                inferredType: "numeric",
                role: "measure",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "teilnehmende_tatsaechlich",
                inferredType: "numeric",
                role: "measure",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
  ]);

  const fixture = createExecutorFixture({
    evidence,
    results: [{ id: "result-visits", uploadMetadataId: "upload-visits" }],
    preparedTablesByResultId,
  });

  const result = await fixture.executor.execute(
    [
      {
        toolName: "derive_numeric_column",
        alias: "visits_with_gap",
        arguments: {
          uploadMetadataId: "upload-visits",
          tableName: "visits",
          useAnalysisRows: true,
          leftColumnName: "teilnehmende_tatsaechlich",
          rightColumnName: "geplante_plaetze",
          operation: "subtract",
          outputColumnName: "attendance_gap",
        },
      },
      {
        toolName: "compare_columns",
        alias: "visits_capacity_check",
        arguments: {
          resultAlias: "visits_with_gap",
          leftColumnName: "teilnehmende_tatsaechlich",
          rightColumnName: "geplante_plaetze",
          comparison: "greater_than",
          outputColumnName: "over_capacity",
        },
      },
      {
        toolName: "count_rows",
        alias: "over_capacity_count",
        arguments: {
          resultAlias: "visits_capacity_check",
          filters: [
            {
              columnName: "over_capacity",
              operator: "equals",
              value: true,
            },
          ],
        },
      },
      {
        toolName: "aggregate_numeric",
        alias: "planned_total",
        arguments: {
          uploadMetadataId: "upload-visits",
          tableName: "visits",
          columnName: "geplante_plaetze",
          operation: "sum",
          useAnalysisRows: true,
        },
      },
      {
        toolName: "aggregate_numeric",
        alias: "actual_total",
        arguments: {
          uploadMetadataId: "upload-visits",
          tableName: "visits",
          columnName: "teilnehmende_tatsaechlich",
          operation: "sum",
          useAnalysisRows: true,
        },
      },
      {
        toolName: "calculate_difference",
        alias: "attendance_difference",
        arguments: {
          minuendAlias: "actual_total",
          subtrahendAlias: "planned_total",
        },
      },
      {
        toolName: "calculate_percent_change",
        alias: "attendance_percent_change",
        arguments: {
          baselineAlias: "planned_total",
          currentAlias: "actual_total",
        },
      },
      {
        toolName: "calculate_sum",
        arguments: {
          operandAliases: ["planned_total", "actual_total"],
        },
      },
      {
        toolName: "calculate_product",
        arguments: {
          operandAliases: ["planned_total", "actual_total"],
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.equal(result.calculations[0]?.toolName, "derive_numeric_column");
  assert.deepEqual(result.calculations[0]?.result.rows, [
    {
      besuch_id: "V01",
      geplante_plaetze: "10",
      teilnehmende_tatsaechlich: "12",
      attendance_gap: 2,
    },
    {
      besuch_id: "V02",
      geplante_plaetze: "8",
      teilnehmende_tatsaechlich: "6",
      attendance_gap: -2,
    },
    {
      besuch_id: "V03",
      geplante_plaetze: "12",
      teilnehmende_tatsaechlich: "12",
      attendance_gap: 0,
    },
  ]);
  assert.equal(result.calculations[1]?.toolName, "compare_columns");
  assert.deepEqual(result.calculations[1]?.result.rows, [
    {
      besuch_id: "V01",
      geplante_plaetze: "10",
      teilnehmende_tatsaechlich: "12",
      attendance_gap: 2,
      over_capacity: true,
    },
    {
      besuch_id: "V02",
      geplante_plaetze: "8",
      teilnehmende_tatsaechlich: "6",
      attendance_gap: -2,
      over_capacity: false,
    },
    {
      besuch_id: "V03",
      geplante_plaetze: "12",
      teilnehmende_tatsaechlich: "12",
      attendance_gap: 0,
      over_capacity: false,
    },
  ]);
  assert.equal(result.calculations[2]?.value, 1);
  assert.equal(result.calculations[3]?.value, 30);
  assert.equal(result.calculations[4]?.value, 30);
  assert.equal(result.calculations[5]?.value, 0);
  assert.equal(result.calculations[6]?.value, 0);
  assert.equal(result.calculations[7]?.value, 60);
  assert.equal(result.calculations[8]?.value, 900);
});

test("first_event, last_event, date_difference, and paired_change support temporal and paired analysis", async () => {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-temporal",
        privacySafeRepresentationId: "psr-temporal",
        logicalEvidenceId: "temporal-1",
        versionNumber: 1,
        originalFileName: "temporal.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "matching",
              rows: [
                { tandem_id: "T1", matching_date: "2026-01-01" },
                { tandem_id: "T2", matching_date: "2026-01-05" },
              ],
            },
            {
              name: "meetings",
              rows: [
                { tandem_id: "T1", meeting_date: "2026-01-10" },
                { tandem_id: "T1", meeting_date: "2026-01-14" },
                { tandem_id: "T2", meeting_date: "2026-01-20" },
                { tandem_id: "T2", meeting_date: "2026-01-18" },
              ],
            },
            {
              name: "surveys",
              rows: [
                { participant_id: "P1", pre_score: "2", post_score: "4" },
                { participant_id: "P2", pre_score: "4", post_score: "3" },
                { participant_id: "P3", pre_score: "3", post_score: "3" },
                { participant_id: "P4", pre_score: null, post_score: "5" },
              ],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const preparedTablesByResultId = new Map([
    [
      "result-temporal",
      {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "matching",
            rowCount: 2,
            columnCount: 2,
            selectedRowGrain: "tandem record",
            identifierColumn: "tandem_id",
            identifierHandling: "assume_unique",
            primaryStatusColumn: null,
            primaryDateColumn: "matching_date",
            columns: [
              {
                name: "tandem_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "matching_date",
                inferredType: "date",
                role: "primary_date",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
          {
            name: "meetings",
            rowCount: 4,
            columnCount: 2,
            selectedRowGrain: "meeting event",
            identifierColumn: null,
            identifierHandling: "assume_unique",
            primaryStatusColumn: null,
            primaryDateColumn: "meeting_date",
            columns: [
              {
                name: "tandem_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "meeting_date",
                inferredType: "date",
                role: "primary_date",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
          {
            name: "surveys",
            rowCount: 4,
            columnCount: 3,
            selectedRowGrain: "participant record",
            identifierColumn: "participant_id",
            identifierHandling: "assume_unique",
            primaryStatusColumn: null,
            primaryDateColumn: null,
            columns: [
              {
                name: "participant_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "pre_score",
                inferredType: "numeric",
                role: "measure",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "post_score",
                inferredType: "numeric",
                role: "measure",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
  ]);

  const fixture = createExecutorFixture({
    evidence,
    results: [{ id: "result-temporal", uploadMetadataId: "upload-temporal" }],
    preparedTablesByResultId,
  });

  const result = await fixture.executor.execute(
    [
      {
        toolName: "first_event",
        alias: "first_meetings",
        arguments: {
          uploadMetadataId: "upload-temporal",
          tableName: "meetings",
          entityColumnName: "tandem_id",
          dateColumnName: "meeting_date",
          outputDateColumnName: "first_meeting_date",
          useAnalysisRows: false,
        },
      },
      {
        toolName: "last_event",
        alias: "last_meetings",
        arguments: {
          uploadMetadataId: "upload-temporal",
          tableName: "meetings",
          entityColumnName: "tandem_id",
          dateColumnName: "meeting_date",
          outputDateColumnName: "last_meeting_date",
          useAnalysisRows: false,
        },
      },
      {
        toolName: "join_tables",
        alias: "matching_with_first",
        arguments: {
          left: {
            uploadMetadataId: "upload-temporal",
            tableName: "matching",
          },
          right: {
            resultAlias: "first_meetings",
          },
          keys: [{ leftColumnName: "tandem_id", rightColumnName: "tandem_id" }],
          leftPrefix: "matching",
          rightPrefix: "first",
        },
      },
      {
        toolName: "date_difference",
        alias: "days_to_first_meeting",
        arguments: {
          resultAlias: "matching_with_first",
          startDateColumnName: "matching_matching_date",
          endDateColumnName: "first_first_meeting_date",
          outputColumnName: "days_to_first",
          unit: "days",
        },
      },
      {
        toolName: "aggregate_numeric",
        alias: "avg_days_to_first_meeting",
        arguments: {
          resultAlias: "days_to_first_meeting",
          columnName: "days_to_first",
          operation: "avg",
        },
      },
      {
        toolName: "paired_change",
        alias: "confidence_change",
        arguments: {
          uploadMetadataId: "upload-temporal",
          tableName: "surveys",
          entityColumnName: "participant_id",
          preColumnName: "pre_score",
          postColumnName: "post_score",
          outputColumnName: "score_change",
          useAnalysisRows: true,
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.deepEqual(result.calculations[0]?.result.rows, [
    { tandem_id: "T1", first_meeting_date: "2026-01-10" },
    { tandem_id: "T2", first_meeting_date: "2026-01-18" },
  ]);
  assert.deepEqual(result.calculations[1]?.result.rows, [
    { tandem_id: "T1", last_meeting_date: "2026-01-14" },
    { tandem_id: "T2", last_meeting_date: "2026-01-20" },
  ]);
  assert.deepEqual(result.calculations[3]?.result.rows, [
    {
      tandem_id: "T1",
      matching_matching_date: "2026-01-01",
      first_first_meeting_date: "2026-01-10",
      days_to_first: 9,
    },
    {
      tandem_id: "T2",
      matching_matching_date: "2026-01-05",
      first_first_meeting_date: "2026-01-18",
      days_to_first: 13,
    },
  ]);
  assert.equal(result.calculations[4]?.value, 11);
  assert.equal(result.calculations[5]?.toolName, "paired_change");
  assert.equal(result.calculations[5]?.value, 3);
  assert.deepEqual(result.calculations[5]?.result.rows, [
    {
      participant_id: "P1",
      pre_score: "2",
      post_score: "4",
      score_change: 2,
    },
    {
      participant_id: "P2",
      pre_score: "4",
      post_score: "3",
      score_change: -1,
    },
    {
      participant_id: "P3",
      pre_score: "3",
      post_score: "3",
      score_change: 0,
    },
  ]);
  assert.equal(result.calculations[5]?.result.improvedCount, 1);
  assert.equal(result.calculations[5]?.result.unchangedCount, 1);
  assert.equal(result.calculations[5]?.result.worsenedCount, 1);
  assert.equal(result.calculations[5]?.result.meanPre, 3);
  assert.ok(
    Math.abs((result.calculations[5]?.result.meanPost as number) - 10 / 3) <
      1e-9,
  );
  assert.ok(
    Math.abs((result.calculations[5]?.result.meanChange as number) - 1 / 3) <
      1e-9,
  );
  assert.equal(result.calculations[5]?.result.medianChange, 0);
});

test("event_gap, days_since_last_event, and period_change support cadence, recency, and window comparison", async () => {
  const evidence: CurrentActivityEvidenceSnapshot = {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    evidence: [
      {
        uploadMetadataId: "upload-temporal-2",
        privacySafeRepresentationId: "psr-temporal-2",
        logicalEvidenceId: "temporal-2",
        versionNumber: 1,
        originalFileName: "meetings_extended.csv",
        evidenceModality: "structured_quantitative",
        uploadedAt: NOW,
        payload: {
          tables: [
            {
              name: "meetings",
              rows: [
                { tandem_id: "T1", meeting_date: "2026-01-10" },
                { tandem_id: "T1", meeting_date: "2026-01-14" },
                { tandem_id: "T1", meeting_date: "2026-01-25" },
                { tandem_id: "T2", meeting_date: "2026-01-18" },
                { tandem_id: "T2", meeting_date: "2026-01-20" },
                { tandem_id: "T3", meeting_date: "2026-01-22" },
              ],
            },
          ],
        },
      },
    ],
    missingPrivacySafeUploads: [],
  };

  const preparedTablesByResultId = new Map([
    [
      "result-temporal-2",
      {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "meetings",
            rowCount: 6,
            columnCount: 2,
            selectedRowGrain: "meeting event",
            identifierColumn: null,
            identifierHandling: "allow_duplicate_rows_as_events",
            primaryStatusColumn: null,
            primaryDateColumn: "meeting_date",
            columns: [
              {
                name: "tandem_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
              {
                name: "meeting_date",
                inferredType: "date",
                role: "primary_date",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    ],
  ]);

  const fixture = createExecutorFixture({
    evidence,
    results: [
      { id: "result-temporal-2", uploadMetadataId: "upload-temporal-2" },
    ],
    preparedTablesByResultId,
  });

  const result = await fixture.executor.execute(
    [
      {
        toolName: "event_gap",
        alias: "meeting_gaps",
        arguments: {
          uploadMetadataId: "upload-temporal-2",
          tableName: "meetings",
          entityColumnName: "tandem_id",
          dateColumnName: "meeting_date",
          outputColumnName: "max_gap_days",
        },
      },
      {
        toolName: "filter_result",
        alias: "long_gap_tandems",
        arguments: {
          resultAlias: "meeting_gaps",
          filters: [
            {
              columnName: "max_gap_days",
              operator: "greater_than",
              value: 7,
            },
          ],
        },
      },
      {
        toolName: "count_rows",
        alias: "long_gap_tandem_count",
        arguments: {
          resultAlias: "long_gap_tandems",
        },
      },
      {
        toolName: "days_since_last_event",
        alias: "meeting_recency",
        arguments: {
          uploadMetadataId: "upload-temporal-2",
          tableName: "meetings",
          entityColumnName: "tandem_id",
          dateColumnName: "meeting_date",
          outputColumnName: "days_since_last_meeting",
          outputDateColumnName: "last_meeting_date",
          referenceDate: "2026-02-01",
        },
      },
      {
        toolName: "period_change",
        alias: "meeting_period_change",
        arguments: {
          uploadMetadataId: "upload-temporal-2",
          tableName: "meetings",
          dateColumnName: "meeting_date",
          baselineStartDate: "2026-01-01",
          baselineEndDate: "2026-01-15",
          comparisonStartDate: "2026-01-16",
          comparisonEndDate: "2026-01-31",
        },
      },
      {
        toolName: "aggregate_numeric",
        alias: "meeting_period_percent_change",
        arguments: {
          resultAlias: "meeting_period_change",
          columnName: "percent_change",
          operation: "avg",
        },
      },
    ],
    fixture.evidence,
    {
      maxToolCalls: 12,
      maxLlmIterations: 4,
      timeoutMs: 30_000,
      maxEvidenceItems: 25,
    },
  );

  assert.deepEqual(result.calculations[0]?.result.rows, [
    { tandem_id: "T1", max_gap_days: 11 },
    { tandem_id: "T2", max_gap_days: 2 },
    { tandem_id: "T3", max_gap_days: null },
  ]);
  assert.equal(result.calculations[2]?.value, 1);
  assert.deepEqual(result.calculations[3]?.result.rows, [
    {
      tandem_id: "T1",
      days_since_last_meeting: 7,
      last_meeting_date: "2026-01-25",
    },
    {
      tandem_id: "T2",
      days_since_last_meeting: 12,
      last_meeting_date: "2026-01-20",
    },
    {
      tandem_id: "T3",
      days_since_last_meeting: 10,
      last_meeting_date: "2026-01-22",
    },
  ]);
  assert.deepEqual(result.calculations[4]?.result.rows, [
    {
      baseline_count: 2,
      comparison_count: 4,
      absolute_change: 2,
      percent_change: 1,
    },
  ]);
  assert.equal(result.calculations[4]?.result.baselineCount, 2);
  assert.equal(result.calculations[4]?.result.comparisonCount, 4);
  assert.equal(result.calculations[5]?.value, 1);
});
