import type {
  OrganizationRole,
  OrganizationSettings,
} from "../../shared/contracts.js";

export interface OrganizationPersistenceRecord {
  id: string;
  name: string;
  mission: string | null;
  logoUrl: string | null;
  settings: OrganizationSettings;
  createdAt: Date;
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
  mission?: string | null;
  settings: OrganizationSettings;
}

export interface OrganizationUpdateInput {
  name: string;
  mission: string | null;
  settings: OrganizationSettings;
  logoUrl?: string | null;
}

export interface OrganizationMembershipCreateInput {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
}
