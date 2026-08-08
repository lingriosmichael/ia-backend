import type {
  ActivityEvidenceLinkageGroup,
  LinkageConflictCompetingValue,
  LinkageConflictRecord,
  LinkageCoverageDiffRecord,
  LinkageDuplicateRowRemoval,
  LinkageEntityFieldValue,
  LinkageEntityRecord,
  LinkagePositiveStatusFieldDefinition,
  LinkageSemanticAssessmentRecord,
  LinkageSemanticAssessmentOutcome,
  LinkageSemanticConcept,
  LinkageSemanticObservationRecord,
  LinkageSemanticSourceRole,
  PreparedDatasetColumn,
} from "../../shared/contracts.js";
import type { LinkageEvidenceTable } from "./linkageEvidenceLoader.js";
import {
  normalizeLinkageValue,
  type LinkageCandidate,
  type LinkageCandidateColumnReference,
} from "./linkageCandidateMatcher.js";

export type {
  ActivityEvidenceLinkageGroup,
  LinkageConflictCompetingValue,
  LinkageConflictRecord,
  LinkageCoverageDiffRecord,
  LinkageDuplicateRowRemoval,
  LinkageEntityFieldValue,
  LinkageEntityRecord,
  LinkagePositiveStatusFieldDefinition,
  LinkageSemanticAssessmentRecord,
} from "../../shared/contracts.js";

// Tier C (§4): a small, explicit per-value lookup table, not fuzzy string
// matching — collapses literal spellings of the same categorical value
// (`J` / `Ja` / `ja`) before any count/crosstab runs on that field. Extend
// this table as new dataset types surface new synonym sets; keep it a
// lookup, never a similarity model (per §12's "don't do" list).
const CATEGORICAL_VALUE_SYNONYMS: ReadonlyMap<string, string> = new Map([
  ["j", "ja"],
  ["ja", "ja"],
  ["y", "ja"],
  ["yes", "ja"],
  ["n", "nein"],
  ["nein", "nein"],
  ["no", "nein"],
]);

const CATEGORICAL_CANONICALIZATION_ROLES: ReadonlySet<
  PreparedDatasetColumn["role"]
> = new Set(["primary_status", "subgroup", "free_text", "other"]);

interface LinkageEntityRecordBuilder {
  entityKey: string;
  fieldObservationsByName: Map<string, LinkageEntityFieldValue[]>;
  sourceUploadMetadataIds: Set<string>;
}

function canonicalizeCategoricalValue(normalizedValue: string): string {
  return CATEGORICAL_VALUE_SYNONYMS.get(normalizedValue) ?? normalizedValue;
}

function canonicalizeRow(
  table: LinkageEvidenceTable,
  row: Record<string, unknown>,
): Map<string, string | null> {
  const values = new Map<string, string | null>();
  for (const column of table.columns) {
    const normalized = normalizeLinkageValue(row[column.name]);
    const canonicalized =
      normalized !== null && CATEGORICAL_CANONICALIZATION_ROLES.has(column.role)
        ? canonicalizeCategoricalValue(normalized)
        : normalized;
    values.set(column.name, canonicalized);
  }
  return values;
}

// Tier A (§4): same join-key value, byte-identical row content within one
// table — safe to auto-drop deterministically, no LLM, no ambiguity.
function dedupeExactRowsWithinTable(
  table: LinkageEvidenceTable,
  joinColumnName: string,
  canonicalRows: Array<Map<string, string | null>>,
): {
  keptRows: Array<Map<string, string | null>>;
  duplicatesRemoved: LinkageDuplicateRowRemoval[];
} {
  const seenSignaturesByEntityKey = new Map<string, Set<string>>();
  const removedCountByEntityKey = new Map<string, number>();
  const keptRows: Array<Map<string, string | null>> = [];

  for (const row of canonicalRows) {
    const entityKey = row.get(joinColumnName);
    if (entityKey === null || entityKey === undefined) {
      keptRows.push(row);
      continue;
    }

    const signature = JSON.stringify(
      Array.from(row.entries()).sort(([a], [b]) => a.localeCompare(b)),
    );
    const seenSignatures =
      seenSignaturesByEntityKey.get(entityKey) ?? new Set();
    if (seenSignatures.has(signature)) {
      removedCountByEntityKey.set(
        entityKey,
        (removedCountByEntityKey.get(entityKey) ?? 0) + 1,
      );
      continue;
    }

    seenSignatures.add(signature);
    seenSignaturesByEntityKey.set(entityKey, seenSignatures);
    keptRows.push(row);
  }

  const duplicatesRemoved: LinkageDuplicateRowRemoval[] = Array.from(
    removedCountByEntityKey.entries(),
  ).map(([entityKey, duplicateRowCount]) => ({
    uploadMetadataId: table.uploadMetadataId,
    tableName: table.tableName,
    entityKey,
    duplicateRowCount,
  }));

  return { keptRows, duplicatesRemoved };
}

