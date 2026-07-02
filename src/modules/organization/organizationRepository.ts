import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { OrganizationRole } from "../../shared/contracts.js";
import type {
  OrganizationCreateInput,
  OrganizationMembershipCreateInput,
  OrganizationMembershipPersistenceRecord,
  OrganizationPersistenceRecord,
  OrganizationUpdateInput,
} from "./organizationPersistence.js";

export interface OrganizationRepository {
  slugExists(slug: string, session: DatabaseSession): Promise<boolean>;
  nameExists(
    name: string,
    session: DatabaseSession,
    options?: { excludeOrganizationId?: string },
  ): Promise<boolean>;
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
  listMembershipsByOrganization(
    organizationId: string,
    session: DatabaseSession,
  ): Promise<OrganizationMembershipPersistenceRecord[]>;
  deleteMembership(
    membershipId: string,
    session: DatabaseSession,
  ): Promise<void>;
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
    mission: string | null;
    logoUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
    memberships: Array<{ role: OrganizationRole }>;
  } | null>;
}
