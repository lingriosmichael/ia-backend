import assert from "node:assert/strict";
import test from "node:test";
import { computeLinkageCandidates } from "./linkageCandidateMatcher.js";
import { reconcileEvidenceLinkageGroups } from "./linkageEntityReconciler.js";
import {
  buildCrossFileCrosstabs,
  buildFieldDistributions,
  computeCohortFlagPrevalences,
  computeGoalGap,
  extractGoalTargetNumber,
} from "./linkageIndicatorCalculations.js";
import type { LinkageEvidenceTable } from "./linkageEvidenceLoader.js";
import type { PreparedDatasetColumn } from "../../shared/contracts.js";

function makeColumn(
  name: string,
  role: PreparedDatasetColumn["role"],
  positiveStatusValues: string[] = [],
): PreparedDatasetColumn {
  return {
    name,
    inferredType: role === "identifier" ? "identifier" : "categorical",
    role,
    positiveStatusValues,
    positiveStatusDefinitionText: null,
    normalizationAccepted: null,
    epistemicRole: null,
  };
}

function buildMentorFixture(): LinkageEvidenceTable[] {
  const matrixColumns = [
    makeColumn("bewerbungs_id", "identifier"),
    makeColumn("empfehlung", "primary_status", ["geeignet"]),
  ];
  const matrixRows = [
    { bewerbungs_id: "B001", empfehlung: "geeignet" },
    { bewerbungs_id: "B002", empfehlung: "nicht geeignet" },
    { bewerbungs_id: "B003", empfehlung: "geeignet" },
    { bewerbungs_id: "B004", empfehlung: "geeignet" },
    { bewerbungs_id: "B005", empfehlung: "nicht geeignet" },
  ];

  const safeguardingColumns = [
    makeColumn("bewerbungs_id", "identifier"),
    makeColumn("fuehrungszeugnis_status", "subgroup"),
  ];
  const safeguardingRows = [
    { bewerbungs_id: "B001", fuehrungszeugnis_status: "ja" },
    { bewerbungs_id: "B002", fuehrungszeugnis_status: "ja" },
    { bewerbungs_id: "B003", fuehrungszeugnis_status: "nein" },
    { bewerbungs_id: "B004", fuehrungszeugnis_status: "ja" },
    { bewerbungs_id: "B006", fuehrungszeugnis_status: "nein" },
  ];

  return [
    {
      uploadMetadataId: "upload-matrix",
      tableName: "matrix",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: "empfehlung",
      positiveStatusValues: ["geeignet"],
      columns: matrixColumns,
      rows: matrixRows,
    },
    {
      uploadMetadataId: "upload-csv",
      tableName: "safeguarding",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: null,
      positiveStatusValues: [],
      columns: safeguardingColumns,
      rows: safeguardingRows,
    },
  ];
}

function buildCoverageGapFixture(): LinkageEvidenceTable[] {
  const matrixColumns = [
    makeColumn("bewerbungs_id", "identifier"),
    makeColumn("empfehlung", "primary_status", ["geeignet"]),
  ];
  const matrixRows = [
    { bewerbungs_id: "B001", empfehlung: "geeignet" },
    { bewerbungs_id: "B002", empfehlung: "geeignet" },
    { bewerbungs_id: "B003", empfehlung: "geeignet" },
    { bewerbungs_id: "B004", empfehlung: "geeignet" },
    { bewerbungs_id: "B005", empfehlung: "geeignet" },
    { bewerbungs_id: "B006", empfehlung: "nicht geeignet" },
    { bewerbungs_id: "B007", empfehlung: "nicht geeignet" },
    { bewerbungs_id: "B008", empfehlung: "nicht geeignet" },
  ];

  const safeguardingColumns = [
    makeColumn("bewerbungs_id", "identifier"),
    makeColumn("remark", "free_text"),
  ];
  // Only 3 of the 5 "geeignet" candidates carry an unresolved remark.
  const safeguardingRows = [
    { bewerbungs_id: "B001", remark: "pending background check" },
    { bewerbungs_id: "B002", remark: "pending background check" },
    { bewerbungs_id: "B003", remark: "pending background check" },
    { bewerbungs_id: "B004", remark: "" },
    { bewerbungs_id: "B005", remark: "" },
    { bewerbungs_id: "B006", remark: "" },
    { bewerbungs_id: "B007", remark: "" },
    { bewerbungs_id: "B008", remark: "" },
  ];

  return [
    {
      uploadMetadataId: "upload-matrix",
      tableName: "matrix",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: "empfehlung",
      positiveStatusValues: ["geeignet"],
      columns: matrixColumns,
      rows: matrixRows,
    },
    {
      uploadMetadataId: "upload-csv",
      tableName: "safeguarding",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: null,
      positiveStatusValues: [],
      columns: safeguardingColumns,
      rows: safeguardingRows,
    },
  ];
}

