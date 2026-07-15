import mongoose from "mongoose";
import { AnalyticsExecutionMongoModel } from "../modules/analytics/analyticsExecutionModel.js";
import { AnalyticsResultMongoModel } from "../modules/analytics/analyticsResultModel.js";
import { ProcessingJobMongoModel } from "../modules/ai/execution/processingJobModel.js";
import { ActivityMongoModel } from "../modules/activity/activityModel.js";
import { DatasetPreparationMongoModel } from "../modules/interpretation/datasetPreparationModel.js";
import { DeterministicAnalysisMongoModel } from "../modules/interpretation/deterministicAnalysisModel.js";
import { InterpretationResultMongoModel } from "../modules/interpretation/interpretationResultModel.js";
import { InvitationMongoModel } from "../modules/invitation/invitationModel.js";
import { KnowledgeEntityMongoModel } from "../modules/knowledge/knowledgeEntityModel.js";
import { KnowledgeIndicatorMongoModel } from "../modules/knowledge/knowledgeIndicatorModel.js";
import { ProjectKnowledgeModelMongoModel } from "../modules/knowledge/projectKnowledgeModelModel.js";
import { MembershipMongoModel } from "../modules/organization/membershipModel.js";
import { OrganizationMongoModel } from "../modules/organization/organizationModel.js";
import { ParsedRepresentationMongoModel } from "../modules/processing/parsedRepresentationModel.js";
import { PrivacyReviewMongoModel } from "../modules/processing/privacyReviewModel.js";
import { PrivacySafeRepresentationMongoModel } from "../modules/processing/privacySafeRepresentationModel.js";
import { ProjectMongoModel } from "../modules/project/projectModel.js";
import { UploadMetadataMongoModel } from "../modules/upload/uploadMetadataModel.js";
import { UserMongoModel } from "../modules/user/userModel.js";
import { loadConfig } from "../shared/config/env.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "../shared/database/mongoose.js";

type CollectionResetTarget = {
  label: string;
  collectionName: string;
};

const preservedCollections: CollectionResetTarget[] = [
  { label: "users", collectionName: UserMongoModel.collection.collectionName },
  {
    label: "organizations",
    collectionName: OrganizationMongoModel.collection.collectionName,
  },
  {
    label: "memberships",
    collectionName: MembershipMongoModel.collection.collectionName,
  },
  {
    label: "projects",
    collectionName: ProjectMongoModel.collection.collectionName,
  },
  {
    label: "activities",
    collectionName: ActivityMongoModel.collection.collectionName,
  },
];

const deletedCollections: CollectionResetTarget[] = [
  {
    label: "uploads",
    collectionName: UploadMetadataMongoModel.collection.collectionName,
  },
  {
    label: "invitations",
    collectionName: InvitationMongoModel.collection.collectionName,
  },
  {
    label: "processing jobs",
    collectionName: ProcessingJobMongoModel.collection.collectionName,
  },
  {
    label: "parsed representations",
    collectionName: ParsedRepresentationMongoModel.collection.collectionName,
  },
  {
    label: "privacy reviews",
    collectionName: PrivacyReviewMongoModel.collection.collectionName,
  },
  {
    label: "privacy-safe representations",
    collectionName:
      PrivacySafeRepresentationMongoModel.collection.collectionName,
  },
  {
    label: "interpretation results",
    collectionName: InterpretationResultMongoModel.collection.collectionName,
  },
  {
    label: "dataset preparations",
    collectionName: DatasetPreparationMongoModel.collection.collectionName,
  },
  {
    label: "deterministic analyses",
    collectionName: DeterministicAnalysisMongoModel.collection.collectionName,
  },
  {
    label: "project knowledge models",
    collectionName: ProjectKnowledgeModelMongoModel.collection.collectionName,
  },
  {
    label: "knowledge entities",
    collectionName: KnowledgeEntityMongoModel.collection.collectionName,
  },
  {
    label: "knowledge indicators",
    collectionName: KnowledgeIndicatorMongoModel.collection.collectionName,
  },
  {
    label: "analytics executions",
    collectionName: AnalyticsExecutionMongoModel.collection.collectionName,
  },
  {
    label: "analytics results",
    collectionName: AnalyticsResultMongoModel.collection.collectionName,
  },
];

function hasExecuteFlag() {
  return process.argv.includes("--execute");
}

async function run() {
  const config = loadConfig();
  await connectMongoDatabase(config);
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Mongo database connection is not available.");
  }

  const preservedCounts = await Promise.all(
    preservedCollections.map(async ({ label, collectionName }) => ({
      label,
      collectionName,
      count: await db.collection(collectionName).countDocuments({}),
    })),
  );

  const deletePlan = await Promise.all(
    deletedCollections.map(async ({ label, collectionName }) => ({
      label,
      collectionName,
      count: await db.collection(collectionName).countDocuments({}),
    })),
  );

  console.log("Preserved collections:");
  console.table(preservedCounts);
  console.log("Collections to clear:");
  console.table(deletePlan);

  if (!hasExecuteFlag()) {
    console.log(
      "Dry run only. Re-run with `npm run reset:structure-only -- --execute` to delete evidence and all derived state.",
    );
    return;
  }

  for (const target of deletePlan) {
    await db.collection(target.collectionName).deleteMany({});
  }

  console.log("Database reset completed.");
  console.log(
    "Preserved: users, organizations, memberships, projects, activities.",
  );
  console.log(
    "Cleared: uploads, invitations, processing, interpretation, knowledge, analytics, and AI artifact collections.",
  );
}

run()
  .then(async () => {
    await disconnectMongoDatabase();
  })
  .catch(async (error) => {
    console.error(error);
    await disconnectMongoDatabase();
    process.exit(1);
  });
