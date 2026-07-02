import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { AppError } from "../../shared/errors/appError.js";
import { InvitationMongoModel, type InvitationMongoHydratedDocument } from "./invitationModel.js";
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
    _session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord> {
    const document = await InvitationMongoModel.create({
      _id: createDocumentId(),
      ...input,
    });

    return toInvitationRecord(document) as InvitationPersistenceRecord;
  }

  async findPendingByEmail(
    organizationId: string,
    email: string,
    _session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null> {
    const document = await InvitationMongoModel.findOne({
      organizationId,
      email,
      status: "pending",
    }).exec();

    return toInvitationRecord(document);
  }

  async findByToken(
    token: string,
    _session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null> {
    const document = await InvitationMongoModel.findOne({ token }).exec();
    return toInvitationRecord(document);
  }

  async listByOrganization(
    organizationId: string,
    _session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord[]> {
    const documents = await InvitationMongoModel.find({ organizationId })
      .sort({ createdAt: -1 })
      .exec();

    return documents
      .map((document) => toInvitationRecord(document))
      .filter((document): document is InvitationPersistenceRecord => Boolean(document));
  }

  async markAccepted(
    invitationId: string,
    acceptedById: string,
    _session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord> {
    const document = await InvitationMongoModel.findByIdAndUpdate(
      invitationId,
      {
        $set: {
          status: "accepted",
          acceptedById,
          acceptedAt: new Date(),
        },
      },
      { new: true },
    ).exec();

    const record = toInvitationRecord(document);
    if (!record) {
      throw new AppError("Invitation not found.", 404, "invitation_not_found");
    }

    return record;
  }

  async revoke(
    invitationId: string,
    _session: DatabaseSession,
  ): Promise<InvitationPersistenceRecord | null> {
    const document = await InvitationMongoModel.findByIdAndUpdate(
      invitationId,
      {
        $set: {
          status: "revoked",
        },
      },
      { new: true },
    ).exec();

    return toInvitationRecord(document);
  }
}