function mergeRowIntoEntities(
  entitiesByKey: Map<string, LinkageEntityRecordBuilder>,
  table: LinkageEvidenceTable,
  entityKey: string,
  row: Map<string, string | null>,
): void {
  let entity = entitiesByKey.get(entityKey);
  if (!entity) {
    entity = {
      entityKey,
      fieldObservationsByName: new Map(),
      sourceUploadMetadataIds: new Set(),
    };
    entitiesByKey.set(entityKey, entity);
  }
  entity.sourceUploadMetadataIds.add(table.uploadMetadataId);

  for (const column of table.columns) {
    const value = row.get(column.name) ?? null;
    if (value === null) {
      continue;
    }

    const observations =
      entity.fieldObservationsByName.get(column.name) ?? [];
    const observation: LinkageEntityFieldValue = {
      fieldName: column.name,
      value,
      role: column.role,
      isPositiveStatusField: column.name === table.primaryStatusColumn,
      sourceUploadMetadataId: table.uploadMetadataId,
      sourceTableName: table.tableName,
    };
    if (
      observations.some(
        (existing) =>
          existing.value === observation.value &&
          existing.sourceUploadMetadataId === observation.sourceUploadMetadataId &&
          existing.sourceTableName === observation.sourceTableName,
      )
    ) {
      continue;
    }
    entity.fieldObservationsByName.set(column.name, [...observations, observation]);
  }
}

function normalizeSemanticToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/ü/g, "ue")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ß/g, "ss")
    .trim();
}

function inferSemanticConceptForFieldName(
  fieldName: string,
): LinkageSemanticConcept | null {
  const normalized = normalizeSemanticToken(fieldName);
  if (normalized === "empfehlung" || normalized === "recommendation") {
    return "suitability";
  }
  if (normalized === "concern_flag" || normalized === "safeguarding_check") {
    return "safeguarding";
  }
  return null;
}

function inferSemanticSourceRole(
  observation: Pick<
    LinkageEntityFieldValue,
    "fieldName" | "sourceTableName" | "sourceUploadMetadataId"
  >,
): LinkageSemanticSourceRole {
  const fieldName = normalizeSemanticToken(observation.fieldName);
  const tableName = normalizeSemanticToken(observation.sourceTableName);
  const uploadId = normalizeSemanticToken(observation.sourceUploadMetadataId);
  if (fieldName === "concern_flag" || tableName === "__concern_tagging__") {
    return "derived_signal";
  }
  if (
    tableName.includes("safeguarding") ||
    fieldName.includes("safeguarding")
  ) {
    return "follow_up";
  }
  if (
    tableName.includes("matrix") ||
    tableName.includes("auswahl") ||
    tableName.includes("selection") ||
    uploadId.includes("matrix") ||
    fieldName === "empfehlung"
  ) {
    return "assessment";
  }
  if (fieldName.includes("fuehrungszeugnis")) {
    return "administrative_record";
  }
  return "unknown";
}

function semanticSourceRolePriority(role: LinkageSemanticSourceRole): number {
  switch (role) {
    case "follow_up":
      return 4;
    case "assessment":
      return 3;
    case "administrative_record":
      return 2;
    case "derived_signal":
      return 1;
    default:
      return 0;
  }
}

interface SemanticStateResolution {
  stateKey: string;
  rank: number;
}

