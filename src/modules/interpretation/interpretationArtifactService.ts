import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  IndicatorRelevanceStage,
  InterpretationQuestionKind,
  InterpretationWarningSeverity,
  ProcessingJobStatus,
} from "../../shared/contracts.js";
import { indicatorRelevanceStageValues } from "../../shared/contracts.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ProcessingJobPersistenceRecord } from "../ai/persistence/aiPersistenceTypes.js";
import type {
  InterpretationEntityCreateInput,
  InterpretationGoalCoverageCreateInput,
  InterpretationIndicatorCreateInput,
  InterpretationQuestionCreateInput,
  InterpretationRelationshipCreateInput,
  InterpretationWarningCreateInput,
} from "./interpretationResultPersistence.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";

type ProcessingStatusDetails = Record<string, unknown> | null | undefined;

const interpretationQuestionKinds: readonly InterpretationQuestionKind[] = [
  "single_choice",
  "free_text",
  "merge_confirmation",
];

const interpretationWarningSeverities: readonly InterpretationWarningSeverity[] =
  ["info", "warning"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readQuestionKind(value: unknown): InterpretationQuestionKind {
  return interpretationQuestionKinds.includes(
    value as InterpretationQuestionKind,
  )
    ? (value as InterpretationQuestionKind)
    : "free_text";
}

function readWarningSeverity(value: unknown): InterpretationWarningSeverity {
  return interpretationWarningSeverities.includes(
    value as InterpretationWarningSeverity,
  )
    ? (value as InterpretationWarningSeverity)
    : "info";
}

function readIndicatorRelevanceStage(
  value: unknown,
): IndicatorRelevanceStage | null {
  return indicatorRelevanceStageValues.includes(
    value as IndicatorRelevanceStage,
  )
    ? (value as IndicatorRelevanceStage)
    : null;
}

function mapEntities(value: unknown): InterpretationEntityCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    id: createDocumentId(),
    originalField: readString(entry.originalField, "unknown_field"),
    aiMeaning: readString(entry.aiMeaning, "Unclassified"),
    entityType: readString(entry.entityType, "unknown"),
    confidence: readNumber(entry.confidence),
    reason: readString(entry.reason),
    sampleValues: readStringArray(entry.sampleValues),
  }));
}

// Python has no concept of the entity ids this service is about to generate,
// so it correlates indicators/relationships to entities by the entity's
// originalField name instead (wire fields relatedFields/involvedFields).
// This resolves those names to the real, freshly-generated entity ids so
// the persisted relatedEntityIds/involvedEntityIds are genuine references,
// not dangling strings that never match anything.
function resolveEntityIds(
  value: unknown,
  entityIdByOriginalField: ReadonlyMap<string, string>,
): string[] {
  return readStringArray(value)
    .map((originalField) => entityIdByOriginalField.get(originalField))
    .filter((id): id is string => Boolean(id));
}

function mapIndicators(
  value: unknown,
  entityIdByOriginalField: ReadonlyMap<string, string>,
): InterpretationIndicatorCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    id: createDocumentId(),
    name: readString(entry.name, "Unnamed indicator"),
    description: readString(entry.description),
    confidence: readNumber(entry.confidence),
    reason: readString(entry.reason),
    relatedEntityIds: resolveEntityIds(
      entry.relatedFields,
      entityIdByOriginalField,
    ),
    relevanceStage: readIndicatorRelevanceStage(entry.relevanceStage),
    status: "kept",
  }));
}

// Python has no concept of the indicator ids this service is about to
// generate, so goalAlignment correlates coverage entries to indicators by
// the indicator's name instead. This resolves those names to the real,
// freshly-generated indicator ids, same rationale as resolveEntityIds above.
function resolveIndicatorIds(
  value: unknown,
  indicatorIdByName: ReadonlyMap<string, string>,
): string[] {
  return readStringArray(value)
    .map((name) => indicatorIdByName.get(name))
    .filter((id): id is string => Boolean(id));
}

