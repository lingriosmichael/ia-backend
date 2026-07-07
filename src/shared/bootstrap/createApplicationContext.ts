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
import { MongoResultRepository } from "../../modules/ai/artifact/resultRecordMongoRepository.js";
import { ResultRecordService } from "../../modules/ai/artifact/resultRecordService.js";
import { MongoProcessingJobRepository } from "../../modules/ai/execution/processingJobMongoRepository.js";
import { ProcessingJobController } from "../../modules/ai/execution/processingJobController.js";
import { ProcessingJobService } from "../../modules/ai/execution/processingJobService.js";
import { AuthController } from "../../modules/auth/authController.js";
import { AuthService } from "../../modules/auth/authService.js";
import { HealthController } from "../../modules/health/healthController.js";
import { InvitationController } from "../../modules/invitation/invitationController.js";
import { MongoInvitationRepository } from "../../modules/invitation/invitationMongoRepository.js";
import { InvitationService } from "../../modules/invitation/invitationService.js";
import { OrganizationController } from "../../modules/organization/organizationController.js";
import { MongoOrganizationRepository } from "../../modules/organization/organizationMongoRepository.js";
import { OrganizationService } from "../../modules/organization/organizationService.js";
import { MongoEntityMappingRepository } from "../../modules/processing/entityMappingMongoRepository.js";
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
  const processingJobRepository = new MongoProcessingJobRepository();
  const resultRepository = new MongoResultRepository();
  const parsedRepresentationRepository = new MongoParsedRepresentationRepository();
  const privacyReviewRepository = new MongoPrivacyReviewRepository();
  const privacySafeRepresentationRepository =
    new MongoPrivacySafeRepresentationRepository();
  const entityMappingRepository = new MongoEntityMappingRepository();
  const processingResourceCleanupService = new ProcessingResourceCleanupService(
    parsedRepresentationRepository,
    privacyReviewRepository,
    privacySafeRepresentationRepository,
    entityMappingRepository,
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
  );
  const fileStorageService = new FileStorageService(config.UPLOAD_DIR);
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
    transactionManager,
    userRepository,
    processingResourceCleanupService,
    organizationRepository,
  );
  const activityService = new ActivityService(
    activityRepository,
    authorizationService,
    uploadMetadataRepository,
    fileStorageService,
    processingJobRepository,
    resultRepository,
    processingResourceCleanupService,
  );
  const uploadMetadataService = new UploadMetadataService(
    uploadMetadataRepository,
    activityService,
    authorizationService,
    fileStorageService,
    userRepository,
    processingJobRepository,
    resultRepository,
    processingResourceCleanupService,
  );
  const pythonProcessingClient = new PythonProcessingClient(
    config.PYTHON_SERVICE_URL,
    config.PYTHON_SERVICE_SHARED_SECRET,
  );
  const evidenceProcessingArtifactService = new EvidenceProcessingArtifactService(
    uploadMetadataService,
    parsedRepresentationRepository,
    privacyReviewRepository,
    privacySafeRepresentationRepository,
    entityMappingRepository,
  );
  const processingJobService = new ProcessingJobService(
    processingJobRepository,
    uploadMetadataRepository,
    authorizationService,
    pythonProcessingClient,
    evidenceProcessingArtifactService,
  );
  const evidenceProcessingService = new EvidenceProcessingService(
    processingJobRepository,
    uploadMetadataRepository,
    authorizationService,
    fileStorageService,
    pythonProcessingClient,
  );
  const privacyReviewService = new PrivacyReviewService(
    processingJobRepository,
    authorizationService,
    pythonProcessingClient,
    privacyReviewRepository,
    parsedRepresentationRepository,
  );
  const resultRecordService = new ResultRecordService(
    resultRepository,
    uploadMetadataRepository,
    processingJobRepository,
    authorizationService,
  );
  const activityUploadService = new ActivityUploadService(
    activityService,
    fileStorageService,
    uploadMetadataService,
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
    activityUploadController: new ActivityUploadController(
      activityUploadService,
    ),
    uploadMetadataController: new UploadMetadataController(
      uploadMetadataService,
      evidenceProcessingService,
    ),
    processingJobController: new ProcessingJobController(processingJobService),
    privacyReviewController: new PrivacyReviewController(privacyReviewService),
    resultController: new ResultController(resultRecordService),
  };
}
