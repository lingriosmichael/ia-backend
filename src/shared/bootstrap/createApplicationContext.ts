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
import { ActivityLlmTokenLedgerService } from "../../modules/activity/activityLlmTokenLedgerService.js";
import { MongoActivityRepository } from "../../modules/activity/activityMongoRepository.js";
import { ActivityService } from "../../modules/activity/activityService.js";
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
import { ActivityAnalysisV2Service } from "../../modules/interpretation/activityAnalysisV2Service.js";
import { MongoActivityAnalysisRunV2Repository } from "../../modules/interpretation/activityAnalysisRunV2MongoRepository.js";
import { ActivityAnalysisV2ToolExecutor } from "../../modules/interpretation/activityAnalysisV2ToolExecutor.js";
import { InterpretationController } from "../../modules/interpretation/interpretationController.js";
import { MongoProjectAnalyticsSnapshotRepository } from "../../modules/projectImpactStory/projectAnalyticsSnapshotMongoRepository.js";
import { MongoProjectImpactStoryRepository } from "../../modules/projectImpactStory/projectImpactStoryMongoRepository.js";
import { ProjectImpactStoryService } from "../../modules/projectImpactStory/projectImpactStoryService.js";
import { MongoProjectOutcomeStatementRepository } from "../../modules/outcome/projectOutcomeStatementMongoRepository.js";
import { ProjectOutcomeStatementService } from "../../modules/outcome/projectOutcomeStatementService.js";
import { ProjectOutcomeStatementController } from "../../modules/outcome/projectOutcomeStatementController.js";
import { MongoOutcomeEvidencePairingResultRepository } from "../../modules/outcome/outcomeEvidencePairingResultMongoRepository.js";
import { MongoOutcomeEvidenceLinkRepository } from "../../modules/outcome/outcomeEvidenceLinkMongoRepository.js";
import { OutcomeEvidencePairingService } from "../../modules/outcome/outcomeEvidencePairingService.js";
import { OutcomeEvidencePairingSuggestionService } from "../../modules/outcome/outcomeEvidencePairingSuggestionService.js";
import { OutcomeEvidencePairingController } from "../../modules/outcome/outcomeEvidencePairingController.js";
import { ProjectImpactStoryController } from "../../modules/projectImpactStory/projectImpactStoryController.js";
import { MongoDeterministicAnalysisRepository } from "../../modules/interpretation/deterministicAnalysisMongoRepository.js";
import { MongoDatasetPreparationRepository } from "../../modules/interpretation/datasetPreparationMongoRepository.js";
import { DatasetPreparationService } from "../../modules/interpretation/datasetPreparationService.js";
import { DeterministicAnalysisService } from "../../modules/interpretation/deterministicAnalysisService.js";
import { CurrentActivityEvidenceLoader } from "../../modules/interpretation/currentActivityEvidenceLoader.js";
import { MongoActivityEvidenceLinkageResultRepository } from "../../modules/linkage/activityEvidenceLinkageResultMongoRepository.js";
import { EvidenceLinkageReconciliationService } from "../../modules/linkage/evidenceLinkageReconciliationService.js";
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
import { QualitativeCodingReviewController } from "../../modules/processing/qualitativeCodingReviewController.js";
import { MongoQualitativeCodingReviewRepository } from "../../modules/processing/qualitativeCodingReviewMongoRepository.js";
import { QualitativeCodingReviewService } from "../../modules/processing/qualitativeCodingReviewService.js";
import { MongoPrivacySafeRepresentationRepository } from "../../modules/processing/privacySafeRepresentationMongoRepository.js";
import { ProcessingResourceCleanupService } from "../../modules/processing/processingResourceCleanupService.js";
import { PythonProcessingClient } from "../../modules/processing/pythonProcessingClient.js";
import { ProjectController } from "../../modules/project/projectController.js";
import { ProjectDerivedStateInvalidationService } from "../../modules/project/projectDerivedStateInvalidationService.js";
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
  const transactionManager = new MongoTransactionManager(logger);
  const emailService = createEmailService(config);
  const userRepository = new MongoUserRepository();
  const organizationRepository = new MongoOrganizationRepository();
  const invitationRepository = new MongoInvitationRepository();
  const projectOutcomeStatementRepository =
    new MongoProjectOutcomeStatementRepository();
  const outcomeEvidencePairingResultRepository =
    new MongoOutcomeEvidencePairingResultRepository();
  const outcomeEvidenceLinkRepository =
    new MongoOutcomeEvidenceLinkRepository();
  const projectRepository = new MongoProjectRepository();
  const activityRepository = new MongoActivityRepository();
  const uploadMetadataRepository = new MongoUploadMetadataRepository();
  const processingJobRepository = new MongoProcessingJobRepository();
  const parsedRepresentationRepository =
    new MongoParsedRepresentationRepository();
  const privacyReviewRepository = new MongoPrivacyReviewRepository();
  const qualitativeCodingReviewRepository =
    new MongoQualitativeCodingReviewRepository();
  const privacySafeRepresentationRepository =
    new MongoPrivacySafeRepresentationRepository();
  const interpretationResultRepository =
    new MongoInterpretationResultRepository();
  const datasetPreparationRepository = new MongoDatasetPreparationRepository();
  const deterministicAnalysisRepository =
    new MongoDeterministicAnalysisRepository();
  const activityAnalysisRunV2Repository =
    new MongoActivityAnalysisRunV2Repository();
  const projectAnalyticsSnapshotRepository =
    new MongoProjectAnalyticsSnapshotRepository();
  const projectImpactStoryRepository = new MongoProjectImpactStoryRepository();
  const activityEvidenceLinkageResultRepository =
    new MongoActivityEvidenceLinkageResultRepository();
  const projectKnowledgeModelRepository =
    new MongoProjectKnowledgeModelRepository();
  const knowledgeEntityRepository = new MongoKnowledgeEntityRepository();
  const knowledgeIndicatorRepository = new MongoKnowledgeIndicatorRepository();
  const projectDerivedStateInvalidationService =
    new ProjectDerivedStateInvalidationService(projectKnowledgeModelRepository);
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
    qualitativeCodingReviewRepository,
    privacySafeRepresentationRepository,
    interpretationResultRepository,
    datasetPreparationRepository,
    deterministicAnalysisRepository,
    projectKnowledgeModelRepository,
    knowledgeEntityRepository,
    knowledgeIndicatorRepository,
    activityEvidenceLinkageResultRepository,
    activityAnalysisRunV2Repository,
    projectAnalyticsSnapshotRepository,
    projectImpactStoryRepository,
    outcomeEvidenceLinkRepository,
    outcomeEvidencePairingResultRepository,
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
    projectOutcomeStatementRepository,
  );
  const projectLlmTokenLedgerService = new ProjectLlmTokenLedgerService(
    projectRepository,
  );
  const activityLlmTokenLedgerService = new ActivityLlmTokenLedgerService(
    activityRepository,
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
    config.PYTHON_LLM_TIMEOUT_MS,
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
  const evidenceLinkageReconciliationService =
    new EvidenceLinkageReconciliationService(
      uploadMetadataRepository,
      interpretationResultRepository,
      datasetPreparationRepository,
      privacySafeRepresentationRepository,
      activityEvidenceLinkageResultRepository,
      activityRepository,
      pythonProcessingClient,
      logger,
    );
  const quantitativeInterpretationSynthesisService =
    new QuantitativeInterpretationSynthesisService(
      interpretationResultRepository,
      processingJobRepository,
      activityRepository,
      projectRepository,
      pythonProcessingClient,
      projectLlmTokenLedgerService,
      activityLlmTokenLedgerService,
      logger,
    );
  const interpretationArtifactService = new InterpretationArtifactService(
    interpretationResultRepository,
    activityRepository,
    datasetPreparationService,
    deterministicAnalysisService,
    quantitativeInterpretationSynthesisService,
    projectLlmTokenLedgerService,
    evidenceLinkageReconciliationService,
    logger,
  );
  const processingJobService = new ProcessingJobService(
    processingJobRepository,
    uploadMetadataRepository,
    uploadMetadataService,
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
  const qualitativeCodingReviewService = new QualitativeCodingReviewService(
    uploadMetadataRepository,
    authorizationService,
    privacySafeRepresentationRepository,
    interpretationResultRepository,
    qualitativeCodingReviewRepository,
    pythonProcessingClient,
    projectLlmTokenLedgerService,
    activityLlmTokenLedgerService,
    logger,
    config.QUALITATIVE_CODING_DEBUG_INCLUDE_PAYLOADS,
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
    qualitativeCodingReviewRepository,
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
    evidenceLinkageReconciliationService,
    activityEvidenceLinkageResultRepository,
  );
  const currentActivityEvidenceLoader = new CurrentActivityEvidenceLoader(
    uploadMetadataRepository,
    privacySafeRepresentationRepository,
    qualitativeCodingReviewRepository,
  );
  const activityAnalysisV2ToolExecutor = new ActivityAnalysisV2ToolExecutor(
    interpretationResultRepository,
    datasetPreparationRepository,
  );
  const activityAnalysisV2Service = new ActivityAnalysisV2Service(
    authorizationService,
    activityRepository,
    currentActivityEvidenceLoader,
    qualitativeCodingReviewRepository,
    activityAnalysisRunV2Repository,
    activityAnalysisV2ToolExecutor,
    interpretationResultRepository,
    datasetPreparationService,
    pythonProcessingClient,
    projectLlmTokenLedgerService,
    activityLlmTokenLedgerService,
    logger,
  );
  const projectImpactStoryService = new ProjectImpactStoryService(
    authorizationService,
    activityRepository,
    uploadMetadataRepository,
    activityAnalysisRunV2Repository,
    projectAnalyticsSnapshotRepository,
    projectImpactStoryRepository,
    pythonProcessingClient,
    projectLlmTokenLedgerService,
    projectOutcomeStatementRepository,
    outcomeEvidenceLinkRepository,
    currentActivityEvidenceLoader,
    activityAnalysisV2ToolExecutor,
    interpretationResultRepository,
    datasetPreparationRepository,
    privacySafeRepresentationRepository,
    logger,
  );
  const projectOutcomeStatementService = new ProjectOutcomeStatementService(
    authorizationService,
    projectOutcomeStatementRepository,
  );
  const outcomeEvidencePairingSuggestionService =
    new OutcomeEvidencePairingSuggestionService(pythonProcessingClient, logger);
  const outcomeEvidencePairingService = new OutcomeEvidencePairingService(
    authorizationService,
    activityRepository,
    uploadMetadataRepository,
    interpretationResultRepository,
    datasetPreparationRepository,
    privacySafeRepresentationRepository,
    outcomeEvidencePairingResultRepository,
    outcomeEvidenceLinkRepository,
    projectOutcomeStatementRepository,
    outcomeEvidencePairingSuggestionService,
    interpretationService,
  );
  const invitationService = new InvitationService(
    invitationRepository,
    organizationRepository,
    userRepository,
    authorizationService,
    transactionManager,
    emailService,
    config.WEBAPP_URL,
    logger,
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
    projectOutcomeStatementController: new ProjectOutcomeStatementController(
      projectOutcomeStatementService,
    ),
    outcomeEvidencePairingController: new OutcomeEvidencePairingController(
      outcomeEvidencePairingService,
    ),
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
    qualitativeCodingReviewController: new QualitativeCodingReviewController(
      qualitativeCodingReviewService,
      processingJobService,
    ),
    interpretationController: new InterpretationController(
      interpretationService,
      activityAnalysisV2Service,
      processingJobService,
    ),
    projectImpactStoryController: new ProjectImpactStoryController(
      projectImpactStoryService,
      processingJobService,
    ),
    processingJobService,
    activityAnalysisV2Service,
    qualitativeCodingReviewService,
    projectImpactStoryService,
  };
}
