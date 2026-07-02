import type { OrganizationRole } from "../../shared/contracts.js";

export interface OrganizationPersistenceRecord {
  id: string;
  name: string;
  slug: string;
  mission: string | null;
  logoUrl: string | null;
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
  mission?: string | null;
  slug?: string;
  logoUrl?: string | null;
}

export interface OrganizationMembershipCreateInput {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
}
