import type {
  ActivityAssessmentV2,
  ActivityAnalysisV2CalculationRecord,
  ActivityAnalysisV2Diagnostics,
  ActivityAnalysisV2QualitativeFindingRecord,
  ActivityAnalysisV2ToolCallRecord,
  ActivityAnalysisRunV2Status,
  ActivityAnalysisRunV2ValidationStatus,
  InterpretationQuestion,
} from "../../shared/contracts.js";

export interface ActivityAnalysisRunV2GoalsSnapshotPersistenceRecord {
  activityType: string | null;
  objectives: string | null;
  output: string | null;
  outcome: string | null;
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
  qualitativeFindings: ActivityAnalysisV2QualitativeFindingRecord[];
  assessment: ActivityAssessmentV2 | null;
  diagnostics: ActivityAnalysisV2Diagnostics;
  renderedSummary: string | null;
  recommendationText: string | null;
  validation: ActivityAnalysisRunV2ValidationPersistenceRecord;
  errorMessage: string | null;
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
  qualitativeFindings: ActivityAnalysisV2QualitativeFindingRecord[];
  assessment: ActivityAssessmentV2 | null;
  diagnostics: ActivityAnalysisV2Diagnostics;
  renderedSummary: string | null;
  recommendationText: string | null;
  validation: ActivityAnalysisRunV2ValidationPersistenceRecord;
  errorMessage: string | null;
}
