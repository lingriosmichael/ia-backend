import assert from "node:assert/strict";
import test from "node:test";
import {
  canSafelyPairEvidenceTables,
  computeOutcomeEvidencePairingCandidates,
} from "./outcomeEvidencePairingCandidateMatcher.js";
import type { OutcomeEvidencePairingEvidenceTable } from "./outcomeEvidencePairingEvidenceLoader.js";

// Every validated_scale fixture column defaults to a 1-5 bound unless a
// test explicitly overrides it to exercise the scale-bounds-mismatch check
// — keeps the other, unrelated tests below from having to plumb bounds
// through individually. pairingGroupKey/pairingGroupRole must be set
// explicitly per test: unlike bounds, there's no sensible default for
// declared pairing identity — that's the entire point of this being a
// human-declared fact rather than an inferred one.
function column(
  name: string,
  epistemicRole: "validated_scale" | "categorical" | "identifier" | null,
  options?: {
    minValue?: number | null;
    maxValue?: number | null;
    pairingGroupKey?: string | null;
    pairingGroupRole?: "before" | "after" | null;
  },
) {
  const defaultBounds =
    epistemicRole === "validated_scale" ? { minValue: 1, maxValue: 5 } : null;
  return {
    name,
    inferredType: null,
    role: "measure" as const,
    positiveStatusValues: [],
    positiveStatusDefinitionText: null,
    normalizationAccepted: null,
    epistemicRole,
    minValue:
      options?.minValue !== undefined
        ? options.minValue
        : (defaultBounds?.minValue ?? null),
    maxValue:
      options?.maxValue !== undefined
        ? options.maxValue
        : (defaultBounds?.maxValue ?? null),
    pairingGroupKey: options?.pairingGroupKey ?? null,
    pairingGroupRole: options?.pairingGroupRole ?? null,
  };
}

