import type { ProjectPersistenceRecord } from "../project/projectPersistence.js";
import type { ProjectContextForCuration } from "./analyticsContracts.js";

// Extracted from AnalyticsExecutionService so every caller that needs
// ProjectContextForCuration (the dashboard curator, Report Readiness Check)
// builds it identically from the same project fields.
export function buildProjectContextForCuration(
  project: ProjectPersistenceRecord,
): ProjectContextForCuration {
  return {
    name: project.name,
    projectGoal: project.projectGoal,
    impactModel: project.impactModel,
    successIndicators: project.successIndicators,
    targetGroups: project.targetGroups,
    areaOfOperation: project.areaOfOperation,
  };
}