function classifySuitabilityState(
  value: string,
): SemanticStateResolution | null {
  const normalized = normalizeSemanticToken(value);
  if (
    normalized === "noch offen" ||
    normalized === "offen" ||
    normalized === "ausstehend" ||
    normalized === "pending" ||
    normalized === "in bearbeitung" ||
    normalized === "in pruefung" ||
    normalized === "unentschieden"
  ) {
    return { stateKey: "open", rank: 1 };
  }
  if (normalized === "bedingt") {
    return { stateKey: "conditional", rank: 2 };
  }
  if (normalized === "geeignet") {
    return { stateKey: "accepted", rank: 3 };
  }
  if (normalized === "nicht geeignet" || normalized === "abgelehnt") {
    return { stateKey: "rejected", rank: 3 };
  }
  return null;
}

function classifySafeguardingState(
  observation: Pick<LinkageEntityFieldValue, "fieldName" | "value">,
): SemanticStateResolution | null {
  const fieldName = normalizeSemanticToken(observation.fieldName);
  const normalizedValue = normalizeSemanticToken(observation.value);
  if (fieldName === "concern_flag") {
    if (normalizedValue === "yes" || normalizedValue === "ja") {
      return { stateKey: "identified", rank: 1 };
    }
    if (normalizedValue === "no" || normalizedValue === "nein") {
      return { stateKey: "clear", rank: 3 };
    }
    return null;
  }
  if (fieldName !== "safeguarding_check") {
    return null;
  }
  if (normalizedValue === "ok") {
    return { stateKey: "resolved", rank: 3 };
  }
  if (
    normalizedValue === "rueckfrage noetig" ||
    normalizedValue === "unbekannt" ||
    normalizedValue === "offen" ||
    normalizedValue === "ausstehend" ||
    normalizedValue === "pending"
  ) {
    return { stateKey: "pending_review", rank: 2 };
  }
  return null;
}

function classifySemanticState(
  concept: LinkageSemanticConcept,
  observation: LinkageEntityFieldValue,
): SemanticStateResolution | null {
  switch (concept) {
    case "suitability":
      return classifySuitabilityState(observation.value);
    case "safeguarding":
      return classifySafeguardingState(observation);
    default:
      return null;
  }
}

function toSemanticObservationRecord(
  observation: LinkageEntityFieldValue,
): LinkageSemanticObservationRecord {
  return {
    fieldName: observation.fieldName,
    value: observation.value,
    sourceUploadMetadataId: observation.sourceUploadMetadataId,
    sourceTableName: observation.sourceTableName,
    sourceRole: inferSemanticSourceRole(observation),
    observedAt: null,
    observedAtConfidence: "unknown",
  };
}

function chooseResolvedObservation(
  observations: LinkageEntityFieldValue[],
  stateByObservation: Map<LinkageEntityFieldValue, SemanticStateResolution>,
): LinkageEntityFieldValue {
  return [...observations].sort((left, right) => {
    const leftState = stateByObservation.get(left);
    const rightState = stateByObservation.get(right);
    const leftRank = leftState?.rank ?? -1;
    const rightRank = rightState?.rank ?? -1;
    if (rightRank !== leftRank) {
      return rightRank - leftRank;
    }
    const leftRoleRank = semanticSourceRolePriority(inferSemanticSourceRole(left));
    const rightRoleRank = semanticSourceRolePriority(
      inferSemanticSourceRole(right),
    );
    if (rightRoleRank !== leftRoleRank) {
      return rightRoleRank - leftRoleRank;
    }
    return left.sourceUploadMetadataId.localeCompare(right.sourceUploadMetadataId);
  })[0] as LinkageEntityFieldValue;
}

function buildConflictRecord(
  entityKey: string,
  fieldName: string,
  observations: LinkageEntityFieldValue[],
  resolvedValue: string,
): LinkageConflictRecord {
  const competingValues: LinkageConflictCompetingValue[] = observations.map(
    (observation) => ({
      value: observation.value,
      sourceUploadMetadataId: observation.sourceUploadMetadataId,
      sourceTableName: observation.sourceTableName,
    }),
  );
  return {
    entityKey,
    fieldName,
    competingValues,
    resolvedValue,
  };
}

