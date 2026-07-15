import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  DatasetProfile,
  EvidenceRoutingDecision,
  InterpretationIndicatorComputedValue,
  InterpretationIndicatorStatus,
  InterpretationIndicatorSuggestedCalculation,
} from "../../shared/contracts.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import {
  InterpretationResultMongoModel,
  type InterpretationResultMongoHydratedDocument,
} from "./interpretationResultModel.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import type {
  InterpretationQuestionAnswerInput,
  InterpretationResultCreateInput,
  InterpretationResultPersistenceRecord,
  InterpretationResultSynthesisUpdateInput,
} from "./interpretationResultPersistence.js";

function toInterpretationResultRecord(
  document: InterpretationResultMongoHydratedDocument | null,
): InterpretationResultPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    uploadMetadataId: document.uploadMetadataId,
    privacySafeRepresentationId: document.privacySafeRepresentationId,
    processingJobId: document.processingJobId,
    versionNumber: document.versionNumber,
    previousInterpretationResultId:
      document.previousInterpretationResultId ?? null,
    datasetType: document.datasetType,
    overallConfidence: document.overallConfidence,
    evidenceRouting:
      (document.evidenceRouting as EvidenceRoutingDecision | null) ?? null,
    datasetProfile: (document.datasetProfile as DatasetProfile | null) ?? null,
    entities: document.entities.map((entity) => ({
      id: entity._id.toString(),
      originalField: entity.originalField,
      aiMeaning: entity.aiMeaning,
      entityType: entity.entityType,
      confidence: entity.confidence,
      reason: entity.reason,
      sampleValues: entity.sampleValues,
    })),
    indicators: document.indicators.map((indicator) => ({
      id: indicator._id.toString(),
      name: indicator.name,
      description: indicator.description,
      confidence: indicator.confidence,
      reason: indicator.reason,
      relatedEntityIds: indicator.relatedEntityIds,
      supportingParagraphKeys: indicator.supportingParagraphKeys,
      relevanceStage: indicator.relevanceStage ?? null,
      matchesStatedGoal: indicator.matchesStatedGoal ?? false,
      status: indicator.status ?? "kept",
      suggestedCalculation:
        (indicator.suggestedCalculation as InterpretationIndicatorSuggestedCalculation | null) ??
        null,
      computedValue:
        (indicator.computedValue as InterpretationIndicatorComputedValue | null) ??
        null,
    })),
    relationships: document.relationships.map((relationship) => ({
      id: relationship._id.toString(),
      description: relationship.description,
      involvedEntityIds: relationship.involvedEntityIds,
      confidence: relationship.confidence,
    })),
    qualitativeFindings: document.qualitativeFindings.map((finding) => ({
      id: finding._id.toString(),
      summary: finding.summary,
      stage: finding.stage,
      confidence: finding.confidence,
      reason: finding.reason,
      relatedEntityIds: finding.relatedEntityIds,
      relatedIndicatorIds: finding.relatedIndicatorIds,
      supportingQuoteIds: finding.supportingQuoteIds,
      category: finding.category ?? "context_only",
      outcomeReference: finding.outcomeReference ?? null,
      outcomeAnchorType: finding.outcomeAnchorType ?? "unanchored",
      relationToEvidence: finding.relationToEvidence ?? "context_only",
      status: finding.status ?? "kept",
    })),
    supportingQuotes: document.supportingQuotes.map((quote) => ({
      id: quote._id.toString(),
      excerptText: quote.excerptText,
      excerptKind: quote.excerptKind,
      speakerType: quote.speakerType,
      stage: quote.stage,
      confidence: quote.confidence,
      reason: quote.reason,
      sourceReference: quote.sourceReference,
      privacyMode: quote.privacyMode,
    })),
    questions: document.questions.map((question) => ({
      id: question._id.toString(),
      prompt: question.prompt,
      kind: question.kind,
      questionDomain: question.questionDomain ?? "interpretation",
      options: question.options ?? null,
      isBlocking: question.isBlocking ?? question.kind !== "free_text",
      questionCode: question.questionCode ?? null,
      targetTableName: question.targetTableName ?? null,
      targetColumnName: question.targetColumnName ?? null,
      status: question.status,
      answeredValue: question.answeredValue ?? null,
      answeredById: question.answeredById ?? null,
      answeredAt: question.answeredAt ?? null,
    })),
    warnings: document.warnings.map((warning) => ({
      id: warning._id.toString(),
      message: warning.message,
      severity: warning.severity,
    })),
    goalAlignment: document.goalAlignment.map((coverage) => ({
      id: coverage._id.toString(),
      goalSummary: coverage.goalSummary,
      isSupportedByData: coverage.isSupportedByData,
      relatedIndicatorIds: coverage.relatedIndicatorIds,
      gapExplanation: coverage.gapExplanation ?? null,
    })),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoInterpretationResultRepository implements InterpretationResultRepository {
  async create(
    input: InterpretationResultCreateInput,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord> {
    const [document] = await InterpretationResultMongoModel.create(
      [
        {
          _id: createDocumentId(),
          organizationId: input.organizationId,
          projectId: input.projectId,
          activityId: input.activityId,
          uploadMetadataId: input.uploadMetadataId,
          privacySafeRepresentationId: input.privacySafeRepresentationId,
          processingJobId: input.processingJobId,
          versionNumber: input.versionNumber,
          previousInterpretationResultId: input.previousInterpretationResultId,
          datasetType: input.datasetType,
          overallConfidence: input.overallConfidence,
          evidenceRouting: input.evidenceRouting,
          datasetProfile: input.datasetProfile,
          // Entity/indicator ids are pre-generated by the caller (see
          // InterpretationEntityCreateInput/InterpretationIndicatorCreateInput)
          // so indicators/relationships/goalAlignment can reference a real id in
          // the same write; Mongoose uses the supplied _id instead of invoking
          // the subdocument schema's default.
          entities: input.entities.map(({ id, ...entity }) => ({
            _id: id,
            ...entity,
          })),
          indicators: input.indicators.map(({ id, ...indicator }) => ({
            _id: id,
            ...indicator,
          })),
          relationships: input.relationships,
          qualitativeFindings: input.qualitativeFindings.map(
            ({ id, ...finding }) => ({
              _id: id,
              ...finding,
            }),
          ),
          supportingQuotes: input.supportingQuotes.map(({ id, ...quote }) => ({
            _id: id,
            ...quote,
          })),
          questions: input.questions,
          warnings: input.warnings,
          goalAlignment: input.goalAlignment,
        },
      ],
      getMongoSessionOptions(session),
    );

    return toInterpretationResultRecord(
      document,
    ) as InterpretationResultPersistenceRecord;
  }

  async replaceSynthesisArtifacts(
    interpretationResultId: string,
    input: InterpretationResultSynthesisUpdateInput,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null> {
    const document = await applyMongoSession(
      InterpretationResultMongoModel.findByIdAndUpdate(
        interpretationResultId,
        {
          $set: {
            datasetType: input.datasetType,
            overallConfidence: input.overallConfidence,
            entities: input.entities.map(({ id, ...entity }) => ({
              _id: id,
              ...entity,
            })),
            indicators: input.indicators.map(({ id, ...indicator }) => ({
              _id: id,
              ...indicator,
            })),
            relationships: input.relationships,
            qualitativeFindings: input.qualitativeFindings.map(
              ({ id, ...finding }) => ({
                _id: id,
                ...finding,
              }),
            ),
            supportingQuotes: input.supportingQuotes.map(
              ({ id, ...quote }) => ({
                _id: id,
                ...quote,
              }),
            ),
            warnings: input.warnings,
            goalAlignment: input.goalAlignment,
          },
        },
        { returnDocument: "after" },
      ),
      session,
    ).exec();

    return toInterpretationResultRecord(document);
  }

  async findById(
    interpretationResultId: string,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null> {
    const document = await applyMongoSession(
      InterpretationResultMongoModel.findById(interpretationResultId),
      session,
    ).exec();
    return toInterpretationResultRecord(document);
  }

  async findLatestByPrivacySafeRepresentationId(
    privacySafeRepresentationId: string,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null> {
    const document = await applyMongoSession(
      InterpretationResultMongoModel.findOne({
        privacySafeRepresentationId,
      }).sort({ versionNumber: -1 }),
      session,
    ).exec();
    return toInterpretationResultRecord(document);
  }

  async findLatestByUploadMetadataIds(
    uploadMetadataIds: string[],
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord[]> {
    if (uploadMetadataIds.length === 0) {
      return [];
    }

    const documents = await applyMongoSession(
      InterpretationResultMongoModel.find({
        uploadMetadataId: { $in: uploadMetadataIds },
      }).sort({ createdAt: -1 }),
      session,
    ).exec();

    const latestByUploadMetadataId = new Map<
      string,
      InterpretationResultMongoHydratedDocument
    >();
    for (const document of documents) {
      if (!latestByUploadMetadataId.has(document.uploadMetadataId)) {
        latestByUploadMetadataId.set(document.uploadMetadataId, document);
      }
    }

    return Array.from(latestByUploadMetadataId.values())
      .map((document) => toInterpretationResultRecord(document))
      .filter(
        (record): record is InterpretationResultPersistenceRecord =>
          record !== null,
      );
  }

  async answerQuestion(
    interpretationResultId: string,
    questionId: string,
    input: InterpretationQuestionAnswerInput,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null> {
    const document = await applyMongoSession(
      InterpretationResultMongoModel.findOneAndUpdate(
        {
          _id: interpretationResultId,
          "questions._id": questionId,
        },
        {
          $set: {
            "questions.$[question].status": "answered",
            "questions.$[question].answeredValue": input.answeredValue,
            "questions.$[question].answeredById": input.answeredById,
            "questions.$[question].answeredAt": input.answeredAt,
          },
        },
        {
          returnDocument: "after",
          arrayFilters: [{ "question._id": questionId }],
        },
      ),
      session,
    ).exec();

    return toInterpretationResultRecord(document);
  }

  async setIndicatorStatus(
    interpretationResultId: string,
    indicatorId: string,
    status: InterpretationIndicatorStatus,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null> {
    const document = await applyMongoSession(
      InterpretationResultMongoModel.findOneAndUpdate(
        {
          _id: interpretationResultId,
          "indicators._id": indicatorId,
        },
        {
          $set: {
            "indicators.$.status": status,
          },
        },
        { returnDocument: "after" },
      ),
      session,
    ).exec();

    return toInterpretationResultRecord(document);
  }

  async setQualitativeFindingStatus(
    interpretationResultId: string,
    qualitativeFindingId: string,
    status: InterpretationIndicatorStatus,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null> {
    const document = await applyMongoSession(
      InterpretationResultMongoModel.findOneAndUpdate(
        {
          _id: interpretationResultId,
          "qualitativeFindings._id": qualitativeFindingId,
        },
        {
          $set: {
            "qualitativeFindings.$.status": status,
          },
        },
        { returnDocument: "after" },
      ),
      session,
    ).exec();

    return toInterpretationResultRecord(document);
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      InterpretationResultMongoModel.deleteMany({
        projectId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      InterpretationResultMongoModel.deleteMany({
        activityId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      InterpretationResultMongoModel.deleteMany({
        uploadMetadataId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
