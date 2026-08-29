import type { FastifyBaseLogger } from "fastify";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import { humanizeColumnName } from "../interpretation/activityAnalysisV2Service.js";
import {
  buildOutcomeEvidenceCandidateCatalog,
  type OutcomeEvidenceCandidateCatalogDependencies,
  type OutcomeEvidenceCandidateCatalogEntry,
} from "./outcomeEvidenceCandidateCatalogBuilder.js";
import {
  buildPairedDeltaProposalId,
  buildProposalIdFromLink,
  buildSingleDistributionProposalId,
} from "./outcomeEvidenceApprovalSafetyCheck.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { OutcomeEvidenceLinkRepository } from "./outcomeEvidenceLinkRepository.js";
import type { ProjectOutcomeStatementRepository } from "./projectOutcomeStatementRepository.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "./projectOutcomeStatementPersistence.js";

export interface OutcomeEvidenceRecommendationColumnReference {
  uploadMetadataId: string;
  tableName: string;
  columnName: string;
  label: string;
  // The table's declared cohortTag — display-only here (the approval
  // safety check re-resolves it fresh from current evidence rather than
  // trusting this echoed-back value; see §4.4). Surfaced so the frontend
  // can show a recommendation's real cohort directly, per
  // OUTCOME_EVIDENCE_MERGE_PLAN.md §4.5, instead of guessing one from a
  // filename the way the old review panel's inferAudienceFromText did.
  cohortTag: string | null;
}

export type OutcomeEvidenceRecommendation =
  | {
      shape: "paired_delta";
      before: OutcomeEvidenceRecommendationColumnReference;
      after: OutcomeEvidenceRecommendationColumnReference;
      outcomeId: string | null;
      rationale: string;
    }
  | {
      shape: "single_distribution";
      column: OutcomeEvidenceRecommendationColumnReference;
      outcomeId: string | null;
      rationale: string;
    };

// Read-side counterpart to OutcomeEvidenceRecommendation for an already
// *confirmed* OutcomeEvidenceLink: same before/after/column shape (so the
// frontend can reuse its existing grouping/rendering logic across both),
// but with linkId/confirmedAt instead of a rationale, and each column
// carries a humanized label since the persisted link itself only stores
// the raw columnName (see outcomeEvidenceLinkPersistence.ts).
export type OutcomeEvidenceConfirmedLink =
  | {
      linkId: string;
      shape: "paired_delta";
      before: OutcomeEvidenceRecommendationColumnReference;
      after: OutcomeEvidenceRecommendationColumnReference;
      outcomeId: string;
      confirmedAt: string;
    }
  | {
      linkId: string;
      shape: "single_distribution";
      column: OutcomeEvidenceRecommendationColumnReference;
      outcomeId: string;
      confirmedAt: string;
    };

/**
 * Orchestrates the new joint pairing+outcome recommendation call
 * (OUTCOME_EVIDENCE_MERGE_PLAN.md §4.3) for one merged "Ausgangslage &
 * Wirkungsdaten" activity: builds the candidate catalog, calls Python, and
 * is the real trust boundary for the response — every columnId and
 * outcomeId Python returns is independently re-validated against the
 * catalog this service itself built and the project's real
 * ProjectOutcomeStatement ids before ever being resolved back into a real
 * column reference. Python's own grounding check
 * (recommendation_grounding.py) is defense in depth, not the guarantee.
 *
 * Any Python failure (thrown error, timeout, or a "FAILED" grounding
 * status) results in an empty list — same "never let a suggestion failure
 * break anything" posture as OutcomeEvidencePairingSuggestionService.
 */
