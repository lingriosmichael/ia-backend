import type { DatabaseSession } from "../../shared/database/database-client.js";
import { createDocumentId } from "../../shared/database/document-id.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  MembershipMongoModel,
  type MembershipMongoHydratedDocument,
} from "./membership.model.js";
import {
  OrganizationMongoModel,
  type OrganizationMongoHydratedDocument,
} from "./organization.model.js";
import type { OrganizationRepository } from "./organization.repository.js";
import type {
  OrganizationCreateInput,
  OrganizationMembershipCreateInput,
  OrganizationMembershipPersistenceRecord,
  OrganizationPersistenceRecord,
  OrganizationUpdateInput,
} from "./organization.persistence.js";

function normalizeMembershipRole(role: string): OrganizationMembershipPersistenceRecord["role"] {
  if (role === "owner") {
    return "ORGANIZATION_ADMIN";
  }

  if (role === "member") {
    return "PROJECT_MANAGER";
  }

  return role as OrganizationMembershipPersistenceRecord["role"];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toOrganizationRecord(
  document: OrganizationMongoHydratedDocument | null,
): OrganizationPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    name: document.name,
    slug: document.slug,
    mission: document.mission ?? document.description ?? null,
    logoUrl: document.logoUrl ?? document.logoPath ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toMembershipRecord(
  document: MembershipMongoHydratedDocument | null,
): OrganizationMembershipPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    userId: document.userId,
    organizationId: document.organizationId,
    role: normalizeMembershipRole(document.role),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoOrganizationRepository implements OrganizationRepository {
  async slugExists(slug: string, _session: DatabaseSession): Promise<boolean> {
    const count = await OrganizationMongoModel.countDocuments({ slug }).exec();
    return count > 0;
  }

  async nameExists(
    name: string,
    _session: DatabaseSession,
    options?: { excludeOrganizationId?: string },
  ): Promise<boolean> {
    const count = await OrganizationMongoModel.countDocuments({
      ...(options?.excludeOrganizationId
        ? { _id: { $ne: options.excludeOrganizationId } }
        : {}),
      name: {
        $regex: `^${escapeRegex(name.trim())}$`,
        $options: "i",
      },
    }).exec();

    return count > 0;
  }

  async create(
    input: OrganizationCreateInput,
    _session: DatabaseSession,
  ): Promise<OrganizationPersistenceRecord> {
    const document = await OrganizationMongoModel.create({
      _id: createDocumentId(),
      ...input,
    });
    return toOrganizationRecord(document) as OrganizationPersistenceRecord;
  }

  async createMembership(
    input: OrganizationMembershipCreateInput,
    _session: DatabaseSession,
  ): Promise<OrganizationMembershipPersistenceRecord> {
    const document = await MembershipMongoModel.create({
      _id: createDocumentId(),
      ...input,
    });
    return toMembershipRecord(document) as OrganizationMembershipPersistenceRecord;
  }

  async listForUser(
    userId: string,
    _session: DatabaseSession,
  ): Promise<Array<{
    role: OrganizationMembershipPersistenceRecord["role"];
    organization: OrganizationPersistenceRecord;
  }>> {
    const membershipDocuments = await MembershipMongoModel.find({ userId })
      .sort({ createdAt: -1 })
      .exec();

    if (membershipDocuments.length === 0) {
      return [];
    }

    const organizationDocuments = await OrganizationMongoModel.find({
      _id: {
        $in: membershipDocuments.map((membership) => membership.organizationId),
      },
    }).exec();

    const organizationsById = new Map(
      organizationDocuments.map((organization) => [
        organization._id.toString(),
        toOrganizationRecord(organization),
      ]),
    );

    return membershipDocuments
      .map((membership) => {
        const organization = organizationsById.get(membership.organizationId) ?? null;
        if (!organization) {
          return null;
        }

        return {
          role: normalizeMembershipRole(membership.role),
          organization,
        };
      })
      .filter(
        (
          membership,
        ): membership is {
          role: OrganizationMembershipPersistenceRecord["role"];
          organization: OrganizationPersistenceRecord;
        } => Boolean(membership),
      );
  }

  async findMembership(
    userId: string,
    organizationId: string,
    _session: DatabaseSession,
  ): Promise<OrganizationMembershipPersistenceRecord | null> {
    const document = await MembershipMongoModel.findOne({
      userId,
      organizationId,
    }).exec();

    return toMembershipRecord(document);
  }

  async listMembershipsByOrganization(
    organizationId: string,
    _session: DatabaseSession,
  ): Promise<OrganizationMembershipPersistenceRecord[]> {
    const documents = await MembershipMongoModel.find({ organizationId })
      .sort({ createdAt: 1 })
      .exec();

    return documents
      .map((document) => toMembershipRecord(document))
      .filter((document): document is OrganizationMembershipPersistenceRecord => Boolean(document));
  }

  async deleteMembership(
    membershipId: string,
    _session: DatabaseSession,
  ): Promise<void> {
    await MembershipMongoModel.findByIdAndDelete(membershipId).exec();
  }

  async findById(
    organizationId: string,
    _session: DatabaseSession,
  ): Promise<OrganizationPersistenceRecord | null> {
    const document = await OrganizationMongoModel.findById(organizationId).exec();
    return toOrganizationRecord(document);
  }

  async update(
    organizationId: string,
    input: OrganizationUpdateInput,
    _session: DatabaseSession,
  ): Promise<OrganizationPersistenceRecord> {
    const document = await OrganizationMongoModel.findByIdAndUpdate(
      organizationId,
      {
        $set: input,
      },
      {
        new: true,
      },
    ).exec();

    const record = toOrganizationRecord(document);
    if (!record) {
      throw new AppError("Organization not found.", 404, "organization_not_found");
    }

    return record;
  }

  async findWorkspaceForUser(
    organizationId: string,
    userId: string,
    _session: DatabaseSession,
  ): Promise<{
    id: string;
    name: string;
    slug: string;
    mission: string | null;
    logoUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
    memberships: Array<{ role: OrganizationMembershipPersistenceRecord["role"] }>;
  } | null> {
    const membership = await MembershipMongoModel.findOne({
      organizationId,
      userId,
    }).exec();

    if (!membership) {
      return null;
    }

    const organization = await OrganizationMongoModel.findById(organizationId).exec();
    if (!organization) {
      return null;
    }

    return {
      ...(toOrganizationRecord(organization) as OrganizationPersistenceRecord),
      memberships: [{ role: normalizeMembershipRole(membership.role) }],
    };
  }
}
