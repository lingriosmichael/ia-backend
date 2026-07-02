import type { MultipartFile } from "@fastify/multipart";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/appError.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import {
  createOrganizationSchema,
  idParamSchema,
  updateOrganizationSchema,
} from "../../schemas/httpSchemas.js";
import { OrganizationService } from "./organizationService.js";

export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  async list(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const organizations = await this.organizationService.listForUser(
      request.auth.userId,
    );
    return successResponse(organizations);
  }

  async create(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const payload = createOrganizationSchema.parse(request.body);
    const organization = await this.organizationService.create(
      request.auth.userId,
      payload,
    );
    return successResponse(organization);
  }

  async update(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const { payload, logoFile } = request.isMultipart()
      ? await parseMultipartOrganizationUpdate(request)
      : {
          payload: updateOrganizationSchema.parse(request.body),
          logoFile: undefined,
        };
    const organization = await this.organizationService.update(
      request.auth.userId,
      params.organizationId!,
      {
        ...payload,
        logoFile,
      },
    );
    return successResponse(organization);
  }

  async getWorkspace(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const workspace = await this.organizationService.getWorkspace(
      request.auth.userId,
      params.organizationId!,
    );
    return successResponse(workspace);
  }

  async listMembers(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const members = await this.organizationService.listMembers(
      request.auth.userId,
      params.organizationId!,
    );
    return successResponse(members);
  }

  async removeMember(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const removedMember = await this.organizationService.removeMember(
      request.auth.userId,
      params.organizationId!,
      params.membershipId!,
    );
    return successResponse(removedMember);
  }

  async getLogo(request: FastifyRequest, reply: FastifyReply) {
    const params = idParamSchema.parse(request.params);
    const logo = await this.organizationService.getLogo(params.organizationId!);

    return reply
      .type(logo.contentType)
      .header("cache-control", "public, max-age=3600")
      .send(logo.buffer);
  }
}

async function parseMultipartOrganizationUpdate(request: FastifyRequest): Promise<{
  payload: ReturnType<typeof updateOrganizationSchema.parse>;
  logoFile?: MultipartFile;
}> {
  const fields: Record<string, string | undefined> = {};
  let logoFile: MultipartFile | undefined;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "logo") {
        throw new AppError("Unexpected file field.", 400, "unexpected_file_field");
      }

      logoFile = part;
      continue;
    }

    fields[part.fieldname] =
      typeof part.value === "string" ? part.value : String(part.value);
  }

  return {
    payload: updateOrganizationSchema.parse({
      name: fields.name,
      mission: fields.mission ?? fields.description,
      description: fields.description,
    }),
    logoFile,
  };
}
