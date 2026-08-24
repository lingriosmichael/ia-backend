import { databaseSession } from "../../shared/database/databaseClient.js";
import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type {
  OutcomeTerm,
  ProjectOutcomeStatement,
} from "../../shared/contracts.js";
import type { ProjectDerivedStateInvalidationService } from "../project/projectDerivedStateInvalidationService.js";
import type { ProcessingResourceCleanupService } from "../processing/processingResourceCleanupService.js";
import type { ProjectOutcomeStatementRepository } from "./projectOutcomeStatementRepository.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "./projectOutcomeStatementPersistence.js";

// Locale-aware (not a plain toLowerCase()) so case-folding is correct for
// languages where they diverge (e.g. Turkish İ/i) — used as the single
// definition of "the same outcome statement" everywhere it's checked, so
// two independent call sites (project create/update, and lazily on
// project-outcome-statement list) can never disagree on what counts as a
// duplicate.
export function normalizeOutcomeStatementValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * Ensures a ProjectOutcomeStatement exists for every one of a project's
 * declared intended changes, without duplicating one that's already there
 * (by normalizeOutcomeStatementValue). Shared by ProjectService (called on
 * project create/update, side-effect only) and ProjectOutcomeStatementService
 * (called lazily on list, where the returned list is what the caller
 * actually wants) — previously two independent implementations of the same
 * rule with different case-folding, which could disagree on what counted as
 * a duplicate depending on which one ran first.
 */
export async function ensureOutcomeStatementsForIntendedChanges(
  projectOutcomeStatementRepository: ProjectOutcomeStatementRepository,
  input: {
    projectId: string;
    organizationId: string;
    intendedChanges: string[];
  },
  session: DatabaseSession,
): Promise<ProjectOutcomeStatementPersistenceRecord[]> {
  const normalizedIntendedChanges = input.intendedChanges
    .map((intendedChange) => intendedChange.trim())
    .filter((intendedChange) => intendedChange.length > 0);
  const existingRecords =
    await projectOutcomeStatementRepository.listByProjectId(
      input.projectId,
      session,
    );

  if (normalizedIntendedChanges.length === 0) {
    return existingRecords;
  }

  const existingStatementTexts = new Set(
    existingRecords.map((record) =>
      normalizeOutcomeStatementValue(record.statement),
    ),
  );
  const missingIntendedChanges = normalizedIntendedChanges.filter(
    (intendedChange) =>
      !existingStatementTexts.has(
        normalizeOutcomeStatementValue(intendedChange),
      ),
  );

  if (missingIntendedChanges.length === 0) {
    return existingRecords;
  }

  for (const intendedChange of missingIntendedChanges) {
    await projectOutcomeStatementRepository.create(
      {
        projectId: input.projectId,
        organizationId: input.organizationId,
        term: "long",
        statement: intendedChange,
      },
      session,
    );
  }

  return projectOutcomeStatementRepository.listByProjectId(
    input.projectId,
    session,
  );
}

export async function syncOutcomeStatementsForIntendedChanges(
  projectOutcomeStatementRepository: ProjectOutcomeStatementRepository,
  input: {
    projectId: string;
    organizationId: string;
    previousIntendedChanges: string[];
    intendedChanges: string[];
  },
  session: DatabaseSession,
): Promise<{
  records: ProjectOutcomeStatementPersistenceRecord[];
  deletedOutcomeStatementIds: string[];
}> {
  const currentIntendedChanges = input.intendedChanges
    .map((intendedChange) => intendedChange.trim())
    .filter((intendedChange) => intendedChange.length > 0);
  const previousIntendedChanges = input.previousIntendedChanges
    .map((intendedChange) => intendedChange.trim())
    .filter((intendedChange) => intendedChange.length > 0);
  const currentNormalized = new Set(
    currentIntendedChanges.map((intendedChange) =>
      normalizeOutcomeStatementValue(intendedChange),
    ),
  );
  const removedNormalized = new Set(
    previousIntendedChanges
      .map((intendedChange) => normalizeOutcomeStatementValue(intendedChange))
      .filter((intendedChange) => !currentNormalized.has(intendedChange)),
  );

  const existingRecords =
    await projectOutcomeStatementRepository.listByProjectId(
      input.projectId,
      session,
    );
  const recordsToDelete = existingRecords.filter((record) =>
    removedNormalized.has(normalizeOutcomeStatementValue(record.statement)),
  );

  for (const record of recordsToDelete) {
    await projectOutcomeStatementRepository.deleteById(record.id, session);
  }

  const records = await ensureOutcomeStatementsForIntendedChanges(
    projectOutcomeStatementRepository,
    {
      projectId: input.projectId,
      organizationId: input.organizationId,
      intendedChanges: currentIntendedChanges,
    },
    session,
  );

  return {
    records,
    deletedOutcomeStatementIds: recordsToDelete.map((record) => record.id),
  };
}

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
    private readonly processingResourceCleanupService?: ProcessingResourceCleanupService,
    private readonly projectDerivedStateInvalidationService?: ProjectDerivedStateInvalidationService,
  ) {}

  async listForProject(
    userId: string,
    projectId: string,
  ): Promise<ProjectOutcomeStatement[]> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );

    const records = await ensureOutcomeStatementsForIntendedChanges(
      this.projectOutcomeStatementRepository,
      {
        projectId: project.id,
        organizationId: project.organizationId,
        intendedChanges: project.intendedChanges ?? [],
      },
      databaseSession,
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
    await this.processingResourceCleanupService?.resetOutcomeEvidencePairingByProjectId(
      project.id,
      databaseSession,
    );
    await this.projectDerivedStateInvalidationService?.invalidateProject(
      project.id,
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
    await this.processingResourceCleanupService?.resetOutcomeEvidencePairingByProjectId(
      projectId,
      databaseSession,
    );
    await this.projectDerivedStateInvalidationService?.invalidateProject(
      projectId,
      databaseSession,
    );
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

    await this.processingResourceCleanupService?.deleteByOutcomeStatementIds(
      projectId,
      [existing.id],
      databaseSession,
    );
    await this.projectOutcomeStatementRepository.deleteById(
      existing.id,
      databaseSession,
    );
    await this.projectDerivedStateInvalidationService?.invalidateProject(
      projectId,
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
}
