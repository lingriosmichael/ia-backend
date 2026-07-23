import type { FastifyBaseLogger } from "fastify";
import type { BackendConfig } from "../config/env.js";
import { createEmailService } from "../email/createEmailService.js";
import {
  createAuthenticateIfPresentMiddleware,
  createAuthenticateMiddleware,
} from "../auth/authenticate.js";
import { AuthorizationService } from "../auth/authorizationService.js";
import { createRequireInternalServiceSecretMiddleware } from "../auth/requireInternalServiceSecret.js";
import { MongoTransactionManager } from "../database/transactionManager.js";
import { ActivityController } from "../../modules/activity/activityController.js";
import { MongoActivityRepository } from "../../modules/activity/activityMongoRepository.js";
import { ActivityService } from "../../modules/activity/activityService.js";
import { AnalyticsController } from "../../modules/analytics/analyticsController.js";
import { AnalyticsExecutionService } from "../../modules/analytics/analyticsExecutionService.js";
import { MongoAnalyticsExecutionRepository } from "../../modules/analytics/analyticsExecutionMongoRepository.js";
import { AnalyticsQueryService } from "../../modules/analytics/analyticsQueryService.js";
import { MongoAnalyticsDashboardEventRepository } from "../../modules/analytics/analyticsDashboardEventMongoRepository.js";
import { MongoAnalyticsResultRepository } from "../../modules/analytics/analyticsResultMongoRepository.js";
import { AnalyticsDashboardExportService } from "../../modules/analytics/analyticsDashboardExportService.js";
import { AnalyticsDashboardEventService } from "../../modules/analytics/analyticsDashboardEventService.js";
import { MongoAnalyticsDashboardPreferenceRepository } from "../../modules/analytics/analyticsDashboardPreferenceMongoRepository.js";
import { AnalyticsDashboardPreferenceService } from "../../modules/analytics/analyticsDashboardPreferenceService.js";
import { ProjectDerivedStateInvalidationService } from "../../modules/analytics/projectDerivedStateInvalidationService.js";
import { DashboardCatalogAssemblerService } from "../../modules/analytics/dashboardCatalogAssemblerService.js";
import { AnalyticsDashboardBuilderService } from "../../modules/analytics/analyticsDashboardBuilderService.js";
import { PythonAnalyticsCurationClient } from "../../modules/analytics/pythonAnalyticsCurationClient.js";
import { MongoProcessingJobRepository } from "../../modules/ai/execution/processingJobMongoRepository.js";
import { ProcessingJobController } from "../../modules/ai/execution/processingJobController.js";
import { ProcessingJobService } from "../../modules/ai/execution/processingJobService.js";
import { AuthController } from "../../modules/auth/authController.js";
import { AuthService } from "../../modules/auth/authService.js";
import { HealthController } from "../../modules/health/healthController.js";
import { InvitationController } from "../../modules/invitation/invitationController.js";
import { MongoInvitationRepository } from "../../modules/invitation/invitationMongoRepository.js";
import { InvitationService } from "../../modules/invitation/invitationService.js";
import { InterpretationArtifactService } from "../../modules/interpretation/interpretationArtifactService.js";
import { InterpretationController } from "../../modules/interpretation/interpretationController.js";
import { MongoDeterministicAnalysisRepository } from "../../modules/interpretation/deterministicAnalysisMongoRepository.js";
import { MongoDatasetPreparationRepository } from "../../modules/interpretation/datasetPreparationMongoRepository.js";
import { DatasetPreparationService } from "../../modules/interpretation/datasetPreparationService.js";
import { DeterministicAnalysisService } from "../../modules/interpretation/deterministicAnalysisService.js";
import { MongoInterpretationResultRepository } from "../../modules/interpretation/interpretationResultMongoRepository.js";
import { InterpretationService } from "../../modules/interpretation/interpretationService.js";
import { QuantitativeInterpretationSynthesisService } from "../../modules/interpretation/quantitativeInterpretationSynthesisService.js";
import { MongoKnowledgeEntityRepository } from "../../modules/knowledge/knowledgeEntityMongoRepository.js";
import { MongoKnowledgeIndicatorRepository } from "../../modules/knowledge/knowledgeIndicatorMongoRepository.js";
import { MongoProjectKnowledgeModelRepository } from "../../modules/knowledge/projectKnowledgeModelMongoRepository.js";
import { ProjectKnowledgeBuilderService } from "../../modules/knowledge/projectKnowledgeBuilderService.js";
import { OrganizationController } from "../../modules/organization/organizationController.js";
import { MongoOrganizationRepository } from "../../modules/organization/organizationMongoRepository.js";
import { OrganizationService } from "../../modules/organization/organizationService.js";
import { EvidenceProcessingService } from "../../modules/processing/evidenceProcessingService.js";
import { EvidenceProcessingArtifactService } from "../../modules/processing/evidenceProcessingArtifactService.js";
import { MongoParsedRepresentationRepository } from "../../modules/processing/parsedRepresentationMongoRepository.js";
import { PrivacyReviewController } from "../../modules/processing/privacyReviewController.js";
import { MongoPrivacyReviewRepository } from "../../modules/processing/privacyReviewMongoRepository.js";
import { PrivacyReviewService } from "../../modules/processing/privacyReviewService.js";
import { MongoPrivacySafeRepresentationRepository } from "../../modules/processing/privacySafeRepresentationMongoRepository.js";
import { ProcessingResourceCleanupService } from "../../modules/processing/processingResourceCleanupService.js";
import { PythonProcessingClient } from "../../modules/processing/pythonProcessingClient.js";
import { ProjectController } from "../../modules/project/projectController.js";
import { ProjectLlmTokenLedgerService } from "../../modules/project/projectLlmTokenLedgerService.js";
import { MongoProjectRepository } from "../../modules/project/projectMongoRepository.js";
import { ProjectService } from "../../modules/project/projectService.js";
import { ActivityUploadController } from "../../modules/upload/activityUploadController.js";
import { ActivityUploadService } from "../../modules/upload/activityUploadService.js";
import { FileStorageService } from "../../modules/upload/fileStorageService.js";
import { MongoUploadMetadataRepository } from "../../modules/upload/uploadMetadataMongoRepository.js";
import { UploadMetadataController } from "../../modules/upload/uploadMetadataController.js";
import { UploadMetadataService } from "../../modules/upload/uploadMetadataService.js";
import { MongoUserRepository } from "../../modules/user/userMongoRepository.js";

