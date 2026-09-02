import type { FastifyBaseLogger } from "fastify";
import type {
  ApproveQualitativeCodingReviewResponse,
  GenerateQualitativeCodingReviewResponse,
  QualitativeCodingReviewFindingRecord,
  QualitativeCodingReviewDecisions,
  QualitativeCodingReviewDecisionsInput,
  QualitativeCodingReviewRecord,
  QualitativeCodingReviewSourceCodebookSelectionInput,
  QualitativeCodingReviewSuggestedCode,
} from "../../shared/contracts.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import { mapQualitativeCodingReview } from "../../shared/utils/mappers.js";
import type { ActivityLlmTokenLedgerService } from "../activity/activityLlmTokenLedgerService.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { PrivacySafeRepresentationRepository } from "./privacySafeRepresentationRepository.js";
import type { PythonProcessingClient } from "./pythonProcessingClient.js";
import type { QualitativeCodingReviewRepository } from "./qualitativeCodingReviewRepository.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readFindingsSummary(
  findings: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return Array.isArray(findings.summary)
    ? findings.summary.filter(isRecord)
    : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

type SourceCodebook = {
  sourceCodebookFrom: {
    uploadMetadataId: string;
    findingKey: string;
  };
  uploadMetadataId: string;
  originalFileName: string;
  codes: QualitativeCodingReviewSuggestedCode[];
};

type QualitativeCodingRequestSummary = {
  privacySafeTables: Array<{
    tableName: string;
    rowCount: number;
    columnNames: string[];
  }>;
  datasetProfileTables: Array<{
    tableName: string;
    rowCount: number;
    columns: Array<{
      name: string;
      epistemicRole: string | null;
    }>;
  }>;
  sourceCodebookSelections: Array<{
    targetFindingKey: string;
    sourceUploadMetadataId: string;
    sourceFindingKey: string;
    sourceOriginalFileName: string;
    codeCount: number;
  }>;
};

function summarizePayloadTables(payload: Record<string, unknown>) {
  return readRecordArray(payload.tables).map((table) => ({
    tableName: readString(table.name) ?? "table",
    rowCount: readRecordArray(table.rows).length,
    columnNames: Array.isArray(table.columns)
      ? table.columns.filter(
          (column): column is string => typeof column === "string",
        )
      : [],
  }));
}

function summarizeDatasetProfileTables(
  interpretationResult: Awaited<
    ReturnType<InterpretationResultRepository["findLatestByUploadMetadataIds"]>
  >[number],
) {
  return (interpretationResult.datasetProfile?.tables ?? []).map((table) => ({
    tableName: table.name,
    rowCount: table.rowCount,
    columns: table.columns.map((column) => ({
      name: column.name,
      epistemicRole: column.epistemicRole,
    })),
  }));
}

function summarizeProposalFindings(findings: Array<Record<string, unknown>>) {
  return findings.map((finding) => ({
    findingKey:
      typeof finding.findingKey === "string" ? finding.findingKey : null,
    tableName: typeof finding.tableName === "string" ? finding.tableName : null,
    textColumnName:
      typeof finding.textColumnName === "string"
        ? finding.textColumnName
        : null,
    rowCount: typeof finding.rowCount === "number" ? finding.rowCount : null,
    nonEmptyRowCount:
      typeof finding.nonEmptyRowCount === "number"
        ? finding.nonEmptyRowCount
        : null,
    proposedCodeCount: Array.isArray(finding.proposedCodes)
      ? finding.proposedCodes.length
      : 0,
    proposedAssignmentCount: Array.isArray(finding.proposedAssignments)
      ? finding.proposedAssignments.length
      : 0,
    sourceCodebookFrom:
      isRecord(finding.sourceCodebookFrom) &&
      typeof finding.sourceCodebookFrom.uploadMetadataId === "string" &&
      typeof finding.sourceCodebookFrom.findingKey === "string"
        ? {
            uploadMetadataId: finding.sourceCodebookFrom.uploadMetadataId,
            findingKey: finding.sourceCodebookFrom.findingKey,
          }
        : null,
  }));
}