test("proposes a cross-activity paired_delta for two validated_scale columns sharing a declared pairing group key with opposite roles", () => {
  // Mirrors this project's real Wirkungsmessung shape: baseline and
  // impact_measurement are two separate system activities, each with their
  // own upload, joined by a shared participant identifier. The column
  // names themselves are arbitrary and don't need to match at all — only
  // the declared pairingGroupKey does.
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: "baseline",
      uploadMetadataId: "upload-baseline",
      tableName: "wirkungsmessung_baseline",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("q3_selbstbild", "validated_scale", {
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-impact-measurement",
      activitySystemType: "impact_measurement",
      uploadMetadataId: "upload-abschluss",
      tableName: "wirkungsmessung_abschluss",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("frage_12", "validated_scale", {
          pairingGroupKey: "selbstwirksamkeit",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  const pairedDeltas = candidates.filter(
    (candidate) => candidate.shape === "paired_delta",
  );

  assert.equal(pairedDeltas.length, 1);
  const [only] = pairedDeltas;
  if (!only || only.shape !== "paired_delta") {
    throw new Error("expected one paired_delta candidate");
  }
  assert.equal(only.activityIdBefore, "activity-baseline");
  assert.equal(only.activityIdAfter, "activity-impact-measurement");
  assert.equal(only.beforeColumnName, "q3_selbstbild");
  assert.equal(only.afterColumnName, "frage_12");
  assert.equal(only.matchKey, "teilnehmer_id");
  assert.equal(only.pairingGroupKey, "Selbstwirksamkeit");
});

test("proposes a same-activity paired_delta for a single table's own declared before/after columns", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-workshop",
      activitySystemType: null,
      uploadMetadataId: "upload-workshop-feedback",
      tableName: "bewerbungstraining_feedback",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("frage_a", "validated_scale", {
          pairingGroupKey: "Kommunikationskompetenz",
          pairingGroupRole: "before",
        }),
        column("frage_b", "validated_scale", {
          pairingGroupKey: "Kommunikationskompetenz",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  const pairedDeltas = candidates.filter(
    (candidate) => candidate.shape === "paired_delta",
  );

  assert.equal(pairedDeltas.length, 1);
  const only = pairedDeltas[0];
  if (!only || only.shape !== "paired_delta") {
    throw new Error("expected one paired_delta candidate");
  }
  assert.equal(only.activityIdBefore, "activity-workshop");
  assert.equal(only.activityIdAfter, "activity-workshop");
  assert.equal(only.beforeColumnName, "frage_a");
  assert.equal(only.afterColumnName, "frage_b");
});

test("does not propose a pair when the two tables have different identifier columns", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: null,
      uploadMetadataId: "upload-baseline",
      tableName: "wirkungsmessung_baseline",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("selbstwirksamkeit_baseline", "validated_scale", {
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-impact-measurement",
      activitySystemType: null,
      uploadMetadataId: "upload-abschluss",
      tableName: "wirkungsmessung_abschluss",
      identifierColumn: "mentor_id",
      columns: [
        column("selbstwirksamkeit_abschluss", "validated_scale", {
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  assert.deepEqual(
    candidates.filter((candidate) => candidate.shape === "paired_delta"),
    [],
  );
});

test("proposes single_distribution for an unpaired categorical column, matching the naechster_schritt_art case", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-impact-measurement",
      activitySystemType: null,
      uploadMetadataId: "upload-abschluss",
      tableName: "wirkungsmessung_abschluss",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("naechster_schritt_art", "categorical"),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  assert.equal(candidates.length, 1);
  const [only] = candidates;
  assert.equal(only?.shape, "single_distribution");
  if (only?.shape === "single_distribution") {
    assert.equal(only.categoryColumnName, "naechster_schritt_art");
    assert.equal(only.activityId, "activity-impact-measurement");
  }
});

test("a categorical column already claimed by a paired_delta is not double-proposed as single_distribution", () => {
  // This can't happen for validated_scale columns (paired_delta only
  // claims validated_scale, single_distribution only considers
  // categorical), so this test documents that boundary rather than
  // asserting an overlap that the epistemicRole check already prevents.
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: null,
      uploadMetadataId: "upload-baseline",
      tableName: "wirkungsmessung_baseline",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("selbstwirksamkeit_baseline", "validated_scale", {
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-impact-measurement",
      activitySystemType: null,
      uploadMetadataId: "upload-abschluss",
      tableName: "wirkungsmessung_abschluss",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("selbstwirksamkeit_abschluss", "validated_scale", {
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.shape, "paired_delta");
});

test("does not pair a column with an arbitrary, non-conventionally-named column sharing a declared key but no declared role", () => {
  // The whole point of declared identity: an arbitrary column name with no
  // marker word, no naming convention at all, still pairs correctly as
  // long as both sides declared the same key — but a key alone without an
  // explicit before/after role is not enough.
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: null,
      uploadMetadataId: "upload-baseline",
      tableName: "t1",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("xyz123", "validated_scale", {
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: null,
        }),
      ],
    },
    {
      activityId: "activity-impact-measurement",
      activitySystemType: null,
      uploadMetadataId: "upload-abschluss",
      tableName: "t2",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("abc789", "validated_scale", {
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  assert.deepEqual(
    candidates.filter((candidate) => candidate.shape === "paired_delta"),
    [],
  );
});

test("does not pair two columns declaring the same role for the same key (two 'before' readings, no 'after')", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline-1",
      activitySystemType: null,
      uploadMetadataId: "upload-1",
      tableName: "t1",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("q1", "validated_scale", {
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-baseline-2",
      activitySystemType: null,
      uploadMetadataId: "upload-2",
      tableName: "t2",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("q2", "validated_scale", {
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: "before",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  assert.deepEqual(
    candidates.filter((candidate) => candidate.shape === "paired_delta"),
    [],
  );
});

test("does not pair columns declaring different pairing group keys", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: null,
      uploadMetadataId: "upload-baseline",
      tableName: "t1",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("q1", "validated_scale", {
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-impact-measurement",
      activitySystemType: null,
      uploadMetadataId: "upload-abschluss",
      tableName: "t2",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("q2", "validated_scale", {
          pairingGroupKey: "Berufliche Klarheit",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  assert.deepEqual(
    candidates.filter((candidate) => candidate.shape === "paired_delta"),
    [],
  );
});

test("pairing group key matching is case/whitespace-insensitive", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: null,
      uploadMetadataId: "upload-baseline",
      tableName: "t1",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("q1", "validated_scale", {
          pairingGroupKey: "  Wellbeing Scale ",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-impact-measurement",
      activitySystemType: null,
      uploadMetadataId: "upload-abschluss",
      tableName: "t2",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("q2", "validated_scale", {
          pairingGroupKey: "wellbeing scale",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  const pairedDeltas = candidates.filter(
    (candidate) => candidate.shape === "paired_delta",
  );
  assert.equal(pairedDeltas.length, 1);
});

test("does not pair via a declared key when the two tables have different identifier columns", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: "baseline",
      uploadMetadataId: "upload-baseline",
      tableName: "umfrage",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("q1", "validated_scale", {
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-impact-measurement",
      activitySystemType: "impact_measurement",
      uploadMetadataId: "upload-wirkungsmessung",
      tableName: "umfrage",
      identifierColumn: "mentor_id",
      columns: [
        column("q2", "validated_scale", {
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  assert.deepEqual(
    candidates.filter((candidate) => candidate.shape === "paired_delta"),
    [],
  );
});

test("does not cross-pair youth and mentor tables when their declared cohort tags differ, even with a matching pairing group key", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline-youth",
      activitySystemType: "baseline",
      uploadMetadataId: "upload-baseline-youth",
      tableName: "baseline_jugendliche",
      identifierColumn: "teilnehmer_id",
      cohortTag: "Jugendliche",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("q1", "validated_scale", {
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-baseline-mentor",
      activitySystemType: "baseline",
      uploadMetadataId: "upload-baseline-mentor",
      tableName: "baseline_mentorinnen",
      identifierColumn: "teilnehmer_id",
      cohortTag: "Mentor:innen",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("q1", "validated_scale", {
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-impact-youth",
      activitySystemType: "impact_measurement",
      uploadMetadataId: "upload-impact-youth",
      tableName: "abschluss_jugendliche",
      identifierColumn: "teilnehmer_id",
      cohortTag: "Jugendliche",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("q2", "validated_scale", {
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "after",
        }),
      ],
    },
    {
      activityId: "activity-impact-mentor",
      activitySystemType: "impact_measurement",
      uploadMetadataId: "upload-impact-mentor",
      tableName: "abschluss_mentorinnen",
      identifierColumn: "teilnehmer_id",
      cohortTag: "Mentor:innen",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("q2", "validated_scale", {
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  const pairedDeltas = candidates.filter(
    (candidate) => candidate.shape === "paired_delta",
  );

  assert.equal(pairedDeltas.length, 2);
  assert.deepEqual(
    pairedDeltas.map((candidate) => ({
      beforeUpload:
        candidate.shape === "paired_delta"
          ? candidate.beforeUploadMetadataId
          : null,
      afterUpload:
        candidate.shape === "paired_delta"
          ? candidate.afterUploadMetadataId
          : null,
    })),
    [
      {
        beforeUpload: "upload-baseline-youth",
        afterUpload: "upload-impact-youth",
      },
      {
        beforeUpload: "upload-baseline-mentor",
        afterUpload: "upload-impact-mentor",
      },
    ],
  );
});

test("canSafelyPairEvidenceTables tolerates casing/whitespace drift in the identifier column name", () => {
  const before: OutcomeEvidencePairingEvidenceTable = {
    activityId: "activity-baseline",
    activitySystemType: "baseline",
    uploadMetadataId: "upload-baseline",
    tableName: "umfrage",
    identifierColumn: "Teilnehmer_ID",
    columns: [],
  };
  const after: OutcomeEvidencePairingEvidenceTable = {
    activityId: "activity-impact-measurement",
    activitySystemType: "impact_measurement",
    uploadMetadataId: "upload-wirkungsmessung",
    tableName: "umfrage",
    identifierColumn: " teilnehmer_id ",
    columns: [],
  };

  assert.equal(canSafelyPairEvidenceTables(before, after), true);
});

test("canSafelyPairEvidenceTables rejects a table whose identifier column has duplicate values", () => {
  const before: OutcomeEvidencePairingEvidenceTable = {
    activityId: "activity-baseline",
    activitySystemType: "baseline",
    uploadMetadataId: "upload-baseline",
    tableName: "umfrage",
    identifierColumn: "teilnehmer_id",
    columns: [],
    hasDuplicateIdentifierValues: true,
  };
  const after: OutcomeEvidencePairingEvidenceTable = {
    activityId: "activity-impact-measurement",
    activitySystemType: "impact_measurement",
    uploadMetadataId: "upload-wirkungsmessung",
    tableName: "umfrage",
    identifierColumn: "teilnehmer_id",
    columns: [],
    hasDuplicateIdentifierValues: false,
  };

  assert.equal(canSafelyPairEvidenceTables(before, after), false);
});

test("canSafelyPairEvidenceTables rejects two tables with different declared cohort tags", () => {
  const before: OutcomeEvidencePairingEvidenceTable = {
    activityId: "activity-baseline",
    activitySystemType: "baseline",
    uploadMetadataId: "upload-baseline",
    tableName: "umfrage",
    identifierColumn: "teilnehmer_id",
    columns: [],
    cohortTag: "Jugendliche",
  };
  const after: OutcomeEvidencePairingEvidenceTable = {
    activityId: "activity-impact-measurement",
    activitySystemType: "impact_measurement",
    uploadMetadataId: "upload-wirkungsmessung",
    tableName: "umfrage",
    identifierColumn: "teilnehmer_id",
    columns: [],
    cohortTag: "Mentor:innen",
  };

  assert.equal(canSafelyPairEvidenceTables(before, after), false);
});

test("canSafelyPairEvidenceTables allows pairing when neither table has a declared cohort tag", () => {
  const before: OutcomeEvidencePairingEvidenceTable = {
    activityId: "activity-baseline",
    activitySystemType: "baseline",
    uploadMetadataId: "upload-baseline",
    tableName: "umfrage",
    identifierColumn: "teilnehmer_id",
    columns: [],
  };
  const after: OutcomeEvidencePairingEvidenceTable = {
    activityId: "activity-impact-measurement",
    activitySystemType: "impact_measurement",
    uploadMetadataId: "upload-wirkungsmessung",
    tableName: "umfrage",
    identifierColumn: "teilnehmer_id",
    columns: [],
  };

  assert.equal(canSafelyPairEvidenceTables(before, after), true);
});

test("does not pair two validated_scale columns whose observed numeric bounds don't match", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: "baseline",
      uploadMetadataId: "upload-baseline",
      tableName: "umfrage",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("q1", "validated_scale", {
          minValue: 1,
          maxValue: 5,
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-impact-measurement",
      activitySystemType: "impact_measurement",
      uploadMetadataId: "upload-wirkungsmessung",
      tableName: "umfrage",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("teilnehmer_id", "identifier"),
        // Same declared pairing group, but a different instrument's scale
        // (0-10 instead of 1-5) — must never be treated as a comparable
        // before/after pair.
        column("q2", "validated_scale", {
          minValue: 0,
          maxValue: 10,
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  assert.deepEqual(
    candidates.filter((candidate) => candidate.shape === "paired_delta"),
    [],
  );
});

test("does not pair two validated_scale columns when either side's bounds are unknown", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: "baseline",
      uploadMetadataId: "upload-baseline",
      tableName: "umfrage",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("q1", "validated_scale", {
          minValue: null,
          maxValue: null,
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-impact-measurement",
      activitySystemType: "impact_measurement",
      uploadMetadataId: "upload-wirkungsmessung",
      tableName: "umfrage",
      identifierColumn: "teilnehmer_id",
      columns: [
        column("teilnehmer_id", "identifier"),
        column("q2", "validated_scale", {
          minValue: 1,
          maxValue: 5,
          pairingGroupKey: "Wellbeing",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const candidates = computeOutcomeEvidencePairingCandidates(tables);
  assert.deepEqual(
    candidates.filter((candidate) => candidate.shape === "paired_delta"),
    [],
  );
});
