import type { FastifyRequest } from "fastify";
import type { MultipartFields } from "@fastify/multipart";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import {
  idParamSchema,
  uploadDatasetRoleSchema,
} from "../../schemas/httpSchemas.js";
import { ActivityUploadService } from "./activityUploadService.js";
import { requireParam } from "../../shared/http/requireParam.js";

export class ActivityUploadController {
  constructor(private readonly activityUploadService: ActivityUploadService) {}

  async upload(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const file = await request.file();
    const datasetRole = parseDatasetRoleField(file?.fields.datasetRole);
    const response = await this.activityUploadService.uploadForActivity(
      auth.userId,
      requireParam(params, "activityId"),
      file,
      datasetRole,
    );

    return successResponse(response);
  }
}

// @fastify/multipart's own README: "the order of form fields is VERY
// IMPORTANT" — a value field is only guaranteed to be on file.fields at the
// moment request.file() resolves if it was sent *before* the file field in
// the multipart body. apiClient.ts's uploadActivityFile appends datasetRole
// before file for exactly this reason. datasetRole is optional: the two-slot
// classification step (evidence.tsx, outcome_evidence activity only) sends
// it; every other activity's plain upload omits it and the file lands
// unclassified (datasetRole: null).
function parseDatasetRoleField(
  field: MultipartFields[string],
): ReturnType<typeof uploadDatasetRoleSchema.parse> | null {
  const fieldPart = Array.isArray(field) ? field[0] : field;
  if (!fieldPart || fieldPart.type !== "field") {
    return null;
  }

  const rawValue =
    typeof fieldPart.value === "string"
      ? fieldPart.value
      : String(fieldPart.value ?? "");
  return rawValue ? uploadDatasetRoleSchema.parse(rawValue) : null;
}