test("builds a field distribution and a cross-file crosstab against the joined table", () => {
  const tables = buildMentorFixture();
  const candidates = computeLinkageCandidates(tables);
  const [group] = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.ok(group);

  const distributions = buildFieldDistributions(group.entities);
  const empfehlungDistribution = distributions.find(
    (d) => d.fieldName === "empfehlung",
  );
  assert.ok(empfehlungDistribution);
  assert.equal(empfehlungDistribution.totalEntityCount, 5);
  assert.deepEqual(empfehlungDistribution.buckets, [
    { value: "geeignet", count: 3, ratio: 3 / 5 },
    { value: "nicht geeignet", count: 2, ratio: 2 / 5 },
  ]);

  const crosstabs = buildCrossFileCrosstabs(group.entities);
  const crosstab = crosstabs.find(
    (c) =>
      (c.fieldNameA === "empfehlung" &&
        c.fieldNameB === "fuehrungszeugnis_status") ||
      (c.fieldNameB === "empfehlung" &&
        c.fieldNameA === "fuehrungszeugnis_status"),
  );
  assert.ok(crosstab);
  // Cross-table pair: entities missing either side (B005, B006) are
  // excluded from pairCount, matching only the 4 entities present in both.
  assert.equal(crosstab.pairCount, 4);
  assert.equal(crosstab.sourceTableNameA !== crosstab.sourceTableNameB, true);
});

test("computes the cohort-conditional flag-prevalence ratio behind the coverage-gap rule", () => {
  const tables = buildCoverageGapFixture();
  const candidates = computeLinkageCandidates(tables);
  const [group] = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.ok(group);

  const prevalences = computeCohortFlagPrevalences(
    group.entities,
    group.positiveStatusFieldDefinitions,
  );
  assert.equal(prevalences.length, 1);
  const [prevalence] = prevalences;
  assert.ok(prevalence);
  assert.equal(prevalence.cohortFieldName, "empfehlung");
  assert.equal(prevalence.flagFieldName, "remark");
  assert.equal(prevalence.cohortSize, 5);
  assert.equal(prevalence.flaggedCount, 3);
  assert.equal(prevalence.ratio, 0.6);
  assert.deepEqual(prevalence.flaggedEntityKeys, ["b001", "b002", "b003"]);
});

test("extractGoalTargetNumber parses a numeric target out of free-text goal wording", () => {
  assert.equal(extractGoalTargetNumber("Mindestens 70 Bewerbungen"), 70);
  assert.equal(extractGoalTargetNumber("65 geeignete Mentor:innen"), 65);
  assert.equal(extractGoalTargetNumber("no number in here"), null);
});

test("computeGoalGap grounds a numeric goal verdict in the actual count", () => {
  const achieved = computeGoalGap("65 geeignete Mentor:innen", 70);
  assert.ok(achieved);
  assert.equal(achieved.verdict, "achieved");
  assert.equal(achieved.delta, 5);

  const partial = computeGoalGap("65 geeignete Mentor:innen", 40);
  assert.ok(partial);
  assert.equal(partial.verdict, "partly_achieved");

  const notAchieved = computeGoalGap("65 geeignete Mentor:innen", 20);
  assert.ok(notAchieved);
  assert.equal(notAchieved.verdict, "not_achieved");

  assert.equal(computeGoalGap("no target stated", 20), null);
});