function buildSemanticAssessmentRecord(
  entityKey: string,
  concept: LinkageSemanticConcept,
  outcome: LinkageSemanticAssessmentOutcome,
  resolvedValue: string | null,
  rationale: string,
  observations: LinkageEntityFieldValue[],
): LinkageSemanticAssessmentRecord {
  return {
    entityKey,
    concept,
    outcome,
    resolvedValue,
    rationale,
    observations: observations.map(toSemanticObservationRecord),
  };
}

function classifySuitabilityAssessmentOutcome(
  stateKeys: Set<string>,
): { outcome: LinkageSemanticAssessmentOutcome; rationale: string } | null {
  if (stateKeys.size === 1) {
    return { outcome: "consistent", rationale: "every linked source reports the same suitability state" };
  }
  if (stateKeys.has("accepted") && stateKeys.has("rejected")) {
    return {
      outcome: "true_conflict",
      rationale:
        "linked sources record incompatible terminal suitability decisions",
    };
  }
  const allowedProgressionStates = ["open", "conditional", "accepted", "rejected"];
  if ([...stateKeys].every((stateKey) => allowedProgressionStates.includes(stateKey))) {
    return {
      outcome: "progression",
      rationale:
        "linked sources show a suitability workflow moving from open review toward a later decision state",
    };
  }
  return {
    outcome: "insufficient_context",
    rationale:
      "linked suitability states differ, but the progression cannot be established safely",
  };
}

function classifySafeguardingAssessmentOutcome(
  stateKeys: Set<string>,
): { outcome: LinkageSemanticAssessmentOutcome; rationale: string } | null {
  if (stateKeys.size === 1) {
    return { outcome: "consistent", rationale: "every linked source reports the same safeguarding state" };
  }
  if (stateKeys.has("clear") && (stateKeys.has("identified") || stateKeys.has("pending_review"))) {
    return {
      outcome: "insufficient_context",
      rationale:
        "one source indicates no concern while another indicates an identified or unresolved safeguarding concern",
    };
  }
  if (
    (stateKeys.has("identified") || stateKeys.has("pending_review")) &&
    stateKeys.has("resolved")
  ) {
    return {
      outcome: "progression",
      rationale:
        "linked sources show a safeguarding workflow from identified concern or pending review toward resolution",
    };
  }
  if (stateKeys.has("identified") && stateKeys.has("pending_review")) {
    return {
      outcome: "progression",
      rationale:
        "linked sources show an identified safeguarding concern followed by documented follow-up",
    };
  }
  if (stateKeys.has("clear") && stateKeys.has("resolved")) {
    return {
      outcome: "consistent",
      rationale:
        "linked sources both indicate that no unresolved safeguarding concern remains",
    };
  }
  return {
    outcome: "insufficient_context",
    rationale:
      "linked safeguarding states differ, but no safe progression can be inferred",
  };
}

function classifySemanticAssessment(
  entityKey: string,
  concept: LinkageSemanticConcept,
  observations: LinkageEntityFieldValue[],
): LinkageSemanticAssessmentRecord | null {
  if (observations.length < 2) {
    return null;
  }
  const stateByObservation = new Map<LinkageEntityFieldValue, SemanticStateResolution>();
  for (const observation of observations) {
    const state = classifySemanticState(concept, observation);
    if (state) {
      stateByObservation.set(observation, state);
    }
  }
  if (stateByObservation.size < 2) {
    return null;
  }

  const stateKeys = new Set(
    [...stateByObservation.values()].map((state) => state.stateKey),
  );
  const classification =
    concept === "suitability"
      ? classifySuitabilityAssessmentOutcome(stateKeys)
      : concept === "safeguarding"
        ? classifySafeguardingAssessmentOutcome(stateKeys)
        : null;
  if (!classification) {
    return null;
  }

  const resolvedObservation = chooseResolvedObservation(
    observations,
    stateByObservation,
  );
  return buildSemanticAssessmentRecord(
    entityKey,
    concept,
    classification.outcome,
    resolvedObservation.value,
    classification.rationale,
    observations,
  );
}

