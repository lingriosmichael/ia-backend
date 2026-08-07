import type {
  ActivityEvidenceLinkageGroup,
  LinkageEntityRecord,
} from "../../shared/contracts.js";
import type {
  ConcernTaggingEntityInput,
  ConcernTaggingResultOutput,
} from "../processing/pythonProcessingClient.js";

const CONCERN_FLAG_FIELD_NAME = "concern_flag";
const CONCERN_FLAG_REASON_FIELD_NAME = "concern_flag_reason";
// Never a real upload/table name, by construction — this is what lets
// computeCohortFlagPrevalences's "skip pairs from the same source table"
// guard never accidentally exclude this derived field from being
// cross-referenced against any real cohort field, from any real table.
const CONCERN_TAGGING_SOURCE_NAME = "__concern_tagging__";
const CONCERN_FLAGGED_VALUE = "yes";
const CONCERN_NOT_FLAGGED_VALUE = "no";

function collectFreeTextForEntity(entity: LinkageEntityRecord): string {
  return entity.fields
    .filter(
      (field) => field.role === "free_text" && field.value.trim().length > 0,
    )
    .map((field) => field.value.trim())
    .join("\n");
}

/**
 * One entity per record that actually has free-text content anywhere
 * across its linked sources — entities with nothing to classify are left
 * out rather than sent to the LLM with an empty string, matching the
 * "nothing to classify" short-circuit the concern-tagging endpoint itself
 * already applies to a fully empty request.
 */
export function buildConcernTaggingEntitiesForGroup(
  group: ActivityEvidenceLinkageGroup,
): ConcernTaggingEntityInput[] {
  const entities: ConcernTaggingEntityInput[] = [];
  for (const entity of group.entities) {
    const text = collectFreeTextForEntity(entity);
    if (text.length > 0) {
      entities.push({ entityKey: entity.entityKey, text });
    }
  }
  return entities;
}

/**
 * Attaches the tagging outcome onto each entity as if it were an
 * ordinary structured column — role "primary_status", with "no" as its
 * own captured positive value. This is what lets the existing, generic
 * cohort-flag-prevalence computation (linkageIndicatorCalculations.ts's
 * computeCohortFlagPrevalences) cross-reference it against any other
 * status field from any other linked file automatically, with no code
 * specific to this one derived field — the join is already generic;
 * this only needed to make the derived value look like a real column.
 */
export function applyConcernTaggingResults(
  group: ActivityEvidenceLinkageGroup,
  results: ConcernTaggingResultOutput[],
): ActivityEvidenceLinkageGroup {
  const resultByEntityKey = new Map(
    results.map((result) => [result.entityKey, result]),
  );
  if (resultByEntityKey.size === 0) {
    return group;
  }

  const entities = group.entities.map((entity) => {
    const result = resultByEntityKey.get(entity.entityKey);
    if (!result) {
      return entity;
    }

    const fields = [
      ...entity.fields,
      {
        fieldName: CONCERN_FLAG_FIELD_NAME,
        value: result.flagged
          ? CONCERN_FLAGGED_VALUE
          : CONCERN_NOT_FLAGGED_VALUE,
        role: "primary_status" as const,
        isPositiveStatusField: false,
        sourceUploadMetadataId: CONCERN_TAGGING_SOURCE_NAME,
        sourceTableName: CONCERN_TAGGING_SOURCE_NAME,
      },
    ];
    if (result.reason.trim().length > 0) {
      fields.push({
        fieldName: CONCERN_FLAG_REASON_FIELD_NAME,
        value: result.reason.trim(),
        role: "free_text" as const,
        isPositiveStatusField: false,
        sourceUploadMetadataId: CONCERN_TAGGING_SOURCE_NAME,
        sourceTableName: CONCERN_TAGGING_SOURCE_NAME,
      });
    }

    return { ...entity, fields };
  });

  const positiveStatusFieldDefinitions = [
    ...group.positiveStatusFieldDefinitions.filter(
      (definition) => definition.fieldName !== CONCERN_FLAG_FIELD_NAME,
    ),
    {
      fieldName: CONCERN_FLAG_FIELD_NAME,
      positiveStatusValues: [CONCERN_NOT_FLAGGED_VALUE],
      sourceUploadMetadataId: CONCERN_TAGGING_SOURCE_NAME,
      sourceTableName: CONCERN_TAGGING_SOURCE_NAME,
    },
  ];

  return { ...group, entities, positiveStatusFieldDefinitions };
}