function buildStructuredSafeguardingFixture(): LinkageEvidenceTable[] {
  const matrixColumns = [
    makeColumn("bewerbungs_id", "identifier"),
    makeColumn("empfehlung", "primary_status", ["geeignet"]),
  ];
  const matrixRows = [
    { bewerbungs_id: "B001", empfehlung: "geeignet" },
    { bewerbungs_id: "B002", empfehlung: "geeignet" },
    { bewerbungs_id: "B003", empfehlung: "geeignet" },
    { bewerbungs_id: "B004", empfehlung: "geeignet" },
    { bewerbungs_id: "B005", empfehlung: "geeignet" },
  ];

  // A structured status column (not free text) — role "primary_status"
  // with its own captured positive value ("ok"). Only "unbekannt"/
  // "rueckfrage noetig" should count as flagged, not "ok".
  const safeguardingColumns = [
    makeColumn("bewerbungs_id", "identifier"),
    makeColumn("safeguarding_check", "primary_status", ["ok"]),
  ];
  const safeguardingRows = [
    { bewerbungs_id: "B001", safeguarding_check: "ok" },
    { bewerbungs_id: "B002", safeguarding_check: "unbekannt" },
    { bewerbungs_id: "B003", safeguarding_check: "rueckfrage noetig" },
    { bewerbungs_id: "B004", safeguarding_check: "ok" },
    { bewerbungs_id: "B005", safeguarding_check: "unbekannt" },
  ];

  return [
    {
      uploadMetadataId: "upload-matrix",
      tableName: "matrix",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: "empfehlung",
      positiveStatusValues: ["geeignet"],
      columns: matrixColumns,
      rows: matrixRows,
    },
    {
      uploadMetadataId: "upload-safeguarding",
      tableName: "safeguarding",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: "safeguarding_check",
      positiveStatusValues: ["ok"],
      columns: safeguardingColumns,
      rows: safeguardingRows,
    },
  ];
}

test("a structured status flag field (not free text) is only flagged for its own non-positive values, not any recorded value", () => {
  const tables = buildStructuredSafeguardingFixture();
  const candidates = computeLinkageCandidates(tables);
  const [group] = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.ok(group);

  const prevalences = computeCohortFlagPrevalences(
    group.entities,
    group.positiveStatusFieldDefinitions,
  );
  const prevalence = prevalences.find(
    (candidate) => candidate.flagFieldName === "safeguarding_check",
  );
  assert.ok(prevalence);
  assert.equal(prevalence.cohortFieldName, "empfehlung");
  assert.equal(prevalence.cohortSize, 5);
  // 3 of 5: B002, B003, B005 (unbekannt / rueckfrage noetig) — B001 and
  // B004 ("ok") must not count, even though they have a recorded value.
  assert.equal(prevalence.flaggedCount, 3);
  assert.deepEqual(prevalence.flaggedEntityKeys, ["b002", "b003", "b005"]);
});

test("a structured status flag field with no captured positive-value definition falls back to any-recorded-value", () => {
  // Same shape, but the safeguarding_check column itself never declared a
  // positiveStatusValues set (on the table or the column) — there is no
  // known "ok"-equivalent anywhere, so presence is the only signal left.
  const tables = buildStructuredSafeguardingFixture();
  const safeguardingTable = tables[1];
  assert.ok(safeguardingTable);
  safeguardingTable.primaryStatusColumn = null;
  safeguardingTable.positiveStatusValues = [];
  const safeguardingCheckColumn = safeguardingTable.columns.find(
    (column) => column.name === "safeguarding_check",
  );
  assert.ok(safeguardingCheckColumn);
  safeguardingCheckColumn.positiveStatusValues = [];

  const candidates = computeLinkageCandidates(tables);
  const [group] = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.ok(group);

  const prevalences = computeCohortFlagPrevalences(
    group.entities,
    group.positiveStatusFieldDefinitions,
  );
  const prevalence = prevalences.find(
    (candidate) => candidate.flagFieldName === "safeguarding_check",
  );
  assert.ok(prevalence);
  assert.equal(prevalence.flaggedCount, 5);
});

