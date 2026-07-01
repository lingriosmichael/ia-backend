import { databaseSession } from "../../../shared/database/database-client.js";
import { AppError } from "../../../shared/errors/app-error.js";
import type { OrganizationRepository } from "../../organization/organization.repository.js";
import { OrganizationService } from "../../organization/organization.service.js";
import { ProjectService } from "../../project/project.service.js";
import type { UploadMetadataRepository } from "../../upload/upload-metadata.repository.js";
import { ActivityService } from "../../activity/activity.service.js";
import type {
  ActivityContext,
  AIContextKind,
  AIContextObject,
  ChatContext,
  DatasetContext,
  OrganizationContext,
  ProjectContext,
  ReportContext,
} from "./ai-context.types.js";

export interface BuildExecutionContextsInput {
  userId: string;
  projectId: string;
  activityId?: string | null;
  uploadMetadataId?: string | null;
  requiredContextKinds: AIContextKind[];
  reportContext?: Omit<ReportContext, "kind">;
  chatContext?: Omit<ChatContext, "kind">;
}

export class AIContextService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly activityService: ActivityService,
    private readonly organizationService: OrganizationService,
    private readonly organizationRepository: OrganizationRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
  ) {}

  async buildProjectContext(
    userId: string,
    projectId: string,
  ): Promise<ProjectContext> {
    const project = await this.projectService.getById(userId, projectId);

    return {
      kind: "project",
      projectId: project.id,
      organizationId: project.organizationId,
      name: project.name,
      description: project.description,
      programGoal: project.programGoal,
      country: project.country,
      regionCity: project.regionCity,
      sdgs: project.sdgs,
      targetBeneficiaries: project.targetBeneficiaries,
    };
  }

  async buildActivityContext(
    userId: string,
    activityId: string,
  ): Promise<ActivityContext> {
    const activity = await this.activityService.getById(userId, activityId);

    return {
      kind: "activity",
      activityId: activity.id,
      projectId: activity.projectId,
      name: activity.name,
      description: activity.description,
      objectives: activity.objectives,
      expectedOutcomes: activity.expectedOutcomes,
    };
  }

  async buildOrganizationContext(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationContext> {
    await this.organizationService.requireMembership(userId, organizationId);
    const organization = await this.organizationRepository.findById(
      organizationId,
      databaseSession,
    );

    if (!organization) {
      throw new AppError(
        "Organization not found.",
        404,
        "organization_not_found",
      );
    }

    return {
      kind: "organization",
      organizationId: organization.id,
      name: organization.name,
      description: organization.description,
    };
  }

  async buildDatasetContext(
    userId: string,
    uploadMetadataId: string,
  ): Promise<DatasetContext> {
    const upload = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );

    if (!upload) {
      throw new AppError("Upload metadata not found.", 404, "upload_metadata_not_found");
    }

    await this.projectService.getById(userId, upload.projectId);

    return {
      kind: "dataset",
      uploadId: upload.id,
      projectId: upload.projectId,
      activityId: upload.activityId,
      organizationId: upload.organizationId,
      originalFileName: upload.originalFileName,
      contentType: upload.contentType,
      sizeBytes: upload.sizeBytes,
      storageKey: upload.storageKey,
      columns: [],
    };
  }

  buildReportContext(input: Omit<ReportContext, "kind">): ReportContext {
    return {
      kind: "report",
      ...input,
    };
  }

  buildChatContext(input: Omit<ChatContext, "kind">): ChatContext {
    return {
      kind: "chat",
      ...input,
    };
  }

  async buildExecutionContexts(
    input: BuildExecutionContextsInput,
  ): Promise<AIContextObject[]> {
    const contexts: AIContextObject[] = [];

    for (const contextKind of input.requiredContextKinds) {
      if (contextKind === "project") {
        contexts.push(await this.buildProjectContext(input.userId, input.projectId));
        continue;
      }

      if (contextKind === "activity") {
        if (!input.activityId) {
          throw new AppError(
            "An activity context is required for this AI pipeline.",
            400,
            "activity_context_required",
          );
        }

        contexts.push(await this.buildActivityContext(input.userId, input.activityId));
        continue;
      }

      if (contextKind === "dataset") {
        if (!input.uploadMetadataId) {
          throw new AppError(
            "A dataset context is required for this AI pipeline.",
            400,
            "dataset_context_required",
          );
        }

        contexts.push(await this.buildDatasetContext(input.userId, input.uploadMetadataId));
        continue;
      }

      if (contextKind === "organization") {
        const projectContext = await this.buildProjectContext(input.userId, input.projectId);
        contexts.push(
          await this.buildOrganizationContext(
            input.userId,
            projectContext.organizationId,
          ),
        );
        continue;
      }

      if (contextKind === "report") {
        if (!input.reportContext) {
          throw new AppError(
            "A report context is required for this AI pipeline.",
            400,
            "report_context_required",
          );
        }

        contexts.push(this.buildReportContext(input.reportContext));
        continue;
      }

      if (contextKind === "chat") {
        if (!input.chatContext) {
          throw new AppError(
            "A chat context is required for this AI pipeline.",
            400,
            "chat_context_required",
          );
        }

        contexts.push(this.buildChatContext(input.chatContext));
      }
    }

    return contexts;
  }
}
