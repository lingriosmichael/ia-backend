import type { DatabaseSession } from "../../shared/database/database-client.js";
import type {
  InvitationCreateInput,
  InvitationPersistenceRecord,
} from "./invitation.persistence.js";

export interface InvitationRepository {
  create(
    input: InvitationCreateInput,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord>;
  findPendingByEmail(
    organizationId: string,
    email: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null>;
  findByToken(
    token: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null>;
  listByOrganization(
    organizationId: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord[]>;
  markAccepted(
    invitationId: string,
    acceptedById: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord>;
  revoke(
    invitationId: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null>;
}
