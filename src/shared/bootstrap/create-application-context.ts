import type { BackendConfig } from "../config/env.js";
import { createAuthenticateMiddleware } from "../auth/authenticate.js";
import { NoopTransactionManager } from "../database/transaction-manager.js";
import { ActivityController } from "../../modules/activity/activity.controller.js";
import { MongoActivityRepository } from "../../modules/activity/activity.mongo-repository.js";
import { ActivityService } from "../../modules/activity/activity.service.js";
import { ResultController } from "../../modules/ai/artifact/result.controller.js";
import { MongoAIArtifactRepository } from "../../modules/ai/artifact/ai-artifact.mongo-repository.js";
import { AIArtifactService } from "../../modules/ai/artifact/ai-artifact.service.js";
import { AIArtifactRecordService } from "../../modules/ai/artifact/ai-artifact-record.service.js";
import { ResultService } from "../../modules/ai/artifact/result.service.js";
import { AIContextService } from "../../modules/ai/context/ai-context.service.js";
import { AIExecutionRunnerService } from "../../modules/ai/execution/ai-execution-runner.service.js";
import { MongoAIExecutionRepository } from "../../modules/ai/execution/ai-execution.mongo-repository.js";
import { AIExecutionService } from "../../modules/ai/execution/ai-execution.service.js";
import { MockJobRunnerService } from "../../modules/ai/execution/mock-job-runner.service.js";
import {
  MockPipelineExecutionScheduler,
  ProcessingJobPipelineExecutionStore,
} from "../../modules/ai/execution/pipeline-execution-store.js";
import { ProcessingJobController } from "../../modules/ai/execution/processing-job.controller.js";
import { ProcessingJobService } from "../../modules/ai/execution/processing-job.service.js";
import { AIOrchestrationService } from "../../modules/ai/orchestration/ai-orchestration.service.js";
import { ChatPipeline } from "../../modules/ai/pipelines/chat.pipeline.js";
import { defaultAIPipelines } from "../../modules/ai/pipelines/pipeline-catalog.js";
import { GenerateDashboardPipeline } from "../../modules/ai/pipelines/generate-dashboard.pipeline.js";
import { GenerateInsightsPipeline } from "../../modules/ai/pipelines/generate-insights.pipeline.js";
import { GenerateMetricsPipeline } from "../../modules/ai/pipelines/generate-metrics.pipeline.js";
import { GenerateReportPipeline } from "../../modules/ai/pipelines/generate-report.pipeline.js";
import { InterpretDatasetPipeline } from "../../modules/ai/pipelines/interpret-dataset.pipeline.js";
import { AIPipelineRegistry } from "../../modules/ai/pipelines/pipeline-registry.js";
import { AIPipelineRuntimeRegistry } from "../../modules/ai/pipelines/pipeline-runtime-registry.js";
import { ReviewDatasetPipeline } from "../../modules/ai/pipelines/review-dataset.pipeline.js";
import { AIPromptService } from "../../modules/ai/prompts/ai-prompt.service.js";
import { defaultPromptTemplates } from "../../modules/ai/prompts/prompt-catalog.js";
import { PromptRegistry } from "../../modules/ai/prompts/prompt-registry.js";
import { MockAIProvider } from "../../modules/ai/providers/mock-ai-provider.js";
import { AIProviderRegistry } from "../../modules/ai/providers/provider-registry.js";
import { AuthController } from "../../modules/auth/auth.controller.js";
import { AuthService } from "../../modules/auth/auth.service.js";
import { HealthController } from "../../modules/health/health.controller.js";
import { OrganizationController } from "../../modules/organization/organization.controller.js";
import { MongoOrganizationRepository } from "../../modules/organization/organization.mongo-repository.js";
import { OrganizationService } from "../../modules/organization/organization.service.js";
import { ProjectController } from "../../modules/project/project.controller.js";
import { MongoProjectRepository } from "../../modules/project/project.mongo-repository.js";
import { ProjectService } from "../../modules/project/project.service.js";
import { ActivityUploadController } from "../../modules/upload/activity-upload.controller.js";
import { ActivityUploadService } from "../../modules/upload/activity-upload.service.js";
import { FileStorageService } from "../../modules/upload/file-storage.service.js";
import { MongoUploadMetadataRepository } from "../../modules/upload/upload-metadata.mongo-repository.js";
import { UploadMetadataController } from "../../modules/upload/upload-metadata.controller.js";
import { UploadMetadataService } from "../../modules/upload/upload-metadata.service.js";
import { MongoUserRepository } from "../../modules/user/user.mongo-repository.js";

