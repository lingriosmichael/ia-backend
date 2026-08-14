import type { FastifyBaseLogger } from "fastify";
import type {
  ApproveQualitativeCodingReviewResponse,
  GenerateQualitativeCodingReviewResponse,
  QualitativeCodingReviewDecisions,
  QualitativeCodingReviewDecisionsInput,
  QualitativeCodingReviewRecord,
} from "../../shared/contracts.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import { mapQualitativeCodingReview } from "../../shared/utils/mappers.js";
import type { ActivityLlmTokenLedgerService } from "../activity/activityLlmTokenLedgerService.js";
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

function stripExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(0, index) : fileName;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function codebookTargetFileName(fileName: string): string {
  return `${stripExtension(fileName)}_codebook.csv`.toLowerCase();
}

type SourceCodebook = {
  uploadMetadataId: string;
  originalFileName: string;
  codes: Array<{
    code: string;
    label: string;
    description: string;
    exampleExcerpts: string[];
  }>;
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
  sourceCodebook: {
    uploadMetadataId: string;
    originalFileName: string;
    codeCount: number;
  } | null;
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
  }));
}

function parseSourceCodebookCodes(
  payload: Record<string, unknown>,
): SourceCodebook["codes"] {
  const firstTable = readRecordArray(payload.tables)[0] ?? null;
  if (!firstTable) {
    return [];
  }

  const rows = readRecordArray(firstTable.rows);
  return rows
    .map((row) => {
      const code =
        readString(row.code) ??
        readString(row.theme) ??
        readString(row.category) ??
        null;
      const label =
        readString(row.label) ??
        readString(row.name) ??
        readString(row.title) ??
        code;
      const description =
        readString(row.description) ??
        readString(row.definition) ??
        readString(row.meaning) ??
        label;
      if (!code || !label || !description) {
        return null;
      }
      return {
        code,
        label,
        description,
        exampleExcerpts: [],
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> =>
      Boolean(entry && entry.code && entry.label && entry.description),
    );
}

export class QualitativeCodingReviewService {
  constructor(
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly qualitativeCodingReviewRepository: QualitativeCodingReviewRepository,
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
  async assertReadyToGenerate(userId: string, uploadMetadataId: string) {
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

  async generate(
    userId: string,
    uploadMetadataId: string,
    language: "de" | "en",
  ): Promise<GenerateQualitativeCodingReviewResponse["review"]> {
    const { upload, privacySafeRepresentation, interpretationResult } =
      await this.assertReadyToGenerate(userId, uploadMetadataId);

    let sourceCodebook: SourceCodebook | null = null;
    if (upload.activityId) {
      const siblingUploads =
        await this.uploadMetadataRepository.listByActivityIds(
          [upload.activityId],
          databaseSession,
        );
      const matchingCodebookUpload =
        siblingUploads.find(
          (candidate) =>
            candidate.id !== upload.id &&
            candidate.originalFileName.toLowerCase() ===
              codebookTargetFileName(upload.originalFileName),
        ) ?? null;

      if (matchingCodebookUpload) {
        const codebookRepresentation =
          await this.privacySafeRepresentationRepository.findLatestByUploadMetadataId(
            matchingCodebookUpload.id,
            databaseSession,
          );
        if (codebookRepresentation) {
          const parsedCodes = parseSourceCodebookCodes(
            codebookRepresentation.payload,
          );
          if (parsedCodes.length > 0) {
            sourceCodebook = {
              uploadMetadataId: matchingCodebookUpload.id,
              originalFileName: matchingCodebookUpload.originalFileName,
              codes: parsedCodes,
            };
          }
        }
      }
    }

    const pythonRequest = {
      uploadMetadataId,
      originalFileName: upload.originalFileName,
      language,
      privacySafePayload: privacySafeRepresentation.payload,
      sourceCodebookCodes: sourceCodebook?.codes ?? [],
      sourceCodebookUploadMetadataId: sourceCodebook?.uploadMetadataId ?? null,
      sourceCodebookOriginalFileName: sourceCodebook?.originalFileName ?? null,
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
      sourceCodebook: sourceCodebook
        ? {
            uploadMetadataId: sourceCodebook.uploadMetadataId,
            originalFileName: sourceCodebook.originalFileName,
            codeCount: sourceCodebook.codes.length,
          }
        : null,
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