function readFindingRecord(
  finding: Record<string, unknown>,
): QualitativeCodingReviewFindingRecord | null {
  const findingKey = readString(finding.findingKey);
  const tableName = readString(finding.tableName);
  const textColumnName = readString(finding.textColumnName);
  const syntheticCodeColumnName = readString(finding.syntheticCodeColumnName);
  const rowCount =
    typeof finding.rowCount === "number" ? finding.rowCount : null;
  const nonEmptyRowCount =
    typeof finding.nonEmptyRowCount === "number"
      ? finding.nonEmptyRowCount
      : null;
  if (
    !findingKey ||
    !tableName ||
    !textColumnName ||
    !syntheticCodeColumnName ||
    rowCount === null ||
    nonEmptyRowCount === null
  ) {
    return null;
  }

  const sourceCodebookFrom =
    isRecord(finding.sourceCodebookFrom) &&
    typeof finding.sourceCodebookFrom.uploadMetadataId === "string" &&
    typeof finding.sourceCodebookFrom.findingKey === "string"
      ? {
          uploadMetadataId: finding.sourceCodebookFrom.uploadMetadataId,
          findingKey: finding.sourceCodebookFrom.findingKey,
        }
      : null;

  return {
    findingKey,
    tableName,
    textColumnName,
    syntheticCodeColumnName,
    rowCount,
    nonEmptyRowCount,
    sampleExcerpts: Array.isArray(finding.sampleExcerpts)
      ? finding.sampleExcerpts.filter(
          (excerpt): excerpt is string => typeof excerpt === "string",
        )
      : [],
    existingCodeColumnNames: Array.isArray(finding.existingCodeColumnNames)
      ? finding.existingCodeColumnNames.filter(
          (columnName): columnName is string => typeof columnName === "string",
        )
      : [],
    proposedCodes: readRecordArray(finding.proposedCodes)
      .map((code) => {
        const parsedCode = readString(code.code);
        const label = readString(code.label);
        const description = readString(code.description);
        if (!parsedCode || !label || !description) {
          return null;
        }
        return {
          code: parsedCode,
          label,
          description,
          exampleExcerpts: Array.isArray(code.exampleExcerpts)
            ? code.exampleExcerpts.filter(
                (excerpt): excerpt is string => typeof excerpt === "string",
              )
            : [],
        } satisfies QualitativeCodingReviewSuggestedCode;
      })
      .filter(
        (code): code is QualitativeCodingReviewSuggestedCode => code !== null,
      ),
    proposedAssignments: readRecordArray(finding.proposedAssignments)
      .map((assignment) => {
        if (typeof assignment.rowIndex !== "number") {
          return null;
        }
        return {
          rowIndex: assignment.rowIndex,
          assignedCode:
            typeof assignment.assignedCode === "string"
              ? assignment.assignedCode
              : null,
        };
      })
      .filter(
        (
          assignment,
        ): assignment is QualitativeCodingReviewFindingRecord["proposedAssignments"][number] =>
          assignment !== null,
      ),
    sourceCodebookFrom,
    sourceCodebookOriginalFileName: readString(
      finding.sourceCodebookOriginalFileName,
    ),
  };
}

function approvedDecisionKeys(review: {
  decisions: QualitativeCodingReviewDecisions | null;
}): Set<string> {
  return new Set(
    (review.decisions?.columnDecisions ?? [])
      .filter((decision) => decision.decision === "approve_as_proposed")
      .map((decision) => decision.findingKey),
  );
}

export class QualitativeCodingReviewService {
  constructor(
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly qualitativeCodingReviewRepository: QualitativeCodingReviewRepository,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly projectLlmTokenLedgerService: ProjectLlmTokenLedgerService,
    private readonly activityLlmTokenLedgerService: ActivityLlmTokenLedgerService,
    private readonly logger: FastifyBaseLogger,
    private readonly includePayloadsInLogs: boolean,
  ) {}

  async getByUploadMetadataId(
    userId: string,
    uploadMetadataId: string,
  ): Promise<QualitativeCodingReviewRecord> {
    const upload = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );
    if (!upload) {
      throw new AppError("Upload not found.", 404, "upload_not_found");
    }
    await this.authorizationService.canViewProject(userId, upload.projectId);

