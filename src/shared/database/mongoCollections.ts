export const mongoCollections = {
  users: "users",
  organizations: "organizations",
  memberships: "memberships",
  invitations: "invitations",
  subscriptions: "subscriptions",
  projects: "projects",
  activities: "activities",
  uploads: "uploads",
  processingJobs: "ai_executions",
  aiExecutions: "ai_executions",
  parsedRepresentations: "parsed_representations",
  privacyReviews: "privacy_reviews",
  privacySafeRepresentations: "privacy_safe_representations",
  entityMappings: "entity_mappings",
  datasetInterpretations: "dataset_interpretations",
  analyses: "analyses",
  insights: "insights",
  reports: "reports",
  chatSessions: "chat_sessions",
  chatMessages: "chat_messages",
} as const;

export type MongoCollectionName =
  (typeof mongoCollections)[keyof typeof mongoCollections];