function mapGoalAlignment(
  value: unknown,
  indicatorIdByName: ReadonlyMap<string, string>,
): InterpretationGoalCoverageCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    goalSummary: readString(entry.goalSummary, "Unspecified goal"),
    isSupportedByData: entry.isSupportedByData === true,
    relatedIndicatorIds: resolveIndicatorIds(
      entry.relatedIndicatorNames,
      indicatorIdByName,
    ),
    gapExplanation: readNullableString(entry.gapExplanation),
  }));
}

function mapRelationships(
  value: unknown,
  entityIdByOriginalField: ReadonlyMap<string, string>,
): InterpretationRelationshipCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    description: readString(entry.description),
    involvedEntityIds: resolveEntityIds(
      entry.involvedFields,
      entityIdByOriginalField,
    ),
    confidence: readNumber(entry.confidence),
  }));
}

function mapQuestions(value: unknown): InterpretationQuestionCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    prompt: readString(entry.prompt, "Can you confirm this interpretation?"),
    kind: readQuestionKind(entry.kind),
    options: Array.isArray(entry.options)
      ? readStringArray(entry.options)
      : null,
  }));
}

function mapWarnings(value: unknown): InterpretationWarningCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    message: readString(entry.message),
    severity: readWarningSeverity(entry.severity),
  }));
}

export class InterpretationArtifactService {
  constructor(
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly activityRepository: ActivityRepository,
  ) {}

  async ingestProcessorArtifacts(
    job: ProcessingJobPersistenceRecord,
    details: ProcessingStatusDetails,
    targetStatus: ProcessingJobStatus,
  ): Promise<void> {
    if (targetStatus !== "completed" || !isRecord(details)) {
      return;
    }

    const interpretation = details.interpretation;
    if (!isRecord(interpretation) || !job.uploadMetadataId) {
      return;
    }

    const privacySafeRepresentationId = readNullableString(
      isRecord(job.payload) ? job.payload.privacySafeRepresentationId : null,
    );
    if (!privacySafeRepresentationId) {
      return;
    }

    const previous =
      await this.interpretationResultRepository.findLatestByPrivacySafeRepresentationId(
        privacySafeRepresentationId,
        databaseSession,
      );

    const entities = mapEntities(interpretation.entities);
    const entityIdByOriginalField = new Map(
      entities.map((entity) => [entity.originalField, entity.id]),
    );

    const indicators = mapIndicators(
      interpretation.indicators,
      entityIdByOriginalField,
    );
    const indicatorIdByName = new Map(
      indicators.map((indicator) => [indicator.name, indicator.id]),
    );

    await this.interpretationResultRepository.create(
      {
        organizationId: job.organizationId,
        projectId: job.projectId,
        activityId: job.activityId,
        uploadMetadataId: job.uploadMetadataId,
        privacySafeRepresentationId,
        processingJobId: job.id,
        versionNumber: (previous?.versionNumber ?? 0) + 1,
        previousInterpretationResultId: previous?.id ?? null,
        datasetType: readString(interpretation.datasetType, "unknown"),
        overallConfidence: readNumber(interpretation.overallConfidence),
        entities,
        indicators,
        relationships: mapRelationships(
          interpretation.relationships,
          entityIdByOriginalField,
        ),
        questions: mapQuestions(interpretation.questions),
        warnings: mapWarnings(interpretation.warnings),
        goalAlignment: mapGoalAlignment(
          interpretation.goalAlignment,
          indicatorIdByName,
        ),
      },
      databaseSession,
    );

    // A new interpretation result means the activity's knowledge just
    // changed — whether from a first-time upload or a re-run on existing
    // evidence — so any prior "nothing left to decide" acknowledgment no
    // longer applies and must be cleared, not left silently stale.
    if (job.activityId) {
      await this.activityRepository.update(
        job.activityId,
        {
          interpretationAcknowledgedAt: null,
          interpretationAcknowledgedById: null,
        },
        databaseSession,
      );
    }
  }
}
