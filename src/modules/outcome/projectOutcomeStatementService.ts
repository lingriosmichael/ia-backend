import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type {
  OutcomeTerm,
  ProjectOutcomeStatement,
} from "../../shared/contracts.js";
import type { ProjectOutcomeStatementRepository } from "./projectOutcomeStatementRepository.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "./projectOutcomeStatementPersistence.js";

function mapProjectOutcomeStatement(
  record: ProjectOutcomeStatementPersistenceRecord,
): ProjectOutcomeStatement {
  return {
    id: record.id,
    projectId: record.projectId,
    organizationId: record.organizationId,
    term: record.term,
    statement: record.statement,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class ProjectOutcomeStatementService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly projectOutcomeStatementRepository: ProjectOutcomeStatementRepository,
  ) {}

  async listForProject(
    userId: string,
    projectId: string,
  ): Promise<ProjectOutcomeStatement[]> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );

    const records = await this.ensureOutcomeStatementsForIntendedChanges(
      project.id,
      project.organizationId,
      project.intendedChanges ?? [],
    );
    return records.map(mapProjectOutcomeStatement);
  }

  async create(
    userId: string,
    projectId: string,
    input: { term: OutcomeTerm; statement: string },
  ): Promise<ProjectOutcomeStatement> {
    const { project } = await this.authorizationService.canEditProject(
      userId,
      projectId,
    );

    const record = await this.projectOutcomeStatementRepository.create(
      {
        projectId: project.id,
        organizationId: project.organizationId,
        term: input.term,
        statement: input.statement,
      },
      databaseSession,
    );
    return mapProjectOutcomeStatement(record);
  }

  async update(
    userId: string,
    projectId: string,
    outcomeStatementId: string,
    input: { term?: OutcomeTerm; statement?: string },
  ): Promise<ProjectOutcomeStatement> {
    await this.authorizationService.canEditProject(userId, projectId);

    const existing = await this.requireOwnedStatement(
      projectId,
      outcomeStatementId,
    );

    const updated = await this.projectOutcomeStatementRepository.update(
      existing.id,
      input,
      databaseSession,
    );
    if (!updated) {
      throw new AppError(
        "This outcome statement was not found.",
        404,
        "project_outcome_statement_not_found",
      );
    }
    return mapProjectOutcomeStatement(updated);
  }

  async delete(
    userId: string,
    projectId: string,
    outcomeStatementId: string,
  ): Promise<ProjectOutcomeStatement> {
    await this.authorizationService.canEditProject(userId, projectId);

    const existing = await this.requireOwnedStatement(
      projectId,
      outcomeStatementId,
    );

    await this.projectOutcomeStatementRepository.deleteById(
      existing.id,
      databaseSession,
    );
    return mapProjectOutcomeStatement(existing);
  }

  // Confirms the statement exists AND belongs to the project in the URL —
  // outcomeStatementId alone would let a caller with edit access to *some*
  // project update/delete an outcome statement belonging to a project they
  // don't have access to, since Mongo _id lookups aren't scoped by
  // projectId on their own.
  private async requireOwnedStatement(
    projectId: string,
    outcomeStatementId: string,
  ): Promise<ProjectOutcomeStatementPersistenceRecord> {
    const existing = await this.projectOutcomeStatementRepository.findById(
      outcomeStatementId,
      databaseSession,
    );
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(
        "This outcome statement was not found.",
        404,
        "project_outcome_statement_not_found",
      );
    }
    return existing;
  }

  private async ensureOutcomeStatementsForIntendedChanges(
    projectId: string,
    organizationId: string,
    intendedChanges: string[],
  ): Promise<ProjectOutcomeStatementPersistenceRecord[]> {
    const normalizedIntendedChanges = intendedChanges
      .map((intendedChange) => intendedChange.trim())
      .filter((intendedChange) => intendedChange.length > 0);
    const existingRecords =
      await this.projectOutcomeStatementRepository.listByProjectId(
        projectId,
        databaseSession,
      );

    if (normalizedIntendedChanges.length === 0) {
      return existingRecords;
    }

    const existingStatementTexts = new Set(
      existingRecords.map((record) => record.statement.trim().toLowerCase()),
    );
    const missingIntendedChanges = normalizedIntendedChanges.filter(
      (intendedChange) =>
        !existingStatementTexts.has(intendedChange.toLowerCase()),
    );

    if (missingIntendedChanges.length === 0) {
      return existingRecords;
    }

    for (const intendedChange of missingIntendedChanges) {
      await this.projectOutcomeStatementRepository.create(
        {
          projectId,
          organizationId,
          term: "long",
          statement: intendedChange,
        },
        databaseSession,
      );
    }

    return this.projectOutcomeStatementRepository.listByProjectId(
      projectId,
      databaseSession,
    );
  }
}
