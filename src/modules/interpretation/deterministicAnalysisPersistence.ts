import type {
  DeterministicAnalysisCandidateIndicator,
  DeterministicAnalysisDistribution,
  DeterministicAnalysisMetric,
  DeterministicAnalysisStatus,
  DeterministicAnalysisSubgroupBreakdown,
  DeterministicAnalysisTrend,
  DeterministicAnalysisWarning,
} from "../../shared/contracts.js";

export interface DeterministicAnalysisPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  interpretationResultId: string;
  datasetPreparationId: string;
  status: DeterministicAnalysisStatus;
  metrics: DeterministicAnalysisMetric[];
  distributions: DeterministicAnalysisDistribution[];
  trends: DeterministicAnalysisTrend[];
  subgroupBreakdowns: DeterministicAnalysisSubgroupBreakdown[];
  warnings: DeterministicAnalysisWarning[];
  candidateIndicators: DeterministicAnalysisCandidateIndicator[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DeterministicAnalysisUpsertInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  interpretationResultId: string;
  datasetPreparationId: string;
  status: DeterministicAnalysisStatus;
  metrics: DeterministicAnalysisMetric[];
  distributions: DeterministicAnalysisDistribution[];
  trends: DeterministicAnalysisTrend[];
  subgroupBreakdowns: DeterministicAnalysisSubgroupBreakdown[];
  warnings: DeterministicAnalysisWarning[];
  candidateIndicators: DeterministicAnalysisCandidateIndicator[];
}