export function createApplicationContext(config: BackendConfig) {
  const transactionManager = new NoopTransactionManager();
  const userRepository = new MongoUserRepository();
  const organizationRepository = new MongoOrganizationRepository();
  const projectRepository = new MongoProjectRepository();
  const activityRepository = new MongoActivityRepository();
  const uploadMetadataRepository = new MongoUploadMetadataRepository();
  const processingJobRepository = new MongoAIExecutionRepository();
  const resultRepository = new MongoAIArtifactRepository();

  const authService = new AuthService(
    config,
    userRepository,
    organizationRepository,
    transactionManager,
  );
  const fileStorageService = new FileStorageService(config.UPLOAD_DIR);
  const organizationService = new OrganizationService(
    organizationRepository,
    fileStorageService,
    projectRepository,
    activityRepository,
    uploadMetadataRepository,
    processingJobRepository,
    resultRepository,
    transactionManager,
  );
  const projectService = new ProjectService(
    projectRepository,
    organizationService,
    fileStorageService,
    activityRepository,
    uploadMetadataRepository,
    processingJobRepository,
    resultRepository,
    transactionManager,
  );
  const activityService = new ActivityService(
    activityRepository,
    projectService,
  );
  const uploadMetadataService = new UploadMetadataService(
    uploadMetadataRepository,
    projectService,
    activityService,
  );
  const aiExecutionService = new AIExecutionService(
    processingJobRepository,
    uploadMetadataRepository,
    projectService,
    activityService,
  );
  const processingJobService = new ProcessingJobService(aiExecutionService);
  const aiArtifactRecordService = new AIArtifactRecordService(
    resultRepository,
    uploadMetadataRepository,
    processingJobRepository,
    projectService,
    activityService,
  );
  const resultService = new ResultService(aiArtifactRecordService);
  const promptRegistry = new PromptRegistry(defaultPromptTemplates);
  const promptService = new AIPromptService(promptRegistry);
  const pipelineRegistry = new AIPipelineRegistry(defaultAIPipelines);
  const providerRegistry = new AIProviderRegistry([new MockAIProvider()]);
  const contextService = new AIContextService(
    projectService,
    activityService,
    organizationService,
    organizationRepository,
    uploadMetadataRepository,
  );
  const artifactService = new AIArtifactService(aiArtifactRecordService);
  const pipelineRuntimeRegistry = new AIPipelineRuntimeRegistry([
    new InterpretDatasetPipeline(
      pipelineRegistry.getByKey("interpret_dataset"),
      contextService,
      promptService,
      providerRegistry,
      config.AI_PROVIDER,
      config.AI_MODEL,
    ),
    new ReviewDatasetPipeline(
      pipelineRegistry.getByKey("review_dataset"),
      contextService,
      promptService,
      providerRegistry,
      config.AI_PROVIDER,
      config.AI_MODEL,
    ),
    new GenerateMetricsPipeline(
      pipelineRegistry.getByKey("generate_metrics"),
      contextService,
      promptService,
      providerRegistry,
      config.AI_PROVIDER,
      config.AI_MODEL,
    ),
    new GenerateDashboardPipeline(
      pipelineRegistry.getByKey("generate_dashboard"),
      contextService,
      promptService,
      providerRegistry,
      config.AI_PROVIDER,
      config.AI_MODEL,
    ),
    new GenerateInsightsPipeline(
      pipelineRegistry.getByKey("generate_insights"),
      contextService,
      promptService,
      providerRegistry,
      config.AI_PROVIDER,
      config.AI_MODEL,
    ),
    new GenerateReportPipeline(
      pipelineRegistry.getByKey("generate_report"),
      contextService,
      promptService,
      providerRegistry,
      config.AI_PROVIDER,
      config.AI_MODEL,
    ),
    new ChatPipeline(
      pipelineRegistry.getByKey("chat"),
      contextService,
      promptService,
      providerRegistry,
      config.AI_PROVIDER,
      config.AI_MODEL,
    ),
  ]);
  const executionRunnerService = new AIExecutionRunnerService(
    processingJobRepository,
    pipelineRuntimeRegistry,
    artifactService,
  );
  const mockJobRunnerService = new MockJobRunnerService(executionRunnerService);
  const pipelineExecutionStore = new ProcessingJobPipelineExecutionStore(
    aiExecutionService,
  );
  const pipelineExecutionScheduler = new MockPipelineExecutionScheduler(
    mockJobRunnerService,
  );
  const aiOrchestrationService = new AIOrchestrationService(
    promptRegistry,
    pipelineRegistry,
    pipelineExecutionStore,
    pipelineExecutionScheduler,
  );
  const activityUploadService = new ActivityUploadService(
    activityService,
    fileStorageService,
    uploadMetadataService,
    aiOrchestrationService,
  );

  return {
    authenticate: createAuthenticateMiddleware(authService),
    healthController: new HealthController(),
    authController: new AuthController(authService),
    organizationController: new OrganizationController(organizationService),
    projectController: new ProjectController(projectService),
    activityController: new ActivityController(activityService),
    activityUploadController: new ActivityUploadController(activityUploadService),
    uploadMetadataController: new UploadMetadataController(uploadMetadataService),
    processingJobController: new ProcessingJobController(processingJobService),
    resultController: new ResultController(resultService),
  };
}