    const review =
      await this.qualitativeCodingReviewRepository.findByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );
    if (!review) {
      throw new AppError(
        "Qualitative coding review not found.",
        404,
        "qualitative_coding_review_not_found",
      );
    }

    return mapQualitativeCodingReview(review);
  }

  /**
   * The synchronous precondition gate for generating a qualitative coding
   * review: upload existence, auth, and the three 409s that must reject
   * before any Python call is made. Called both as the synchronous
   * pre-flight check and again, defensively, at the top of generate()
   * itself right before the real work, for the same reason
   * ActivityAnalysisV2Service.assertReadyForV2Run is re-checked at
   * execution time — state can drift between enqueue and dequeue. Note the
   * "no uncoded free-text columns" 409 in generate() below is NOT part of
   * this gate: it's only knowable after the Python call returns, so it
   * stays a job-body-only failure mode.
   */
  async assertReadyToGenerate(
    userId: string,
    uploadMetadataId: string,
    // Set when this is the defensive re-check inside generate() itself
    // (see the doc comment above): by that point the calling job has
    // already claimed status "processing" and so is itself "active" for
    // this upload — it must be excluded from the check below, or every
    // legitimate generation would reject itself. Left undefined for the
    // synchronous pre-flight call from the controller, where no job exists
    // yet and the check should apply unconditionally.
    excludeJobId?: string,
  ) {
    const upload = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );
    if (!upload) {
      throw new AppError("Upload not found.", 404, "upload_not_found");
    }
    await this.authorizationService.canEditProject(userId, upload.projectId);

    // There is currently no user-facing "regenerate this review" action —
    // every call to generate() is either the first one for this upload, or
    // an unintended duplicate (e.g. the frontend's auto-trigger racing
    // itself after the dialog is closed and reopened while the first
    // generation is still in flight). Because a regenerate always resets
    // the review to "pending" and discards prior decisions, silently
    // allowing a second call would wipe out real approval progress. Reject
    // here instead of overwriting — this runs before any job is even
    // created (see QualitativeCodingReviewController.generate), so a
    // duplicate request fails fast rather than spending a second LLM round
    // trip and job cycle just to reach the same conclusion.
    const existingReview =
      await this.qualitativeCodingReviewRepository.findByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );
    if (existingReview) {
      throw new AppError(
        "A qualitative coding review already exists for this evidence file.",
        409,
        "qualitative_coding_review_already_exists",
      );
    }

    // The existingReview check above only catches a *second* generate()
    // call once the first one has already finished — but generate() itself
    // only creates a job here; the review row this checks for isn't
    // written until the job later runs to completion. Two calls close
    // together (e.g. the frontend's auto-trigger firing twice while the
    // dialog is opened and reopened) can both pass the check above and
    // both create a job, doubling LLM cost and racing to persist the
    // review. Guard against that window explicitly.
    const activeJob =
      await this.processingJobRepository.findActiveByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );
    if (activeJob && activeJob.id !== excludeJobId) {
      throw new AppError(
        "A qualitative coding review is already being generated for this evidence file.",
        409,
        "qualitative_coding_review_generation_in_progress",
      );
    }

    const privacySafeRepresentation =
      await this.privacySafeRepresentationRepository.findLatestByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );
    if (!privacySafeRepresentation) {
      throw new AppError(
        "Privacy-safe representation not found for this upload.",
        409,
        "qualitative_coding_review_privacy_safe_missing",
      );
    }

    const interpretationResult =
      (
        await this.interpretationResultRepository.findLatestByUploadMetadataIds(
          [uploadMetadataId],
          databaseSession,
        )
      ).find((result) => result.uploadMetadataId === uploadMetadataId) ?? null;
    if (!interpretationResult) {
      throw new AppError(
        "Interpretation result not found for this upload.",
        409,
        "qualitative_coding_review_interpretation_missing",
      );
    }

    return { upload, privacySafeRepresentation, interpretationResult };
  }

  private async resolveSourceCodebookSelections(
    targetUploadMetadataId: string,
    activityId: string | null,
    selections: QualitativeCodingReviewSourceCodebookSelectionInput[],
  ): Promise<
    Array<
      SourceCodebook & {
        targetFindingKey: string;
      }
    >
  > {
    if (selections.length === 0) {
      return [];
    }
    if (!activityId) {
      throw new AppError(
        "A source codebook can only be reused within the same activity.",
        400,
        "qualitative_coding_review_source_codebook_activity_required",
      );
    }

    const activityUploads =
      await this.uploadMetadataRepository.listByActivityIds(
        [activityId],
        databaseSession,
      );
    const activityUploadById = new Map(
      activityUploads.map((upload) => [upload.id, upload]),
    );
    const sourceUploadIds = [
      ...new Set(
        selections.map(
          (selection) => selection.sourceCodebookFrom.uploadMetadataId,
        ),
      ),
    ];
    const sourceReviews =
      await this.qualitativeCodingReviewRepository.findByUploadMetadataIds(
        sourceUploadIds,
        databaseSession,
      );
    const sourceReviewByUploadId = new Map(
      sourceReviews.map((review) => [review.uploadMetadataId, review]),
    );

    return selections.map((selection) => {
      const sourceUpload = activityUploadById.get(
        selection.sourceCodebookFrom.uploadMetadataId,
      );
      if (!sourceUpload || sourceUpload.id === targetUploadMetadataId) {
        throw new AppError(
          "The selected source codebook must come from another upload in the same activity.",
          400,
          "qualitative_coding_review_source_codebook_not_found",
        );
      }

      const sourceReview = sourceReviewByUploadId.get(sourceUpload.id);
      if (!sourceReview || sourceReview.status !== "approved") {
        throw new AppError(
          "The selected source codebook is not available because its qualitative coding review is not approved.",
          409,
          "qualitative_coding_review_source_codebook_not_approved",
        );
      }

      const approvedKeys = approvedDecisionKeys(sourceReview);
      const sourceFinding =
        readFindingsSummary(sourceReview.findings)
          .map(readFindingRecord)
          .find(
            (finding) =>
              finding !== null &&
              finding.findingKey === selection.sourceCodebookFrom.findingKey,
          ) ?? null;
      if (!sourceFinding || !approvedKeys.has(sourceFinding.findingKey)) {
        throw new AppError(
          "The selected source codebook finding is not approved for reuse.",
          409,
          "qualitative_coding_review_source_codebook_finding_not_approved",
        );
      }
      if (sourceFinding.proposedCodes.length === 0) {
        throw new AppError(
          "The selected source codebook finding has no reusable codes.",
          409,
          "qualitative_coding_review_source_codebook_empty",
        );
      }

      return {
        targetFindingKey: selection.targetFindingKey,
        sourceCodebookFrom: selection.sourceCodebookFrom,
        uploadMetadataId: sourceUpload.id,
        originalFileName: sourceUpload.originalFileName,
        codes: sourceFinding.proposedCodes,
      };
    });
  }

  async generate(
    userId: string,
    uploadMetadataId: string,
    language: "de" | "en",
    options?: {
      sourceCodebookSelections?: QualitativeCodingReviewSourceCodebookSelectionInput[];
      // The id of the qualitative_coding_review job currently executing this
      // call (activityAnalysisWorker.ts passes its own job.id) — excluded
      // from the active-job check inside assertReadyToGenerate, since this
      // job is itself "active" by the time it reaches this defensive
      // re-check. Left undefined only by tests that call generate() directly.
      currentJobId?: string;
    },
  ): Promise<GenerateQualitativeCodingReviewResponse["review"]> {
    const { upload, privacySafeRepresentation, interpretationResult } =
      await this.assertReadyToGenerate(
        userId,
        uploadMetadataId,
        options?.currentJobId,
      );

    const sourceCodebookSelections = await this.resolveSourceCodebookSelections(
      upload.id,
      upload.activityId,
      options?.sourceCodebookSelections ?? [],
    );

    const pythonRequest = {
      uploadMetadataId,
      originalFileName: upload.originalFileName,
      language,
      privacySafePayload: privacySafeRepresentation.payload,
      sourceCodebookSelections: sourceCodebookSelections.map((selection) => ({
        targetFindingKey: selection.targetFindingKey,
        sourceCodebookFrom: selection.sourceCodebookFrom,
        sourceCodebookCodes: selection.codes,
        sourceCodebookOriginalFileName: selection.originalFileName,
      })),
      datasetProfileTables: (
        interpretationResult.datasetProfile?.tables ?? []
      ).map((table) => ({
        tableName: table.name,
        rowCount: table.rowCount,
        columns: table.columns.map((column) => ({
          name: column.name,
          epistemicRole: column.epistemicRole,
        })),
      })),
    };
    const requestSummary: QualitativeCodingRequestSummary = {
      privacySafeTables: summarizePayloadTables(
        privacySafeRepresentation.payload,
      ),
      datasetProfileTables: summarizeDatasetProfileTables(interpretationResult),
      sourceCodebookSelections: sourceCodebookSelections.map((selection) => ({
        targetFindingKey: selection.targetFindingKey,
        sourceUploadMetadataId: selection.uploadMetadataId,
        sourceFindingKey: selection.sourceCodebookFrom.findingKey,
        sourceOriginalFileName: selection.originalFileName,
        codeCount: selection.codes.length,
      })),
    };

    this.logger.info(
      {
        uploadMetadataId,
        activityId: upload.activityId,
        projectId: upload.projectId,
        language,
        requestSummary,
        pythonRequest: this.includePayloadsInLogs ? pythonRequest : undefined,
      },
      "sending qualitative coding review request to python service",
    );

    const proposal =
      await this.pythonProcessingClient.proposeQualitativeCodingReview(
        pythonRequest,
      );

    this.logger.info(
      {
        uploadMetadataId,
        activityId: upload.activityId,
        projectId: upload.projectId,
        findingsCount: proposal.findings.length,
        proposalSummary: summarizeProposalFindings(proposal.findings),
        llmUsage: proposal.llmUsage ?? null,
        pythonResponse: this.includePayloadsInLogs ? proposal : undefined,
      },
      "received qualitative coding review response from python service",
    );

    await this.projectLlmTokenLedgerService.recordUsage(
      upload.projectId,
      proposal.llmUsage ?? null,
      databaseSession,
    );
    await this.activityLlmTokenLedgerService.recordUsage(
      upload.activityId,
      proposal.llmUsage ?? null,
      databaseSession,
    );

    const persisted =
      await this.qualitativeCodingReviewRepository.upsertByUploadMetadataId(
        {
          organizationId: upload.organizationId,
          projectId: upload.projectId,
          activityId: upload.activityId,
          uploadMetadataId,
          privacySafeRepresentationId: privacySafeRepresentation.id,
          interpretationResultId: interpretationResult.id,
          findings: { summary: proposal.findings },
        },
        databaseSession,
      );

    this.logger.info(
      {
        uploadMetadataId,
        qualitativeCodingReviewId: persisted.id,
        status: persisted.status,
        findingsCount: proposal.findings.length,
      },
      "persisted qualitative coding review",
    );

    return mapQualitativeCodingReview(persisted);
  }

  async approve(
    userId: string,
    uploadMetadataId: string,
    decisions: QualitativeCodingReviewDecisionsInput | undefined,
  ): Promise<ApproveQualitativeCodingReviewResponse> {
    const upload = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );
    if (!upload) {
      throw new AppError("Upload not found.", 404, "upload_not_found");
    }
    await this.authorizationService.canEditProject(userId, upload.projectId);

    const review =
      await this.qualitativeCodingReviewRepository.findByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );
    if (!review) {
      throw new AppError(
        "Qualitative coding review not found.",
        404,
        "qualitative_coding_review_not_found",
      );
    }
    if (review.status !== "pending") {
      throw new AppError(
        "Qualitative coding review has already been resolved.",
        409,
        "qualitative_coding_review_already_resolved",
      );
    }

    const approvedAt = new Date();
    const stampedDecisions = (decisions?.columnDecisions ?? []).map(
      (columnDecision) => ({
        ...columnDecision,
        decidedById: userId,
        decidedAt: approvedAt.toISOString(),
      }),
    );
    const decisionsToApply: QualitativeCodingReviewDecisions = {
      columnDecisions: stampedDecisions,
    };

    const findingsRequiringDecision = readFindingsSummary(review.findings);
    const decisionsByFindingKey = new Map(
      stampedDecisions.map((decision) => [decision.findingKey, decision]),
    );
    const unresolvedFindings = findingsRequiringDecision.filter((finding) => {
      const findingKey = finding.findingKey;
      return (
        typeof findingKey === "string" && !decisionsByFindingKey.has(findingKey)
      );
    });
    if (unresolvedFindings.length > 0) {
      throw new AppError(
        "Every qualitative coding finding must have a review decision before continuing.",
        400,
        "qualitative_coding_review_decisions_incomplete",
        { unresolvedFindings },
      );
    }

    const approvedReview =
      await this.qualitativeCodingReviewRepository.approveIfPending(
        uploadMetadataId,
        { decisions: decisionsToApply, approvedById: userId, approvedAt },
        databaseSession,
      );
    if (!approvedReview) {
      throw new AppError(
        "Qualitative coding review has already been resolved.",
        409,
        "qualitative_coding_review_already_resolved",
      );
    }

    return {
      review: mapQualitativeCodingReview(approvedReview),
    };
  }
}
