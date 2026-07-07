import type { MultipartFile } from "@fastify/multipart";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/appError.js";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
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
    const auth = requireAuthenticatedUser(request);

    const organizations = await this.organizationService.listForUser(
      auth.userId,
    );
    return successResponse(organizations);
  }

  async create(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const payload = createOrganizationSchema.parse(request.body);
    const organization = await this.organizationService.create(
      auth.userId,
      payload,
    );
    return successResponse(organization);
  }

  async update(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const { payload, logoFile } = request.isMultipart()
      ? await parseMultipartOrganizationUpdate(request)
      : {
          payload: updateOrganizationSchema.parse(request.body),
          logoFile: undefined,
        };
    const organization = await this.organizationService.update(
      auth.userId,
      params.organizationId!,
      {
        ...payload,
        logoFile,
      },
    );
    return successResponse(organization);
  }

  async getWorkspace(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const workspace = await this.organizationService.getWorkspace(
      auth.userId,
      params.organizationId!,
    );
    return successResponse(workspace);
  }

  async listMembers(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const members = await this.organizationService.listMembers(
      auth.userId,
      params.organizationId!,
    );
    return successResponse(members);
  }

  async removeMember(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const removedMember = await this.organizationService.removeMember(
      auth.userId,
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

async function parseMultipartOrganizationUpdate(
  request: FastifyRequest,
): Promise<{
  payload: ReturnType<typeof updateOrganizationSchema.parse>;
  logoFile?: MultipartFile;
}> {
  const fields: Record<string, string | undefined> = {};
  let logoFile: MultipartFile | undefined;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "logo") {
        throw new AppError(
          "Unexpected file field.",
          400,
          "unexpected_file_field",
        );
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
      mission: fields.mission,
      settings: {
        organizationName: fields.organizationName ?? fields.name,
        legalForm: parseNullableStringField(fields.legalForm),
        foundingYear: parseNullableIntegerField(fields.foundingYear),
        country: parseNullableStringField(fields.country),
        employeeCount: parseNullableIntegerField(fields.employeeCount),
        mission: parseNullableStringField(fields.mission),
        activityAreas: parseStringArrayField(fields.activityAreas),
        targetGroups: parseStringArrayField(fields.targetGroups),
        operatingRegions: parseStringArrayField(fields.operatingRegions),
        isRecognizedNonProfit: parseNullableBooleanField(
          fields.isRecognizedNonProfit,
        ),
        taxExemptionValidFrom: parseNullableStringField(
          fields.taxExemptionValidFrom,
        ),
      },
    }),
    logoFile,
  };
}

function parseNullableStringField(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  return value.trim() ? value : null;
}

function parseNullableIntegerField(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (!value.trim()) {
    return null;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue)) {
    throw new AppError(
      "Expected a numeric field.",
      400,
      "invalid_numeric_field",
    );
  }

  return parsedValue;
}

function parseStringArrayField(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (!value.trim()) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(value) as unknown;
    if (!Array.isArray(parsedValue)) {
      throw new Error("Expected array");
    }

    return parsedValue.map((entry) => String(entry));
  } catch {
    throw new AppError("Expected an array field.", 400, "invalid_array_field");
  }
}

function parseNullableBooleanField(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (!value.trim()) {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new AppError("Expected a boolean field.", 400, "invalid_boolean_field");
}
