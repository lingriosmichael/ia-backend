import type { FastifyBaseLogger } from "fastify";
import type {
  OutcomeEvidencePairingProposal,
  OutcomeEvidencePairingSuggestedOutcome,
} from "../../shared/contracts.js";
import { humanizeColumnName } from "../interpretation/activityAnalysisV2Service.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "./projectOutcomeStatementPersistence.js";

export interface OutcomeEvidencePairingSuggestionInput {
  projectId: string;
  language: "de" | "en";
  outcomeStatements: ProjectOutcomeStatementPersistenceRecord[];
  candidates: OutcomeEvidencePairingProposal[];
  activityNameById: Map<string, string>;
}

function buildColumnLabel(columnName: string): string {
  return humanizeColumnName(columnName);
}

/**
 * LLM-suggested pre-fill for the human's outcome pick on a detected
 * evidence-pairing candidate — a suggestion only, never a decision. This
 * collaborator is the sole trust boundary for the suggested outcomeId: it
 * re-validates every value the Python service returns against the
 * project's own declared ProjectOutcomeStatement ids before it is ever
 * cached or shown, since Python's own grounding check
 * (suggestion_grounding.py) is defense-in-depth, not the real guarantee.
 * Any Python failure (thrown error, timeout, or a "FAILED" grounding
 * status) results in an empty map — never lets a suggestion failure break
 * the deterministic propose flow that calls this.
 */
export class OutcomeEvidencePairingSuggestionService {
  constructor(
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async suggestOutcomes(
    input: OutcomeEvidencePairingSuggestionInput,
  ): Promise<Map<string, OutcomeEvidencePairingSuggestedOutcome>> {
    if (input.candidates.length === 0 || input.outcomeStatements.length === 0) {
      return new Map();
    }

    const outcomeStatementIds = new Set(
      input.outcomeStatements.map((outcomeStatement) => outcomeStatement.id),
    );

    try {
      const response =
        await this.pythonProcessingClient.suggestOutcomeEvidencePairingOutcomes(
          {
            projectId: input.projectId,
            language: input.language,
            outcomeStatements: input.outcomeStatements.map(
              (outcomeStatement) => ({
                outcomeId: outcomeStatement.id,
                term: outcomeStatement.term,
                statement: outcomeStatement.statement,
              }),
            ),
            candidates: input.candidates.map((candidate) =>
              this.buildCandidateRequest(candidate, input.activityNameById),
            ),
          },
        );

      if (response.groundingStatus === "FAILED") {
        return new Map();
      }

      const suggestionByProposalId = new Map<
        string,
        OutcomeEvidencePairingSuggestedOutcome
      >();
      for (const suggestion of response.suggestions) {
        if (
          suggestion.outcomeId !== null &&
          !outcomeStatementIds.has(suggestion.outcomeId)
        ) {
          this.logger.error(
            {
              projectId: input.projectId,
              candidateId: suggestion.candidateId,
              outcomeId: suggestion.outcomeId,
            },
            "outcome evidence pairing suggestion referenced an outcomeId outside this project; treating as uncertain",
          );
          suggestionByProposalId.set(suggestion.candidateId, {
            outcomeId: null,
            rationale: suggestion.rationale,
          });
          continue;
        }

        suggestionByProposalId.set(suggestion.candidateId, {
          outcomeId: suggestion.outcomeId,
          rationale: suggestion.rationale,
        });
      }

      return suggestionByProposalId;
    } catch (error) {
      this.logger.error(
        { err: error, projectId: input.projectId },
        "outcome evidence pairing suggestion call failed; candidates will be retried on the next request",
      );
      return new Map();
    }
  }

  private buildCandidateRequest(
    candidate: OutcomeEvidencePairingProposal,
    activityNameById: Map<string, string>,
  ) {
    if (candidate.shape === "paired_delta") {
      return {
        candidateId: candidate.proposalId,
        shape: "paired_delta" as const,
        beforeLabel: buildColumnLabel(candidate.beforeColumnName),
        afterLabel: buildColumnLabel(candidate.afterColumnName),
        activityLabel: [
          activityNameById.get(candidate.activityIdBefore) ??
            candidate.activityIdBefore,
          activityNameById.get(candidate.activityIdAfter) ??
            candidate.activityIdAfter,
        ]
          .filter((name, index, names) => names.indexOf(name) === index)
          .join(" / "),
      };
    }

    return {
      candidateId: candidate.proposalId,
      shape: "single_distribution" as const,
      categoryLabel: buildColumnLabel(candidate.categoryColumnName),
      activityLabel:
        activityNameById.get(candidate.activityId) ?? candidate.activityId,
    };
  }
}
