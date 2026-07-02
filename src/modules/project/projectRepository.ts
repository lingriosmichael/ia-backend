import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  ProjectCreateInput,
  ProjectPersistenceRecord,
  ProjectUpdateInput,
} from "./projectPersistence.js";

export interface ProjectRepository {
  slugExists(
    organizationId: string,
    slug: string,
    session: DatabaseSession,
  ): Promise<boolean>;
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