export function createApplicationContext(
  config: BackendConfig,
  logger: FastifyBaseLogger,
) {
  const transactionManager = new MongoTransactionManager();
  const emailService = createEmailService(config);
  const userRepository = new MongoUserRepository();
  const organizationRepository = new MongoOrganizationRepository();
  const invitationRepository = new MongoInvitationRepository();
  const projectRepository = new MongoProjectRepository();
  const activityRepository = new MongoActivityRepository();
  const uploadMetadataRepository = new MongoUploadMetadataRepository();
  const processingJobRepository = new MongoProcessingJobRepository();
  const parsedRepresentationRepository =
    new MongoParsedRepresentationRepository();
  const privacyReviewRepository = new MongoPrivacyReviewRepository();
  const privacySafeRepresentationRepository =
    new MongoPrivacySafeRepresentationRepository();
  const interpretationResultRepository =
    new MongoInterpretationResultRepository();
  const datasetPreparationRepository = new MongoDatasetPreparationRepository();
  const deterministicAnalysisRepository =
    new MongoDeterministicAnalysisRepository();
  const projectKnowledgeModelRepository =
    new MongoProjectKnowledgeModelRepository();
  const knowledgeEntityRepository = new MongoKnowledgeEntityRepository();
  const knowledgeIndicatorRepository = new MongoKnowledgeIndicatorRepository();
  const analyticsExecutionRepository = new MongoAnalyticsExecutionRepository();
  const analyticsResultRepository = new MongoAnalyticsResultRepository();
  const analyticsDashboardEventRepository =
    new MongoAnalyticsDashboardEventRepository();
  const analyticsDashboardPreferenceRepository =
    new MongoAnalyticsDashboardPreferenceRepository();
  const projectDerivedStateInvalidationService =
    new ProjectDerivedStateInvalidationService(
      projectKnowledgeModelRepository,
      analyticsExecutionRepository,
      analyticsResultRepository,
      analyticsDashboardPreferenceRepository,
    );
  const projectKnowledgeBuilderService = new ProjectKnowledgeBuilderService(
    projectRepository,
    activityRepository,
    uploadMetadataRepository,
    interpretationResultRepository,
    projectKnowledgeModelRepository,
    knowledgeEntityRepository,
    knowledgeIndicatorRepository,
  );
  const processingResourceCleanupService = new ProcessingResourceCleanupService(
    parsedRepresentationRepository,
    privacyReviewRepository,
    privacySafeRepresentationRepository,
    interpretationResultRepository,
    datasetPreparationRepository,
    deterministicAnalysisRepository,
    projectKnowledgeModelRepository,
    knowledgeEntityRepository,
    knowledgeIndicatorRepository,
    analyticsExecutionRepository,
    analyticsResultRepository,
    analyticsDashboardPreferenceRepository,
    analyticsDashboardEventRepository,
  );
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
    logger,
  );
  const fileStorageService = FileStorageService.fromConfig(config);
  const organizationService = new OrganizationService(
    organizationRepository,
    fileStorageService,
    projectRepository,
    activityRepository,
    uploadMetadataRepository,
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
    transactionManager,
    userRepository,
    processingResourceCleanupService,
    organizationRepository,
    logger,
  );
  const projectLlmTokenLedgerService = new ProjectLlmTokenLedgerService(
    projectRepository,
  );
  const activityService = new ActivityService(
    activityRepository,
    authorizationService,
    uploadMetadataRepository,
    fileStorageService,
    transactionManager,
    processingJobRepository,
    processingResourceCleanupService,
    projectDerivedStateInvalidationService,
    logger,
  );
  const uploadMetadataService = new UploadMetadataService(
    uploadMetadataRepository,
    activityService,
    authorizationService,
    fileStorageService,
    userRepository,
    transactionManager,
    activityRepository,
    processingJobRepository,
    processingResourceCleanupService,
    projectDerivedStateInvalidationService,
    logger,
  );
  const pythonProcessingClient = new PythonProcessingClient(
    config.PYTHON_SERVICE_URL,
    config.PYTHON_SERVICE_SHARED_SECRET,
    config.PYTHON_SERVICE_TIMEOUT_MS,
  );
  const evidenceProcessingArtifactService =
    new EvidenceProcessingArtifactService(
      uploadMetadataService,
      parsedRepresentationRepository,
      privacyReviewRepository,
      privacySafeRepresentationRepository,
    );
  const datasetPreparationService = new DatasetPreparationService(
    datasetPreparationRepository,
    privacySafeRepresentationRepository,
  );
  const deterministicAnalysisService = new DeterministicAnalysisService(
    deterministicAnalysisRepository,
    privacySafeRepresentationRepository,
  );
  const quantitativeInterpretationSynthesisService =
    new QuantitativeInterpretationSynthesisService(
      interpretationResultRepository,
      processingJobRepository,
      activityRepository,
      projectRepository,
      pythonProcessingClient,
      projectLlmTokenLedgerService,
    );
  const interpretationArtifactService = new InterpretationArtifactService(
    interpretationResultRepository,
    activityRepository,
    datasetPreparationService,
    deterministicAnalysisService,
    quantitativeInterpretationSynthesisService,
    projectLlmTokenLedgerService,
    logger,
  );
  const processingJobService = new ProcessingJobService(
    processingJobRepository,
    uploadMetadataRepository,
    authorizationService,
    evidenceProcessingArtifactService,
    interpretationArtifactService,
    parsedRepresentationRepository,
    privacyReviewRepository,
    privacySafeRepresentationRepository,
    fileStorageService,
    logger,
  );
  const evidenceProcessingService = new EvidenceProcessingService(
    processingJobRepository,
    uploadMetadataRepository,
    authorizationService,
  );
  const privacyReviewService = new PrivacyReviewService(
    processingJobRepository,
    authorizationService,
    privacyReviewRepository,
    parsedRepresentationRepository,
  );
  const activityUploadService = new ActivityUploadService(
    activityService,
    fileStorageService,
    uploadMetadataService,
    authorizationService,
  );
  const interpretationService = new InterpretationService(
    uploadMetadataRepository,
    privacySafeRepresentationRepository,
    interpretationResultRepository,
    processingJobRepository,
    activityRepository,
    authorizationService,
    pythonProcessingClient,
    logger,
    datasetPreparationService,
    deterministicAnalysisService,
    quantitativeInterpretationSynthesisService,
    projectKnowledgeBuilderService,
    projectLlmTokenLedgerService,
  );
  const dashboardCatalogAssemblerService = new DashboardCatalogAssemblerService(
    projectKnowledgeModelRepository,
    knowledgeEntityRepository,
    knowledgeIndicatorRepository,
    datasetPreparationRepository,
    deterministicAnalysisRepository,
  );
  const pythonAnalyticsCurationClient = new PythonAnalyticsCurationClient(
    config.PYTHON_SERVICE_URL,
    config.PYTHON_SERVICE_SHARED_SECRET,
    config.PYTHON_ANALYTICS_TIMEOUT_MS,
  );
  const analyticsDashboardBuilderService =
    new AnalyticsDashboardBuilderService();
  const analyticsDashboardPreferenceService =
    new AnalyticsDashboardPreferenceService(
      authorizationService,
      analyticsResultRepository,
      analyticsDashboardPreferenceRepository,
    );
  const analyticsDashboardEventService = new AnalyticsDashboardEventService(
    authorizationService,
    analyticsDashboardEventRepository,
  );
  const analyticsExecutionService = new AnalyticsExecutionService(
    authorizationService,
    dashboardCatalogAssemblerService,
    analyticsExecutionRepository,
    analyticsResultRepository,
    pythonAnalyticsCurationClient,
    projectKnowledgeBuilderService,
    deterministicAnalysisRepository,
    analyticsDashboardBuilderService,
    projectLlmTokenLedgerService,
    projectRepository,
    logger,
  );
  const analyticsQueryService = new AnalyticsQueryService(
    authorizationService,
    projectKnowledgeModelRepository,
    analyticsExecutionRepository,
    analyticsResultRepository,
    analyticsDashboardPreferenceRepository,
    analyticsDashboardEventRepository,
  );
  const analyticsDashboardExportService = new AnalyticsDashboardExportService(
    analyticsQueryService,
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
    authenticate: createAuthenticateMiddleware(config, authService),
    authenticateIfPresent: createAuthenticateIfPresentMiddleware(
      config,
      authService,
    ),
    requireInternalServiceSecret: createRequireInternalServiceSecretMiddleware(
      config.PYTHON_SERVICE_SHARED_SECRET,
    ),
    healthController: new HealthController(),
    authController: new AuthController(authService, config),
    invitationController: new InvitationController(invitationService),
    organizationController: new OrganizationController(organizationService),
    projectController: new ProjectController(projectService),
    activityController: new ActivityController(activityService),
    activityUploadController: new ActivityUploadController(
      activityUploadService,
    ),
    uploadMetadataController: new UploadMetadataController(
      uploadMetadataService,
      evidenceProcessingService,
    ),
    processingJobController: new ProcessingJobController(processingJobService),
    privacyReviewController: new PrivacyReviewController(privacyReviewService),
    interpretationController: new InterpretationController(
      interpretationService,
    ),
    analyticsController: new AnalyticsController(
      analyticsExecutionService,
      analyticsQueryService,
      analyticsDashboardExportService,
      analyticsDashboardEventService,
      analyticsDashboardPreferenceService,
    ),
    analyticsExecutionService,
  };
}
