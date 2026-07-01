import type { DatabaseSession } from "../../shared/database/database-client.js";
import type { OrganizationRole } from "../../shared/contracts.js";
import type {
  OrganizationCreateInput,
  OrganizationMembershipCreateInput,
  OrganizationMembershipPersistenceRecord,
  OrganizationPersistenceRecord,
  OrganizationUpdateInput,
} from "./organization.persistence.js";

export interface OrganizationRepository {
  slugExists(slug: string, session: DatabaseSession): Promise<boolean>;
  create(
    input: OrganizationCreateInput,
    session: DatabaseSession,
  ): Promise<OrganizationPersistenceRecord>;
  createMembership(
    input: OrganizationMembershipCreateInput,
    session: DatabaseSession,
  ): Promise<OrganizationMembershipPersistenceRecord>;
  listForUser(userId: string, session: DatabaseSession): Promise<Array<{
    role: OrganizationRole;
    organization: OrganizationPersistenceRecord;
  }>>;
  findMembership(
    userId: string,
    organizationId: string,
    session: DatabaseSession,
  ): Promise<OrganizationMembershipPersistenceRecord | null>;
  findById(
    organizationId: string,
    session: DatabaseSession,
  ): Promise<OrganizationPersistenceRecord | null>;
  update(
    organizationId: string,
    input: OrganizationUpdateInput,
    session: DatabaseSession,
  ): Promise<OrganizationPersistenceRecord>;
  findWorkspaceForUser(
    organizationId: string,
    userId: string,
    session: DatabaseSession,
  ): Promise<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoPath: string | null;
    createdAt: Date;
    updatedAt: Date;
    memberships: Array<{ role: OrganizationRole }>;
  } | null>;
}
