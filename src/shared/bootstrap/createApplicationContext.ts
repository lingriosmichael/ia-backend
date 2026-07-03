import type { BackendConfig } from "../config/env.js";
import { createEmailService } from "../email/createEmailService.js";
import {
  createAuthenticateIfPresentMiddleware,
  createAuthenticateMiddleware,
} from "../auth/authenticate.js";
import { AuthorizationService } from "../auth/authorizationService.js";
import { NoopTransactionManager } from "../database/transactionManager.js";
import { ActivityController } from "../../modules/activity/activityController.js";
import { MongoActivityRepository } from "../../modules/activity/activityMongoRepository.js";
import { ActivityService } from "../../modules/activity/activityService.js";
import { ResultController } from "../../modules/ai/artifact/resultController.js";
import { MongoAIArtifactRepository } from "../../modules/ai/artifact/aiArtifactMongoRepository.js";
import { AIArtifactService } from "../../modules/ai/artifact/aiArtifactService.js";
import { AIArtifactRecordService } from "../../modules/ai/artifact/aiArtifactRecordService.js";
import { ResultService } from "../../modules/ai/artifact/resultService.js";
import { AIContextService } from "../../modules/ai/context/aiContextService.js";
import { AIExecutionRunnerService } from "../../modules/ai/execution/aiExecutionRunnerService.js";
import { MongoAIExecutionRepository } from "../../modules/ai/execution/aiExecutionMongoRepository.js";
import { AIExecutionService } from "../../modules/ai/execution/aiExecutionService.js";
import { MockJobRunnerService } from "../../modules/ai/execution/mockJobRunnerService.js";
import {
  MockPipelineExecutionScheduler,
  ProcessingJobPipelineExecutionStore,
} from "../../modules/ai/execution/pipelineExecutionStore.js";
import { ProcessingJobController } from "../../modules/ai/execution/processingJobController.js";
import { ProcessingJobService } from "../../modules/ai/execution/processingJobService.js";
import { AIOrchestrationService } from "../../modules/ai/orchestration/aiOrchestrationService.js";
import { ChatPipeline } from "../../modules/ai/pipelines/chatPipeline.js";
import { defaultAIPipelines } from "../../modules/ai/pipelines/pipelineCatalog.js";
import { GenerateDashboardPipeline } from "../../modules/ai/pipelines/generateDashboardPipeline.js";
import { GenerateInsightsPipeline } from "../../modules/ai/pipelines/generateInsightsPipeline.js";
import { GenerateMetricsPipeline } from "../../modules/ai/pipelines/generateMetricsPipeline.js";
import { GenerateReportPipeline } from "../../modules/ai/pipelines/generateReportPipeline.js";
import { InterpretDatasetPipeline } from "../../modules/ai/pipelines/interpretDatasetPipeline.js";
import { AIPipelineRegistry } from "../../modules/ai/pipelines/pipelineRegistry.js";
import { AIPipelineRuntimeRegistry } from "../../modules/ai/pipelines/pipelineRuntimeRegistry.js";
import { ReviewDatasetPipeline } from "../../modules/ai/pipelines/reviewDatasetPipeline.js";
import { AIPromptService } from "../../modules/ai/prompts/aiPromptService.js";
import { defaultPromptTemplates } from "../../modules/ai/prompts/promptCatalog.js";
import { PromptRegistry } from "../../modules/ai/prompts/promptRegistry.js";
import { MockAIProvider } from "../../modules/ai/providers/mockAiProvider.js";
import { AIProviderRegistry } from "../../modules/ai/providers/providerRegistry.js";
import { AuthController } from "../../modules/auth/authController.js";
import { AuthService } from "../../modules/auth/authService.js";
import { HealthController } from "../../modules/health/healthController.js";
import { InvitationController } from "../../modules/invitation/invitationController.js";
import { MongoInvitationRepository } from "../../modules/invitation/invitationMongoRepository.js";
import { InvitationService } from "../../modules/invitation/invitationService.js";
import { OrganizationController } from "../../modules/organization/organizationController.js";
import { MongoOrganizationRepository } from "../../modules/organization/organizationMongoRepository.js";
import { OrganizationService } from "../../modules/organization/organizationService.js";
import { ProjectController } from "../../modules/project/projectController.js";
import { MongoProjectRepository } from "../../modules/project/projectMongoRepository.js";
import { ProjectService } from "../../modules/project/projectService.js";
import { ActivityUploadController } from "../../modules/upload/activityUploadController.js";
import { ActivityUploadService } from "../../modules/upload/activityUploadService.js";
import { FileStorageService } from "../../modules/upload/fileStorageService.js";
import { MongoUploadMetadataRepository } from "../../modules/upload/uploadMetadataMongoRepository.js";
import { UploadMetadataController } from "../../modules/upload/uploadMetadataController.js";
import { UploadMetadataService } from "../../modules/upload/uploadMetadataService.js";
import { MongoUserRepository } from "../../modules/user/userMongoRepository.js";

export function createApplicationContext(config: BackendConfig) {
  const transactionManager = new NoopTransactionManager();
  const emailService = createEmailService(config);
  const userRepository = new MongoUserRepository();
  const organizationRepository = new MongoOrganizationRepository();
  const invitationRepository = new MongoInvitationRepository();
  const projectRepository = new MongoProjectRepository();
  const activityRepository = new MongoActivityRepository();
  const uploadMetadataRepository = new MongoUploadMetadataRepository();
  const processingJobRepository = new MongoAIExecutionRepository();
  const resultRepository = new MongoAIArtifactRepository();
  const authorizationService = new AuthorizationService(
    organizationRepository,
    projectRepository,
    activityRepository,
  );

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
    authorizationService,
    userRepository,
  );
  const projectService = new ProjectService(
    projectRepository,
    authorizationService,
    fileStorageService,
    activityRepository,
    uploadMetadataRepository,
    processingJobRepository,
    resultRepository,
    transactionManager,
    userRepository,
  );
  const activityService = new ActivityService(
    activityRepository,
    authorizationService,
  );
  const uploadMetadataService = new UploadMetadataService(
    uploadMetadataRepository,
    activityService,
    authorizationService,
  );
  const aiExecutionService = new AIExecutionService(
    processingJobRepository,
    uploadMetadataRepository,
    authorizationService,
  );
  const processingJobService = new ProcessingJobService(aiExecutionService);
  const aiArtifactRecordService = new AIArtifactRecordService(
    resultRepository,
    uploadMetadataRepository,
    processingJobRepository,
    authorizationService,
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
    authorizationService,
  );
  const invitationService = new InvitationService(
    invitationRepository,
    organizationRepository,
    userRepository,
    authorizationService,
    transactionManager,
    emailService,
    config.WEBAPP_URL,
  );

  return {
    authenticate: createAuthenticateMiddleware(authService),
    authenticateIfPresent: createAuthenticateIfPresentMiddleware(authService),
    healthController: new HealthController(),
    authController: new AuthController(authService),
    invitationController: new InvitationController(invitationService),
    organizationController: new OrganizationController(organizationService),
    projectController: new ProjectController(projectService),
    activityController: new ActivityController(activityService),
    activityUploadController: new ActivityUploadController(activityUploadService),
    uploadMetadataController: new UploadMetadataController(uploadMetadataService),
    processingJobController: new ProcessingJobController(processingJobService),
    resultController: new ResultController(resultService),
  };
}
