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
