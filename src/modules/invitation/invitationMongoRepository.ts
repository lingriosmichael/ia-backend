import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import {
  InvitationMongoModel,
  type InvitationMongoHydratedDocument,
} from "./invitationModel.js";
import type { InvitationRepository } from "./invitationRepository.js";
import type {
  InvitationCreateInput,
  InvitationPersistenceRecord,
} from "./invitationPersistence.js";

function toInvitationRecord(
  document: InvitationMongoHydratedDocument | null,
): InvitationPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    email: document.email,
    role: document.role,
    token: document.token,
    status: document.status,
    invitedById: document.invitedById,
    acceptedById: document.acceptedById ?? null,
    acceptedAt: document.acceptedAt ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoInvitationRepository implements InvitationRepository {
  async create(
    input: InvitationCreateInput,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord> {
    const [document] = await InvitationMongoModel.create(
      [
        {
          _id: createDocumentId(),
          ...input,
        },
      ],
      getMongoSessionOptions(session),
    );

    return toInvitationRecord(document) as InvitationPersistenceRecord;
  }

  async findById(
    invitationId: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null> {
    const document = await applyMongoSession(
      InvitationMongoModel.findById(invitationId),
      session,
    ).exec();
    return toInvitationRecord(document);
  }

  async findPendingByEmail(
    organizationId: string,
    email: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null> {
    const document = await applyMongoSession(
      InvitationMongoModel.findOne({
        organizationId,
        email,
        status: "pending",
      }),
      session,
    ).exec();

    return toInvitationRecord(document);
  }

  async findByToken(
    token: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null> {
    const document = await applyMongoSession(
      InvitationMongoModel.findOne({ token }),
      session,
    ).exec();
    return toInvitationRecord(document);
  }

  async listByOrganization(
    organizationId: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord[]> {
    const documents = await applyMongoSession(
      InvitationMongoModel.find({ organizationId }).sort({ createdAt: -1 }),
      session,
    ).exec();

    return documents
      .map((document) => toInvitationRecord(document))
      .filter((document): document is InvitationPersistenceRecord =>
        Boolean(document),
      );
  }

  async markAccepted(
    invitationId: string,
    acceptedById: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null> {
    // Atomic conditional update: only an invitation still "pending" can be
    // accepted, so two concurrent accept requests for the same token can't
    // both succeed — the second gets null and the caller turns that into a
    // clean 409 instead of silently double-accepting.
    const document = await applyMongoSession(
      InvitationMongoModel.findOneAndUpdate(
        { _id: invitationId, status: "pending" },
        {
          $set: {
            status: "accepted",
            acceptedById,
            acceptedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      ),
      session,
    ).exec();

    return toInvitationRecord(document);
  }

  async revoke(
    invitationId: string,
    session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null> {
    const document = await applyMongoSession(
      InvitationMongoModel.findByIdAndUpdate(
        invitationId,
        {
          $set: {
            status: "revoked",
          },
        },
        { returnDocument: "after" },
      ),
      session,
    ).exec();

    return toInvitationRecord(document);
  }
}