export class OutcomeEvidenceRecommendationService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly activityRepository: ActivityRepository,
    private readonly projectOutcomeStatementRepository: ProjectOutcomeStatementRepository,
    private readonly candidateCatalogDependencies: OutcomeEvidenceCandidateCatalogDependencies,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly logger: FastifyBaseLogger,
    private readonly outcomeEvidenceLinkRepository: OutcomeEvidenceLinkRepository,
  ) {}

  // Public entrypoint for the route: owns auth, activity-scoping, and
  // fetching the project's declared outcome statements, then delegates to
  // recommendForActivity below (kept as its own method, independently
  // tested against a pre-fetched outcomeStatements list, the same split
  // OutcomeEvidencePairingService/OutcomeEvidencePairingSuggestionService
  // already use for this exact reason).
  async recommendForProject(
    userId: string,
    projectId: string,
    activityId: string,
    language: "de" | "en" = "de",
  ): Promise<OutcomeEvidenceRecommendation[]> {
    const { project } = await this.authorizationService.canEditProject(
      userId,
      projectId,
    );

    const activity = await this.activityRepository.findById(
      activityId,
      databaseSession,
    );
    if (!activity || activity.projectId !== project.id) {
      throw new AppError(
        "This activity was not found for this project.",
        404,
        "activity_not_found",
      );
    }

    const outcomeStatements =
      await this.projectOutcomeStatementRepository.listByProjectId(
        project.id,
        databaseSession,
      );

    return this.recommendForActivity(
      project.id,
      activityId,
      outcomeStatements,
      language,
    );
  }

  async recommendForActivity(
    projectId: string,
    activityId: string,
    outcomeStatements: ProjectOutcomeStatementPersistenceRecord[],
    language: "de" | "en" = "de",
  ): Promise<OutcomeEvidenceRecommendation[]> {
    const [catalog, confirmedLinks] = await Promise.all([
      buildOutcomeEvidenceCandidateCatalog(
        this.candidateCatalogDependencies,
        activityId,
      ),
      this.outcomeEvidenceLinkRepository.listByActivityId(
        activityId,
        databaseSession,
      ),
    ]);
    if (catalog.length === 0) {
      return [];
    }

    // A column pairing/column that already has a confirmed OutcomeEvidenceLink
    // has nothing left to recommend — without this, re-running "get
    // recommendations" after confirming everything keeps re-suggesting the
    // same already-confirmed pairing, which then 409s
    // ("already been confirmed") the moment a human tries to approve it
    // again.
    const confirmedProposalIds = new Set(
      confirmedLinks.map((link) => buildProposalIdFromLink(link)),
    );

    const catalogByColumnId = new Map(
      catalog.map((entry) => [entry.columnId, entry]),
    );
    const outcomeStatementIds = new Set(
      outcomeStatements.map((outcomeStatement) => outcomeStatement.id),
    );

    try {
      const response =
        await this.pythonProcessingClient.recommendOutcomeEvidencePairings({
          projectId,
          language,
          outcomeStatements: outcomeStatements.map((outcomeStatement) => ({
            outcomeId: outcomeStatement.id,
            term: outcomeStatement.term,
            statement: outcomeStatement.statement,
          })),
          candidates: catalog.map((entry) => ({
            columnId: entry.columnId,
            label: entry.label,
            epistemicRole: entry.epistemicRole,
            inferredType: entry.inferredType,
            distinctValueCount: entry.distinctValueCount,
            cohortTag: entry.cohortTag,
          })),
        });

      if (response.groundingStatus === "FAILED") {
        return [];
      }

      const recommendations: OutcomeEvidenceRecommendation[] = [];
      for (const entry of response.recommendations) {
        const outcomeId = this.resolveOutcomeId(
          entry.outcomeId,
          outcomeStatementIds,
          projectId,
        );

        const recommendation = this.resolveRecommendation(
          entry,
          catalogByColumnId,
          outcomeId,
        );
        if (
          recommendation &&
          !this.isAlreadyConfirmed(recommendation, confirmedProposalIds)
        ) {
          recommendations.push(recommendation);
        }
      }

      return recommendations;
    } catch (error) {
      this.logger.error(
        { err: error, projectId, activityId },
        "outcome evidence pairing recommendation call failed; will be retried on the next request",
      );
      return [];
    }
  }

  // Read-only summary of what's already confirmed for this activity —
  // powers the frontend's persistent "confirmed links" view, which used to
  // have nothing to read (the panel's only prior feedback,
  // `confirmedJustNow`, was local component state that reset on every
  // refresh/tab switch). Display-only: labels are humanized fresh from the
  // persisted raw columnName, since OutcomeEvidenceLink itself doesn't
  // store one (see outcomeEvidenceLinkPersistence.ts).
  async listConfirmedLinksForActivity(
    userId: string,
    projectId: string,
    activityId: string,
  ): Promise<OutcomeEvidenceConfirmedLink[]> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );

    const activity = await this.activityRepository.findById(
      activityId,
      databaseSession,
    );
    if (!activity || activity.projectId !== project.id) {
      throw new AppError(
        "This activity was not found for this project.",
        404,
        "activity_not_found",
      );
    }

    const links = await this.outcomeEvidenceLinkRepository.listByActivityId(
      activityId,
      databaseSession,
    );

    return links.map((link): OutcomeEvidenceConfirmedLink => {
      if (link.shape === "paired_delta") {
        return {
          linkId: link.linkId,
          shape: "paired_delta",
          outcomeId: link.outcomeId,
          confirmedAt: link.confirmedAt,
          before: {
            uploadMetadataId: link.beforeUploadMetadataId,
            tableName: link.beforeTableName,
            columnName: link.beforeColumnName,
            label: humanizeColumnName(link.beforeColumnName),
            cohortTag: null,
          },
          after: {
            uploadMetadataId: link.afterUploadMetadataId,
            tableName: link.afterTableName,
            columnName: link.afterColumnName,
            label: humanizeColumnName(link.afterColumnName),
            cohortTag: null,
          },
        };
      }

      return {
        linkId: link.linkId,
        shape: "single_distribution",
        outcomeId: link.outcomeId,
        confirmedAt: link.confirmedAt,
        column: {
          uploadMetadataId: link.uploadMetadataId,
          tableName: link.tableName,
          columnName: link.categoryColumnName,
          label: humanizeColumnName(link.categoryColumnName),
          cohortTag: null,
        },
      };
    });
  }

  // Exposes the same candidate catalog buildOutcomeEvidenceCandidateCatalog
  // already builds for the LLM recommend call, over HTTP with no LLM call
  // involved — this is what powers the "manually add a pairing" picker for
  // cases the model missed. Zero new business logic: the catalog already
  // excludes identifier/free_text columns, the same eligibility rule a
  // manual pick should respect too.
  async listCandidatesForActivity(
    userId: string,
    projectId: string,
    activityId: string,
  ): Promise<OutcomeEvidenceCandidateCatalogEntry[]> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );

    const activity = await this.activityRepository.findById(
      activityId,
      databaseSession,
    );
    if (!activity || activity.projectId !== project.id) {
      throw new AppError(
        "This activity was not found for this project.",
        404,
        "activity_not_found",
      );
    }

    return buildOutcomeEvidenceCandidateCatalog(
      this.candidateCatalogDependencies,
      activityId,
    );
  }

  private resolveOutcomeId(
    outcomeId: string | null,
    outcomeStatementIds: Set<string>,
    projectId: string,
  ): string | null {
    if (outcomeId === null || outcomeStatementIds.has(outcomeId)) {
      return outcomeId;
    }

    this.logger.error(
      { projectId, outcomeId },
      "outcome evidence pairing recommendation referenced an outcomeId outside this project; treating as uncertain",
    );
    return null;
  }

  private resolveRecommendation(
    entry: {
      shape: "paired_delta" | "single_distribution";
      beforeColumnId?: string | null;
      afterColumnId?: string | null;
      columnId?: string | null;
      rationale: string;
    },
    catalogByColumnId: Map<string, OutcomeEvidenceCandidateCatalogEntry>,
    outcomeId: string | null,
  ): OutcomeEvidenceRecommendation | null {
    if (entry.shape === "paired_delta") {
      const before = entry.beforeColumnId
        ? catalogByColumnId.get(entry.beforeColumnId)
        : undefined;
      const after = entry.afterColumnId
        ? catalogByColumnId.get(entry.afterColumnId)
        : undefined;
      if (!before || !after || before.columnId === after.columnId) {
        this.logger.error(
          {
            beforeColumnId: entry.beforeColumnId,
            afterColumnId: entry.afterColumnId,
          },
          "outcome evidence pairing recommendation referenced an invalid paired_delta column pair; dropping it",
        );
        return null;
      }

      return {
        shape: "paired_delta",
        before: toColumnReference(before),
        after: toColumnReference(after),
        outcomeId,
        rationale: entry.rationale,
      };
    }

    const column = entry.columnId
      ? catalogByColumnId.get(entry.columnId)
      : undefined;
    if (!column) {
      this.logger.error(
        { columnId: entry.columnId },
        "outcome evidence pairing recommendation referenced an invalid single_distribution column; dropping it",
      );
      return null;
    }

    return {
      shape: "single_distribution",
      column: toColumnReference(column),
      outcomeId,
      rationale: entry.rationale,
    };
  }

  private isAlreadyConfirmed(
    recommendation: OutcomeEvidenceRecommendation,
    confirmedProposalIds: Set<string>,
  ): boolean {
    const proposalId =
      recommendation.shape === "paired_delta"
        ? buildPairedDeltaProposalId(
            recommendation.before,
            recommendation.after,
          )
        : buildSingleDistributionProposalId(recommendation.column);
    return confirmedProposalIds.has(proposalId);
  }
}

function toColumnReference(
  entry: OutcomeEvidenceCandidateCatalogEntry,
): OutcomeEvidenceRecommendationColumnReference {
  return {
    uploadMetadataId: entry.uploadMetadataId,
    tableName: entry.tableName,
    columnName: entry.columnName,
    label: entry.label,
    cohortTag: entry.cohortTag,
  };
}