test("a status field that is not its table's designated primary_status column still joins against the cohort, as long as it has its own positive-value definition", () => {
  // The reported gap: safeguarding_check is rarely the table's one
  // designated primary_status column (empfehlung already is, for the same
  // table's own recommendation field) — it's a "subgroup" categorical
  // column that nonetheless defines its own positive value ("ok"). Before
  // this fix, only a table's single designated primary_status column ever
  // reached positiveStatusFieldDefinitions, so this cohort join never ran
  // at all for a field shaped exactly like this.
  const tables = buildStructuredSafeguardingFixture();
  const safeguardingTable = tables[1];
  assert.ok(safeguardingTable);
  // Nothing on this table is "the" primary status column, but the column
  // itself still carries its own positiveStatusValues.
  safeguardingTable.primaryStatusColumn = null;
  safeguardingTable.positiveStatusValues = [];
  const safeguardingCheckColumn = safeguardingTable.columns.find(
    (column) => column.name === "safeguarding_check",
  );
  assert.ok(safeguardingCheckColumn);
  safeguardingCheckColumn.role = "subgroup";

  const candidates = computeLinkageCandidates(tables);
  const [group] = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.ok(group);

  assert.deepEqual(group.positiveStatusFieldDefinitions, [
    {
      fieldName: "empfehlung",
      positiveStatusValues: ["geeignet"],
      sourceUploadMetadataId: "upload-matrix",
      sourceTableName: "matrix",
    },
    {
      fieldName: "safeguarding_check",
      positiveStatusValues: ["ok"],
      sourceUploadMetadataId: "upload-safeguarding",
      sourceTableName: "safeguarding",
    },
  ]);

  const prevalences = computeCohortFlagPrevalences(
    group.entities,
    group.positiveStatusFieldDefinitions,
  );
  const prevalence = prevalences.find(
    (candidate) => candidate.flagFieldName === "safeguarding_check",
  );
  assert.ok(prevalence);
  assert.equal(prevalence.cohortFieldName, "empfehlung");
  assert.equal(prevalence.cohortSize, 5);
  // Still only the genuinely unresolved values, exactly as when
  // safeguarding_check was its own table's primary_status column.
  assert.equal(prevalence.flaggedCount, 3);
  assert.deepEqual(prevalence.flaggedEntityKeys, ["b002", "b003", "b005"]);
});

test("computes every genuine cohort x flag pairing, never silently dropping the ones past an arbitrary count", () => {
  // Regression test: this function used to stop after the first 8 pairs
  // found. Once every column's own positive-value definition started
  // being captured (not just one per table), the candidate space grew
  // enough that a real safeguarding cohort join could sort past that cap
  // and disappear entirely from a generated summary. Three tables, each
  // with its own decision field (itself a valid flag-field candidate too,
  // being primary_status) and two free-text flag fields, produce 18
  // genuine cross-table pairs (3 decisions x 6 valid flag-field
  // candidates each out of 9 total, since a decision never pairs with a
  // field from its own table) — well past the old cap of 8.
  const makeTable = (
    tableName: string,
    decisionColumnName: string,
    flagColumnNames: [string, string],
  ): LinkageEvidenceTable => ({
    uploadMetadataId: `upload-${tableName}`,
    tableName,
    identifierColumn: "id",
    primaryStatusColumn: decisionColumnName,
    positiveStatusValues: ["active"],
    columns: [
      makeColumn("id", "identifier"),
      makeColumn(decisionColumnName, "primary_status", ["active"]),
      makeColumn(flagColumnNames[0], "free_text"),
      makeColumn(flagColumnNames[1], "free_text"),
    ],
    // The join-key column needs at least 3 distinct, overlapping values
    // across tables before linkageCandidateMatcher.ts treats it as a
    // linkage candidate at all — one row per table isn't enough signal.
    // "active" (not "yes"/"ja") deliberately avoids Tier C's
    // CATEGORICAL_VALUE_SYNONYMS canonicalization, which would otherwise
    // rewrite the stored value and make it never match this declared
    // positive value.
    rows: ["1", "2", "3"].map((id) => ({
      id,
      [decisionColumnName]: "active",
      [flagColumnNames[0]]: "note",
      [flagColumnNames[1]]: "note",
    })),
  });

  const tables: LinkageEvidenceTable[] = [
    makeTable("table-a", "decisionA", ["flagA1", "flagA2"]),
    makeTable("table-b", "decisionB", ["flagB1", "flagB2"]),
    makeTable("table-c", "decisionC", ["flagC1", "flagC2"]),
  ];

  const candidates = computeLinkageCandidates(tables);
  const [group] = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.ok(group);

  const prevalences = computeCohortFlagPrevalences(
    group.entities,
    group.positiveStatusFieldDefinitions,
  );

  assert.equal(prevalences.length, 18);
  // The free-text flag fields (no positive-value definition of their own)
  // are flagged for every entity that recorded any value at all.
  const freeTextFlagPairs = prevalences.filter((prevalence) =>
    prevalence.flagFieldName.startsWith("flag"),
  );
  assert.equal(freeTextFlagPairs.length, 12);
  assert.ok(
    freeTextFlagPairs.every((prevalence) => prevalence.flaggedCount === 3),
  );
});