function finalizeEntityField(
  entityKey: string,
  fieldName: string,
  observations: LinkageEntityFieldValue[],
): {
  resolvedField: LinkageEntityFieldValue;
  conflict: LinkageConflictRecord | null;
  semanticAssessments: LinkageSemanticAssessmentRecord[];
} {
  const concept = inferSemanticConceptForFieldName(fieldName);
  const semanticAssessment = concept
    ? classifySemanticAssessment(entityKey, concept, observations)
    : null;
  const hasDisagreement = new Set(observations.map((observation) => observation.value))
    .size > 1;

  if (!hasDisagreement) {
    return {
      resolvedField: observations[0] as LinkageEntityFieldValue,
      conflict: null,
      semanticAssessments: semanticAssessment ? [semanticAssessment] : [],
    };
  }

  if (
    semanticAssessment &&
    (semanticAssessment.outcome === "progression" ||
      semanticAssessment.outcome === "consistent" ||
      semanticAssessment.outcome === "superseded")
  ) {
    const resolvedObservation = observations.find(
      (observation) => observation.value === semanticAssessment.resolvedValue,
    ) ?? (observations[0] as LinkageEntityFieldValue);
    return {
      resolvedField: resolvedObservation,
      conflict: null,
      semanticAssessments: [semanticAssessment],
    };
  }

  const resolvedField = observations[0] as LinkageEntityFieldValue;
  return {
    resolvedField,
    conflict: buildConflictRecord(
      entityKey,
      fieldName,
      observations,
      resolvedField.value,
    ),
    semanticAssessments: semanticAssessment ? [semanticAssessment] : [],
  };
}

function buildCrossFieldSemanticAssessments(
  entityKey: string,
  fieldObservationsByName: ReadonlyMap<string, LinkageEntityFieldValue[]>,
): LinkageSemanticAssessmentRecord[] {
  const assessments: LinkageSemanticAssessmentRecord[] = [];
  const safeguardingObservations = Array.from(fieldObservationsByName.entries())
    .filter(([fieldName]) => inferSemanticConceptForFieldName(fieldName) === "safeguarding")
    .flatMap(([, observations]) => observations);

  const safeguardingFieldCount = new Set(
    safeguardingObservations.map((observation) => observation.fieldName),
  ).size;
  if (safeguardingFieldCount >= 2) {
    const assessment = classifySemanticAssessment(
      entityKey,
      "safeguarding",
      safeguardingObservations,
    );
    if (assessment) {
      assessments.push(assessment);
    }
  }

  return assessments;
}

function findConnectedComponents(candidates: LinkageCandidate[]): string[][] {
  const parent = new Map<string, string>();

  function find(node: string): string {
    if (!parent.has(node)) {
      parent.set(node, node);
    }
    let root = node;
    while (parent.get(root) !== root) {
      root = parent.get(root) as string;
    }
    parent.set(node, root);
    return root;
  }

  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  }

  for (const candidate of candidates) {
    union(candidate.uploadMetadataIdA, candidate.uploadMetadataIdB);
  }

  const componentsByRoot = new Map<string, Set<string>>();
  for (const node of parent.keys()) {
    const root = find(node);
    const members = componentsByRoot.get(root) ?? new Set<string>();
    members.add(node);
    componentsByRoot.set(root, members);
  }

  return Array.from(componentsByRoot.values()).map((members) =>
    Array.from(members),
  );
}

// For each upload+table in a linked component, resolves the single join
// column to use, by taking the most-referenced column name across every
// candidate touching that table (mode, ties broken alphabetically for
// determinism).
function resolveJoinColumnsForComponent(
  componentUploadIds: ReadonlySet<string>,
  candidates: LinkageCandidate[],
): Map<string, Map<string, string>> {
  const counts = new Map<string, Map<string, Map<string, number>>>();

  const record = (ref: LinkageCandidateColumnReference): void => {
    const byTable = counts.get(ref.uploadMetadataId) ?? new Map();
    const byColumn = byTable.get(ref.tableName) ?? new Map<string, number>();
    byColumn.set(ref.columnName, (byColumn.get(ref.columnName) ?? 0) + 1);
    byTable.set(ref.tableName, byColumn);
    counts.set(ref.uploadMetadataId, byTable);
  };

  for (const candidate of candidates) {
    if (
      !componentUploadIds.has(candidate.uploadMetadataIdA) ||
      !componentUploadIds.has(candidate.uploadMetadataIdB)
    ) {
      continue;
    }
    record(candidate.columnA);
    record(candidate.columnB);
  }

  const resolved = new Map<string, Map<string, string>>();
  for (const [uploadMetadataId, byTable] of counts) {
    const tableColumns = new Map<string, string>();
    for (const [tableName, byColumn] of byTable) {
      const ranked = Array.from(byColumn.entries()).sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return left[0].localeCompare(right[0]);
      });
      const best = ranked[0];
      if (best) {
        tableColumns.set(tableName, best[0]);
      }
    }
    resolved.set(uploadMetadataId, tableColumns);
  }
  return resolved;
}

