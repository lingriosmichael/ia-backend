import type {
  ImpactCatalogItem,
  LlmUsageSummary,
  ProjectImpactStoryNarrativeStatus,
  ProjectImpactStoryStatus,
} from "../../shared/contracts.js";

export interface ProjectImpactStoryPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  analyticsSnapshotId: string;
  status: ProjectImpactStoryStatus;
  impactCatalog: ImpactCatalogItem[];
  narrativeSummary: string | null;
  narrativeStatus: ProjectImpactStoryNarrativeStatus | null;
  llmUsage: LlmUsageSummary | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectImpactStoryCreateInput {
  organizationId: string;
  projectId: string;
  analyticsSnapshotId: string;
  status: ProjectImpactStoryStatus;
  impactCatalog: ImpactCatalogItem[];
  narrativeSummary: string | null;
  narrativeStatus: ProjectImpactStoryNarrativeStatus | null;
  llmUsage: LlmUsageSummary | null;
  errorMessage: string | null;
}
