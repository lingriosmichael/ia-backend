import type {
  ActivityAssessmentV2,
  ActivityAnalysisV2CalculationRecord,
  ActivityAnalysisV2Diagnostics,
  ActivityAnalysisV2QualitativeFindingRecord,
  ActivityAnalysisV2ToolCallRecord,
  ActivityAnalysisRunV2Status,
  ActivityAnalysisRunV2ValidationStatus,
  ContextCatalogEntry,
  InterpretationQuestion,
  LlmUsageSummary,
} from "../../shared/contracts.js";

export interface ActivityAnalysisRunV2GoalsSnapshotPersistenceRecord {
  activityType: string | null;
  objectives: string | null;
  output: string | null;
}

export interface ActivityAnalysisRunV2EvidenceItemPersistenceRecord {
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  logicalEvidenceId: string;
  versionNumber: number;
  originalFileName: string;
  evidenceModality: string | null;
  uploadedAt: Date;
}

export interface ActivityAnalysisRunV2RunLimitsPersistenceRecord {
  maxToolCalls: number;
  maxLlmIterations: number;
  timeoutMs: number;
  maxEvidenceItems: number;
}

export interface ActivityAnalysisRunV2ValidationPersistenceRecord {
  status: ActivityAnalysisRunV2ValidationStatus;
  issues: string[];
}

export interface ActivityAnalysisRunV2PersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string;
  activityName: string;
  phase: string;
  status: ActivityAnalysisRunV2Status;
  goalsSnapshot: ActivityAnalysisRunV2GoalsSnapshotPersistenceRecord;
  evidence: ActivityAnalysisRunV2EvidenceItemPersistenceRecord[];
  runLimits: ActivityAnalysisRunV2RunLimitsPersistenceRecord;
  clarificationQuestions: InterpretationQuestion[];
  toolCallTrace: ActivityAnalysisV2ToolCallRecord[];
  calculations: ActivityAnalysisV2CalculationRecord[];
  contextCatalogEntries: ContextCatalogEntry[];
  qualitativeFindings: ActivityAnalysisV2QualitativeFindingRecord[];
  assessment: ActivityAssessmentV2 | null;
  diagnostics: ActivityAnalysisV2Diagnostics;
  validation: ActivityAnalysisRunV2ValidationPersistenceRecord;
  errorMessage: string | null;
  // Total usage across every planner call this run's generation made
  // (initial attempt plus any auto-resolved-clarification replans) — not
  // just the last call. Null for a run created before this field existed,
  // or if usage genuinely couldn't be captured. See OPENAI_CALL_INVENTORY
  // remaining-work item 1: this is the per-run counterpart to the
  // activity/project lifetime token ledgers, which only ever tracked a
  // running total, never a single run's own cost.
  llmUsage: LlmUsageSummary | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityAnalysisRunV2CreateInput {
  organizationId: string;
  projectId: string;
  activityId: string;
  activityName: string;
  phase: string;
  status: ActivityAnalysisRunV2Status;
  goalsSnapshot: ActivityAnalysisRunV2GoalsSnapshotPersistenceRecord;
  evidence: ActivityAnalysisRunV2EvidenceItemPersistenceRecord[];
  runLimits: ActivityAnalysisRunV2RunLimitsPersistenceRecord;
  clarificationQuestions: InterpretationQuestion[];
  toolCallTrace: ActivityAnalysisV2ToolCallRecord[];
  calculations: ActivityAnalysisV2CalculationRecord[];
  contextCatalogEntries: ContextCatalogEntry[];
  qualitativeFindings: ActivityAnalysisV2QualitativeFindingRecord[];
  assessment: ActivityAssessmentV2 | null;
  diagnostics: ActivityAnalysisV2Diagnostics;
  validation: ActivityAnalysisRunV2ValidationPersistenceRecord;
  errorMessage: string | null;
  llmUsage: LlmUsageSummary | null;
}
