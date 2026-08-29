import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOutcomeEvidenceCandidateCatalog,
  buildOutcomeEvidenceCatalogColumnId,
  loadOutcomeEvidenceActivityTables,
  type OutcomeEvidenceCandidateCatalogDependencies,
} from "./outcomeEvidenceCandidateCatalogBuilder.js";

function column(name: string, epistemicRole: string | null) {
  return {
    name,
    inferredType: null,
    role: "measure" as const,
    positiveStatusValues: [],
    positiveStatusDefinitionText: null,
    normalizationAccepted: null,
    epistemicRole,
  };
}

function buildDeps(): OutcomeEvidenceCandidateCatalogDependencies {
  const uploads = [{ id: "upload-1", activityId: "activity-merged" }];
  const results = [{ id: "result-1", uploadMetadataId: "upload-1" }];
  const preparations = [
    {
      interpretationResultId: "result-1",
      status: "ready_for_analysis",
      preparedDataset: {
        isReadyForDeterministicAnalysis: true,
        tables: [
          {
            name: "wirkungsmessung",
            identifierColumn: "teilnehmer_id",
            cohortTag: "Jugendliche",
            columns: [
              column("teilnehmer_id", "identifier"),
              column("freitext_feedback", "free_text"),
              column("q3_selbstbild", "validated_scale"),
              column("besuchsgrund", null),
            ],
          },
        ],
      },
    },
  ];
  const privacySafeRepresentations = [
    {
      uploadMetadataId: "upload-1",
      payload: {
        tables: [
          {
            name: "wirkungsmessung",
            rows: [
              { teilnehmer_id: "t1", q3_selbstbild: "3", besuchsgrund: "a" },
              { teilnehmer_id: "t2", q3_selbstbild: "4", besuchsgrund: "b" },
            ],
          },
        ],
      },
    },
  ];

  return {
    uploadMetadataRepository: {
      listByActivity: async (activityId: string) =>
        uploads.filter((upload) => upload.activityId === activityId),
    },
    interpretationResultRepository: {
      findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
        results.filter((result) =>
          uploadMetadataIds.includes(result.uploadMetadataId),
        ),
    },
    datasetPreparationRepository: {
      findByInterpretationResultIds: async (
        interpretationResultIds: string[],
      ) =>
        preparations.filter((preparation) =>
          interpretationResultIds.includes(preparation.interpretationResultId),
        ),
    },
    privacySafeRepresentationRepository: {
      findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
        privacySafeRepresentations.filter((representation) =>
          uploadMetadataIds.includes(representation.uploadMetadataId),
        ),
    },
  } as unknown as OutcomeEvidenceCandidateCatalogDependencies;
}

test("excludes identifier and free_text columns, but keeps a column with no resolved epistemicRole", async () => {
  const catalog = await buildOutcomeEvidenceCandidateCatalog(
    buildDeps(),
    "activity-merged",
  );

  assert.deepEqual(catalog.map((entry) => entry.columnName).sort(), [
    "besuchsgrund",
    "q3_selbstbild",
  ]);
});

test("carries the table's declared identifierColumn and cohortTag onto every entry", async () => {
  const catalog = await buildOutcomeEvidenceCandidateCatalog(
    buildDeps(),
    "activity-merged",
  );

  for (const entry of catalog) {
    assert.equal(entry.identifierColumn, "teilnehmer_id");
    assert.equal(entry.cohortTag, "Jugendliche");
  }
});

test("humanizes the column name into a label and preserves epistemicRole/inferredType/distinctValueCount", async () => {
  const catalog = await buildOutcomeEvidenceCandidateCatalog(
    buildDeps(),
    "activity-merged",
  );

  const scaleEntry = catalog.find(
    (entry) => entry.columnName === "q3_selbstbild",
  );
  assert.ok(scaleEntry);
  assert.equal(scaleEntry?.label, "Q3 selbstbild");
  assert.equal(scaleEntry?.epistemicRole, "validated_scale");
  assert.equal(scaleEntry?.distinctValueCount, 2);
});

test("returns an empty catalog when the activity has no uploads", async () => {
  const deps = buildDeps();
  const catalog = await buildOutcomeEvidenceCandidateCatalog(
    deps,
    "activity-with-no-uploads",
  );

  assert.deepEqual(catalog, []);
});

test("assigns each catalog entry a short, unique, content-free columnId", async () => {
  const catalog = await buildOutcomeEvidenceCandidateCatalog(
    buildDeps(),
    "activity-merged",
  );

  assert.ok(catalog.length > 0);
  for (const entry of catalog) {
    // Never the column's own name/table/upload id embedded in the token —
    // that was the bug (see buildOutcomeEvidenceCatalogColumnId's comment):
    // a human-language column name in the id gave the LLM something it
    // could (and in production, reliably did) subtly reword when copying
    // it back, failing the exact-string grounding check on every
    // recommendation.
    assert.doesNotMatch(entry.columnId, /[|]/);
    assert.equal(entry.columnId, entry.columnId.trim());
  }

  const uniqueColumnIds = new Set(catalog.map((entry) => entry.columnId));
  assert.equal(uniqueColumnIds.size, catalog.length);
});

test("buildOutcomeEvidenceCatalogColumnId produces a short, position-based token", () => {
  assert.equal(buildOutcomeEvidenceCatalogColumnId(1), "col_1");
  assert.equal(buildOutcomeEvidenceCatalogColumnId(2), "col_2");
});

test("loadOutcomeEvidenceActivityTables surfaces hasDuplicateIdentifierValues at the table level", async () => {
  const [table] = await loadOutcomeEvidenceActivityTables(
    buildDeps(),
    "activity-merged",
  );

  assert.ok(table);
  assert.equal(table?.hasDuplicateIdentifierValues, false);
  assert.equal(table?.identifierColumn, "teilnehmer_id");
});
