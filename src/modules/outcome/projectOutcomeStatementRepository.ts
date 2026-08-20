import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  ProjectOutcomeStatementCreateInput,
  ProjectOutcomeStatementPersistenceRecord,
  ProjectOutcomeStatementUpdateInput,
} from "./projectOutcomeStatementPersistence.js";

export interface ProjectOutcomeStatementRepository {
  create(
    input: ProjectOutcomeStatementCreateInput,
    session: DatabaseSession,
  ): Promise<ProjectOutcomeStatementPersistenceRecord>;
  findById(
    outcomeStatementId: string,
    session: DatabaseSession,
  ): Promise<ProjectOutcomeStatementPersistenceRecord | null>;
  listByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectOutcomeStatementPersistenceRecord[]>;
  update(
    outcomeStatementId: string,
    input: ProjectOutcomeStatementUpdateInput,
    session: DatabaseSession,
  ): Promise<ProjectOutcomeStatementPersistenceRecord | null>;
  deleteById(
    outcomeStatementId: string,
    session: DatabaseSession,
  ): Promise<boolean>;
}