function computeCoverageDiffs(
  uploadIds: string[],
  entityKeysByUpload: Map<string, Set<string>>,
): LinkageCoverageDiffRecord[] {
  const diffs: LinkageCoverageDiffRecord[] = [];

  for (let i = 0; i < uploadIds.length; i += 1) {
    for (let j = i + 1; j < uploadIds.length; j += 1) {
      const uploadMetadataIdA = uploadIds[i] as string;
      const uploadMetadataIdB = uploadIds[j] as string;
      const keysA = entityKeysByUpload.get(uploadMetadataIdA) ?? new Set();
      const keysB = entityKeysByUpload.get(uploadMetadataIdB) ?? new Set();
      const entityKeysOnlyInA = Array.from(keysA)
        .filter((key) => !keysB.has(key))
        .sort();
      const entityKeysOnlyInB = Array.from(keysB)
        .filter((key) => !keysA.has(key))
        .sort();

      if (entityKeysOnlyInA.length > 0 || entityKeysOnlyInB.length > 0) {
        diffs.push({
          uploadMetadataIdA,
          uploadMetadataIdB,
          entityKeysOnlyInA,
          entityKeysOnlyInB,
        });
      }
    }
  }

  return diffs;
}

function buildGroup(
  component: string[],
  tablesByUploadId: Map<string, LinkageEvidenceTable[]>,
  candidates: LinkageCandidate[],
): ActivityEvidenceLinkageGroup | null {
  const componentUploadIds = new Set(component);
  const joinColumnsByUpload = resolveJoinColumnsForComponent(
    componentUploadIds,
    candidates,
  );
  const sortedUploadIds = [...component].sort();

  const duplicateRowsRemoved: LinkageDuplicateRowRemoval[] = [];
  const entitiesByKey = new Map<string, LinkageEntityRecordBuilder>();
  const entityKeysByUpload = new Map<string, Set<string>>();
  const joinColumnNameCounts = new Map<string, number>();
  const positiveStatusFieldDefinitionsByFieldName = new Map<
    string,
    LinkagePositiveStatusFieldDefinition
  >();

  for (const uploadMetadataId of sortedUploadIds) {
    const tableColumns = joinColumnsByUpload.get(uploadMetadataId);
    if (!tableColumns) {
      continue;
    }

    const tables = (tablesByUploadId.get(uploadMetadataId) ?? [])
      .filter((table) => tableColumns.has(table.tableName))
      .sort((a, b) => a.tableName.localeCompare(b.tableName));

    for (const table of tables) {
      const joinColumnName = tableColumns.get(table.tableName);
      if (!joinColumnName) {
        continue;
      }
      joinColumnNameCounts.set(
        joinColumnName,
        (joinColumnNameCounts.get(joinColumnName) ?? 0) + 1,
      );

      // A table's own positiveStatusValues only ever describes its single
      // designated primaryStatusColumn, but a table can carry other
      // categorical/status-like columns (e.g. a safeguarding taxonomy that
      // isn't the table's main recommendation field) that independently
      // define their own positive value set on the column itself. Every
      // one of those is captured here, not just the table's designated
      // one — this is what lets computeCohortFlagPrevalences treat such a
      // field as "flagged means not one of these specific values" instead
      // of either missing it entirely or (isFlaggedValue's fallback)
      // wrongly treating every recorded value as flagged.
      for (const column of table.columns) {
        if (
          column.positiveStatusValues.length > 0 &&
          !positiveStatusFieldDefinitionsByFieldName.has(column.name)
        ) {
          positiveStatusFieldDefinitionsByFieldName.set(column.name, {
            fieldName: column.name,
            positiveStatusValues: column.positiveStatusValues,
            sourceUploadMetadataId: table.uploadMetadataId,
            sourceTableName: table.tableName,
          });
        }
      }

      const canonicalRows = table.rows.map((row) =>
        canonicalizeRow(table, row),
      );
      const { keptRows, duplicatesRemoved } = dedupeExactRowsWithinTable(
        table,
        joinColumnName,
        canonicalRows,
      );
      duplicateRowsRemoved.push(...duplicatesRemoved);

      const entityKeys =
        entityKeysByUpload.get(uploadMetadataId) ?? new Set<string>();
      for (const row of keptRows) {
        const entityKey = row.get(joinColumnName);
        if (entityKey === null || entityKey === undefined) {
          continue;
        }
        entityKeys.add(entityKey);
        mergeRowIntoEntities(entitiesByKey, table, entityKey, row);
      }
      entityKeysByUpload.set(uploadMetadataId, entityKeys);
    }
  }

  if (entitiesByKey.size === 0) {
    return null;
  }

  const rankedJoinColumnNames = Array.from(joinColumnNameCounts.entries()).sort(
    (left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    },
  );
  const joinKeyLabel = rankedJoinColumnNames[0]?.[0] ?? "unknown";

  const conflicts: LinkageConflictRecord[] = [];
  const semanticAssessments: LinkageSemanticAssessmentRecord[] = [];
  const entities: LinkageEntityRecord[] = Array.from(entitiesByKey.values())
    .sort((a, b) => a.entityKey.localeCompare(b.entityKey))
    .map((entity) => {
      const resolvedFields: LinkageEntityFieldValue[] = [];
      for (const [fieldName, observations] of entity.fieldObservationsByName) {
        const finalized = finalizeEntityField(
          entity.entityKey,
          fieldName,
          observations,
        );
        resolvedFields.push(finalized.resolvedField);
        if (finalized.conflict) {
          conflicts.push(finalized.conflict);
        }
        semanticAssessments.push(...finalized.semanticAssessments);
      }

      semanticAssessments.push(
        ...buildCrossFieldSemanticAssessments(
          entity.entityKey,
          entity.fieldObservationsByName,
        ),
      );

      return {
        entityKey: entity.entityKey,
        fields: resolvedFields,
        sourceUploadMetadataIds: Array.from(
          entity.sourceUploadMetadataIds,
        ).sort(),
      };
    });

  return {
    joinKeyLabel,
    linkedUploadMetadataIds: sortedUploadIds,
    entities,
    duplicateRowsRemoved,
    conflicts,
    semanticAssessments,
    coverageDiffs: computeCoverageDiffs(sortedUploadIds, entityKeysByUpload),
    positiveStatusFieldDefinitions: Array.from(
      positiveStatusFieldDefinitionsByFieldName.values(),
    ),
  };
}

/**
 * Pure computation (no I/O): builds one joined entity table per connected
 * group of linked uploads (§4 Tier A/B/C resolution + §6 joined entity
 * table). Uploads with no linkage candidate connecting them to anything
 * else are left out entirely — there is nothing to join.
 */
export function reconcileEvidenceLinkageGroups(
  tables: LinkageEvidenceTable[],
  candidates: LinkageCandidate[],
): ActivityEvidenceLinkageGroup[] {
  const components = findConnectedComponents(candidates).filter(
    (component) => component.length >= 2,
  );
  if (components.length === 0) {
    return [];
  }

  const tablesByUploadId = new Map<string, LinkageEvidenceTable[]>();
  for (const table of tables) {
    const existing = tablesByUploadId.get(table.uploadMetadataId) ?? [];
    tablesByUploadId.set(table.uploadMetadataId, [...existing, table]);
  }

  const groups: ActivityEvidenceLinkageGroup[] = [];
  for (const component of components) {
    const group = buildGroup(component, tablesByUploadId, candidates);
    if (group) {
      groups.push(group);
    }
  }
  return groups;
}
