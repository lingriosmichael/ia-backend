import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  ProjectCreateInput,
  ProjectLlmTokenLedgerIncrement,
  ProjectPersistenceRecord,
  ProjectUpdateInput,
} from "./projectPersistence.js";

export interface ProjectRepository {
  create(
    input: ProjectCreateInput,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord>;
  findById(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord | null>;
  findDeleteContext(
    projectId: string,
    session: DatabaseSession,
  ): Promise<{
    id: string;
    name: string;
    organizationId: string;
  } | null>;
  update(
    projectId: string,
    input: ProjectUpdateInput,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord>;
  incrementLlmTokenLedger(
    projectId: string,
    increment: ProjectLlmTokenLedgerIncrement,
    session: DatabaseSession,
  ): Promise<void>;
  transferOwnership(
    projectId: string,
    newOwnerId: string,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord>;
  listByOrganization(
    organizationId: string,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord[]>;
  listByOrganizationForOwner(
    organizationId: string,
    ownerId: string,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord[]>;
  delete(
    projectId: string,
    session: DatabaseSession,
  ): Promise<{
    id: string;
    organizationId: string;
  }>;
}
