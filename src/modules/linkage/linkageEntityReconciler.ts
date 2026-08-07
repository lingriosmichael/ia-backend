import type {
  ActivityEvidenceLinkageGroup,
  LinkageConflictCompetingValue,
  LinkageConflictRecord,
  LinkageCoverageDiffRecord,
  LinkageDuplicateRowRemoval,
  LinkageEntityFieldValue,
  LinkageEntityRecord,
  LinkagePositiveStatusFieldDefinition,
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
  fields: Map<string, LinkageEntityFieldValue>;
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

// Tier B (§4): same entity, same field name, disagreeing values across
// sources. Never silently resolved — the first value encountered (in a
// fixed, deterministic table order) is kept, and every competing value is
// recorded, not dropped.
function mergeRowIntoEntities(
  entitiesByKey: Map<string, LinkageEntityRecordBuilder>,
  conflicts: LinkageConflictRecord[],
  table: LinkageEvidenceTable,
  entityKey: string,
  row: Map<string, string | null>,
): void {
  let entity = entitiesByKey.get(entityKey);
  if (!entity) {
    entity = {
      entityKey,
      fields: new Map(),
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

    const existing = entity.fields.get(column.name);
    if (!existing) {
      entity.fields.set(column.name, {
        fieldName: column.name,
        value,
        role: column.role,
        isPositiveStatusField: column.name === table.primaryStatusColumn,
        sourceUploadMetadataId: table.uploadMetadataId,
        sourceTableName: table.tableName,
      });
      continue;
    }

    if (existing.value === value) {
      continue;
    }

    const conflict = conflicts.find(
      (candidate) =>
        candidate.entityKey === entityKey &&
        candidate.fieldName === column.name,
    );
    const competingValue: LinkageConflictCompetingValue = {
      value,
      sourceUploadMetadataId: table.uploadMetadataId,
      sourceTableName: table.tableName,
    };
    if (conflict) {
      if (
        !conflict.competingValues.some(
          (existingValue) =>
            existingValue.value === value &&
            existingValue.sourceUploadMetadataId === table.uploadMetadataId &&
            existingValue.sourceTableName === table.tableName,
        )
      ) {
        conflict.competingValues.push(competingValue);
      }
      continue;
    }

    conflicts.push({
      entityKey,
      fieldName: column.name,
      competingValues: [
        {
          value: existing.value,
          sourceUploadMetadataId: existing.sourceUploadMetadataId,
          sourceTableName: existing.sourceTableName,
        },
        competingValue,
      ],
      resolvedValue: existing.value,
    });
  }
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
  const conflicts: LinkageConflictRecord[] = [];
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
        mergeRowIntoEntities(entitiesByKey, conflicts, table, entityKey, row);
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

  const entities: LinkageEntityRecord[] = Array.from(entitiesByKey.values())
    .sort((a, b) => a.entityKey.localeCompare(b.entityKey))
    .map((entity) => ({
      entityKey: entity.entityKey,
      fields: Array.from(entity.fields.values()),
      sourceUploadMetadataIds: Array.from(
        entity.sourceUploadMetadataIds,
      ).sort(),
    }));

  return {
    joinKeyLabel,
    linkedUploadMetadataIds: sortedUploadIds,
    entities,
    duplicateRowsRemoved,
    conflicts,
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
