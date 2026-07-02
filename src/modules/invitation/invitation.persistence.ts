export type InvitationStatus = "pending" | "accepted" | "revoked";

export interface InvitationPersistenceRecord {
  id: string;
  organizationId: string;
  email: string;
  role: "PROJECT_MANAGER";
  token: string;
  status: InvitationStatus;
  invitedById: string;
  acceptedById: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvitationCreateInput {
  organizationId: string;
  email: string;
  role: "PROJECT_MANAGER";
  token: string;
  invitedById: string;
}
