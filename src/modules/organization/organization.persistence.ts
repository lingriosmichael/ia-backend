import type { OrganizationRole } from "../../shared/contracts.js";

export interface OrganizationPersistenceRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoPath: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMembershipPersistenceRecord {
  id: string;
  userId: string;
  organizationId: string;
  role: OrganizationRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationCreateInput {
  name: string;
  slug: string;
}

export interface OrganizationUpdateInput {
  name?: string;
  description?: string | null;
  slug?: string;
  logoPath?: string | null;
}

export interface OrganizationMembershipCreateInput {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
}
