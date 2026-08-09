import assert from "node:assert/strict";
import test from "node:test";
import { computeLinkageCandidates } from "./linkageCandidateMatcher.js";
import { reconcileEvidenceLinkageGroups } from "./linkageEntityReconciler.js";
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

function buildFixtureTables(): LinkageEvidenceTable[] {
  const matrixColumns = [
    makeColumn("bewerbungs_id", "identifier"),
    makeColumn("empfehlung", "primary_status", ["geeignet"]),
    makeColumn("name", "free_text"),
  ];
  const matrixRows = [
    { bewerbungs_id: "B001", empfehlung: "geeignet", name: "Anna Berg" },
    {
      bewerbungs_id: "B002",
      empfehlung: "nicht geeignet",
      name: "Bernd Fischer",
    },
    { bewerbungs_id: "B003", empfehlung: "geeignet", name: "Yasmin Koch" },
    { bewerbungs_id: "B004", empfehlung: "geeignet", name: "Dieter Klein" },
    { bewerbungs_id: "B005", empfehlung: "nicht geeignet", name: "Erika Wolf" },
    // Exact duplicate of B001 — Tier A should drop this.
    { bewerbungs_id: "B001", empfehlung: "geeignet", name: "Anna Berg" },
  ];

  const safeguardingColumns = [
    makeColumn("bewerbungs_id", "identifier"),
    makeColumn("fuehrungszeugnis_status", "subgroup"),
    makeColumn("name", "free_text"),
  ];
  const safeguardingRows = [
    { bewerbungs_id: "B001", fuehrungszeugnis_status: "ja", name: "Anna Berg" },
    {
      bewerbungs_id: "B002",
      fuehrungszeugnis_status: "J",
      name: "Bernd Fischer",
    },
    // Byte-level truncation of the matrix's "Yasmin Koch" — Tier B conflict.
    {
      bewerbungs_id: "B003",
      fuehrungszeugnis_status: "nein",
      name: "Yasmin Koc",
    },
    {
      bewerbungs_id: "B004",
      fuehrungszeugnis_status: "ja",
      name: "Dieter Klein",
    },
    // Not present in the matrix at all.
    {
      bewerbungs_id: "B006",
      fuehrungszeugnis_status: "nein",
      name: "Frank Bauer",
    },
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

test("joins two linked uploads into one entity table, applying Tier A/B/C resolution", () => {
  const tables = buildFixtureTables();
  const candidates = computeLinkageCandidates(tables);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.matchBasis, "identifier_column");

  const groups = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.ok(group);

  assert.equal(group.joinKeyLabel, "bewerbungs_id");
  assert.deepEqual(group.linkedUploadMetadataIds, [
    "upload-csv",
    "upload-matrix",
  ]);

  // Tier A: the byte-identical duplicate of B001 in the matrix is dropped,
  // leaving 6 resolved entities (B001-B006), not 7 raw rows.
  assert.equal(group.entities.length, 6);
  assert.deepEqual(group.duplicateRowsRemoved, [
    {
      uploadMetadataId: "upload-matrix",
      tableName: "matrix",
      entityKey: "b001",
      duplicateRowCount: 1,
    },
  ]);

  // Tier B: "Yasmin Koch" vs "Yasmin Koc" on B003's name field is flagged,
  // never silently resolved. Uploads are merged in a fixed, deterministic
  // order (by uploadMetadataId), so "upload-csv" is seen before
  // "upload-matrix" and its value is the one kept as resolvedValue — but
  // both values survive in competingValues either way.
  assert.equal(group.conflicts.length, 1);
  const [conflict] = group.conflicts;
  assert.ok(conflict);
  assert.equal(conflict.entityKey, "b003");
  assert.equal(conflict.fieldName, "name");
  assert.equal(conflict.resolvedValue, "yasmin koc");
  assert.deepEqual(conflict.competingValues.map((v) => v.value).sort(), [
    "yasmin koc",
    "yasmin koch",
  ]);

  // Tier C: "ja" and "J" both canonicalize to "ja" on B001/B002 so a
  // downstream count is never fragmented into three literal spellings.
  const b001 = group.entities.find((entity) => entity.entityKey === "b001");
  const b002 = group.entities.find((entity) => entity.entityKey === "b002");
  assert.equal(
    b001?.fields.find((f) => f.fieldName === "fuehrungszeugnis_status")?.value,
    "ja",
  );
  assert.equal(
    b002?.fields.find((f) => f.fieldName === "fuehrungszeugnis_status")?.value,
    "ja",
  );

  // Coverage diff (§15.2 A): B005 only in the matrix, B006 only in the CSV.
  // Pairs are ordered alphabetically by uploadMetadataId ("upload-csv"
  // before "upload-matrix"), so A is the CSV and B is the matrix here.
  assert.equal(group.coverageDiffs.length, 1);
  const [diff] = group.coverageDiffs;
  assert.ok(diff);
  assert.equal(diff.uploadMetadataIdA, "upload-csv");
  assert.equal(diff.uploadMetadataIdB, "upload-matrix");
  assert.deepEqual(diff.entityKeysOnlyInA, ["b006"]);
  assert.deepEqual(diff.entityKeysOnlyInB, ["b005"]);

  // The primary-status role carries forward onto the joined field so
  // downstream indicator/coverage rules can find it without re-deriving it.
  const b003 = group.entities.find((entity) => entity.entityKey === "b003");
  const empfehlungField = b003?.fields.find(
    (f) => f.fieldName === "empfehlung",
  );
  assert.equal(empfehlungField?.isPositiveStatusField, true);
  assert.equal(empfehlungField?.value, "geeignet");

  // The manifest of positive-status fields (with their accepted positive
  // values) is carried at the group level, not duplicated onto every
  // entity, so indicator/coverage calculations can find it once.
  assert.deepEqual(group.positiveStatusFieldDefinitions, [
    {
      fieldName: "empfehlung",
      positiveStatusValues: ["geeignet"],
      sourceUploadMetadataId: "upload-matrix",
      sourceTableName: "matrix",
    },
  ]);
});

test("Tier B detection is exhaustive: every same-key, differing-value pair becomes its own conflict, not just the first one found", () => {
  // Five entities, each with the same join key present in both files but a
  // byte-different name spelling — the exact "5 Tier-B name conflicts"
  // shape reported against the real mentor-recruitment dataset, where only
  // 1 of 5 expected conflicts was surfacing in the generated summary. This
  // proves detection itself is not the bottleneck: every one of the 5
  // pairs below produces its own LinkageConflictRecord, unconditionally.
  const matrixColumns = [
    makeColumn("bewerbungs_id", "identifier"),
    makeColumn("name", "free_text"),
  ];
  const matrixRows = [
    { bewerbungs_id: "B001", name: "Anna Berg" },
    { bewerbungs_id: "B002", name: "Bernd Fischer" },
    { bewerbungs_id: "B003", name: "Yasmin Koch" },
    { bewerbungs_id: "B004", name: "Dieter Klein" },
    { bewerbungs_id: "B005", name: "Erika Wolf" },
  ];

  const safeguardingColumns = [
    makeColumn("bewerbungs_id", "identifier"),
    makeColumn("name", "free_text"),
  ];
  const safeguardingRows = [
    { bewerbungs_id: "B001", name: "Ana Berg" },
    { bewerbungs_id: "B002", name: "Bernd Fischer II" },
    { bewerbungs_id: "B003", name: "Yasmin Koc" },
    { bewerbungs_id: "B004", name: "Dieter Kleinn" },
    { bewerbungs_id: "B005", name: "Erika Wolff" },
  ];

  const tables: LinkageEvidenceTable[] = [
    {
      uploadMetadataId: "upload-matrix",
      tableName: "matrix",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: null,
      positiveStatusValues: [],
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

  const candidates = computeLinkageCandidates(tables);
  const [group] = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.ok(group);

  assert.equal(group.conflicts.length, 5);
  assert.deepEqual(
    group.conflicts.map((conflict) => conflict.entityKey).sort(),
    ["b001", "b002", "b003", "b004", "b005"],
  );
});

test("treats an open-to-suitable suitability update as progression rather than a conflict", () => {
  const tables: LinkageEvidenceTable[] = [
    {
      uploadMetadataId: "upload-intake",
      tableName: "intake",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: "empfehlung",
      positiveStatusValues: ["geeignet"],
      columns: [
        makeColumn("bewerbungs_id", "identifier"),
        makeColumn("empfehlung", "primary_status", ["geeignet"]),
      ],
      rows: [
        { bewerbungs_id: "B001", empfehlung: "noch offen" },
        { bewerbungs_id: "B002", empfehlung: "geeignet" },
        { bewerbungs_id: "B003", empfehlung: "geeignet" },
        { bewerbungs_id: "B004", empfehlung: "geeignet" },
        { bewerbungs_id: "B005", empfehlung: "geeignet" },
      ],
    },
    {
      uploadMetadataId: "upload-selection",
      tableName: "selection_matrix",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: "empfehlung",
      positiveStatusValues: ["geeignet"],
      columns: [
        makeColumn("bewerbungs_id", "identifier"),
        makeColumn("empfehlung", "primary_status", ["geeignet"]),
      ],
      rows: [
        { bewerbungs_id: "B001", empfehlung: "geeignet" },
        { bewerbungs_id: "B002", empfehlung: "geeignet" },
        { bewerbungs_id: "B003", empfehlung: "geeignet" },
        { bewerbungs_id: "B004", empfehlung: "geeignet" },
        { bewerbungs_id: "B005", empfehlung: "geeignet" },
      ],
    },
  ];

  const candidates = computeLinkageCandidates(tables);
  const [group] = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.ok(group);

  assert.deepEqual(group.conflicts, []);
  const assessment = group.semanticAssessments?.find(
    (candidate) =>
      candidate.entityKey === "b001" && candidate.concept === "suitability",
  );
  assert.ok(assessment);
  assert.equal(assessment.outcome, "progression");
  assert.equal(assessment.resolvedValue, "geeignet");
  assert.deepEqual(
    assessment.observations.map((observation) => observation.sourceRole).sort(),
    ["assessment", "assessment"],
  );

  const entity = group.entities.find(
    (candidate) => candidate.entityKey === "b001",
  );
  assert.equal(
    entity?.fields.find((field) => field.fieldName === "empfehlung")?.value,
    "geeignet",
  );
});

test("records safeguarding concern-to-ok evidence as progression across fields, not as a contradiction", () => {
  const tables: LinkageEvidenceTable[] = [
    {
      uploadMetadataId: "upload-concern",
      tableName: "__concern_tagging__",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: "concern_flag",
      positiveStatusValues: ["no"],
      columns: [
        makeColumn("bewerbungs_id", "identifier"),
        makeColumn("concern_flag", "primary_status", ["no"]),
      ],
      rows: [
        { bewerbungs_id: "B001", concern_flag: "yes" },
        { bewerbungs_id: "B002", concern_flag: "no" },
        { bewerbungs_id: "B003", concern_flag: "no" },
        { bewerbungs_id: "B004", concern_flag: "no" },
        { bewerbungs_id: "B005", concern_flag: "no" },
      ],
    },
    {
      uploadMetadataId: "upload-safeguarding",
      tableName: "safeguarding",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: "safeguarding_check",
      positiveStatusValues: ["ok"],
      columns: [
        makeColumn("bewerbungs_id", "identifier"),
        makeColumn("safeguarding_check", "primary_status", ["ok"]),
      ],
      rows: [
        { bewerbungs_id: "B001", safeguarding_check: "ok" },
        { bewerbungs_id: "B002", safeguarding_check: "ok" },
        { bewerbungs_id: "B003", safeguarding_check: "ok" },
        { bewerbungs_id: "B004", safeguarding_check: "ok" },
        { bewerbungs_id: "B005", safeguarding_check: "ok" },
      ],
    },
  ];

  const candidates = computeLinkageCandidates(tables);
  const [group] = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.ok(group);

  assert.deepEqual(group.conflicts, []);
  const assessment = group.semanticAssessments?.find(
    (candidate) =>
      candidate.entityKey === "b001" && candidate.concept === "safeguarding",
  );
  assert.ok(assessment);
  assert.equal(assessment.outcome, "progression");
  assert.equal(assessment.resolvedValue, "ok");
  assert.deepEqual(
    assessment.observations.map((observation) => observation.fieldName).sort(),
    ["concern_flag", "safeguarding_check"],
  );
});

test("keeps incompatible terminal suitability decisions as a true conflict when no safe progression exists", () => {
  const tables: LinkageEvidenceTable[] = [
    {
      uploadMetadataId: "upload-a",
      tableName: "matrix_a",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: "empfehlung",
      positiveStatusValues: ["geeignet"],
      columns: [
        makeColumn("bewerbungs_id", "identifier"),
        makeColumn("empfehlung", "primary_status", ["geeignet"]),
      ],
      rows: [
        { bewerbungs_id: "B001", empfehlung: "geeignet" },
        { bewerbungs_id: "B002", empfehlung: "geeignet" },
        { bewerbungs_id: "B003", empfehlung: "geeignet" },
        { bewerbungs_id: "B004", empfehlung: "geeignet" },
        { bewerbungs_id: "B005", empfehlung: "geeignet" },
      ],
    },
    {
      uploadMetadataId: "upload-b",
      tableName: "matrix_b",
      identifierColumn: "bewerbungs_id",
      primaryStatusColumn: "empfehlung",
      positiveStatusValues: ["geeignet"],
      columns: [
        makeColumn("bewerbungs_id", "identifier"),
        makeColumn("empfehlung", "primary_status", ["geeignet"]),
      ],
      rows: [
        { bewerbungs_id: "B001", empfehlung: "nicht geeignet" },
        { bewerbungs_id: "B002", empfehlung: "geeignet" },
        { bewerbungs_id: "B003", empfehlung: "geeignet" },
        { bewerbungs_id: "B004", empfehlung: "geeignet" },
        { bewerbungs_id: "B005", empfehlung: "geeignet" },
      ],
    },
  ];

  const candidates = computeLinkageCandidates(tables);
  const [group] = reconcileEvidenceLinkageGroups(tables, candidates);
  assert.ok(group);

  assert.equal(group.conflicts.length, 1);
  assert.equal(group.conflicts[0]?.fieldName, "empfehlung");
  const assessment = group.semanticAssessments?.find(
    (candidate) =>
      candidate.entityKey === "b001" && candidate.concept === "suitability",
  );
  assert.ok(assessment);
  assert.equal(assessment.outcome, "true_conflict");
});

test("returns no groups when no linkage candidate connects any uploads", () => {
  const tables: LinkageEvidenceTable[] = [
    {
      uploadMetadataId: "upload-a",
      tableName: "a",
      identifierColumn: "id",
      primaryStatusColumn: null,
      positiveStatusValues: [],
      columns: [makeColumn("id", "identifier")],
      rows: [{ id: "1" }, { id: "2" }, { id: "3" }],
    },
  ];

  const groups = reconcileEvidenceLinkageGroups(tables, []);
  assert.deepEqual(groups, []);
});
