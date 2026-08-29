import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { ActivitySystemType } from "../../shared/contracts.js";
import type { ActivityRepository } from "./activityRepository.js";
import type { ActivityPersistenceRecord } from "./activityPersistence.js";

// OUTCOME_EVIDENCE_MERGE_PLAN.md Phase 1/§4.1: the old baseline +
// impact_measurement pair was replaced by this single merged activity once
// the merge migration (mergeBaselineAndImpactMeasurementActivities.ts) ran
// for every project.
export const SYSTEM_ACTIVITY_DEFINITIONS = [
  {
    systemType: "outcome_evidence",
    name: "Ausgangslage & Wirkungsdaten",
  },
] as const satisfies Array<{
  systemType: ActivitySystemType;
  name: string;
}>;

export async function ensureProjectSystemActivities(input: {
  activityRepository: ActivityRepository;
  projectId: string;
  createdById: string;
  session: DatabaseSession;
}): Promise<ActivityPersistenceRecord[]> {
  return Promise.all(
    SYSTEM_ACTIVITY_DEFINITIONS.map((definition) =>
      input.activityRepository.ensureSystemActivity(
        {
          projectId: input.projectId,
          createdById: input.createdById,
          systemType: definition.systemType,
          name: definition.name,
        },
        input.session,
      ),
    ),
  );
}

export function sortActivitiesForDisplay<
  T extends { systemType: ActivitySystemType | null },
>(activities: T[]): T[] {
  return activities
    .map((activity, index) => ({ activity, index }))
    .sort((left, right) => {
      const rankDelta =
        getSystemActivityDisplayRank(left.activity.systemType) -
        getSystemActivityDisplayRank(right.activity.systemType);

      return rankDelta === 0 ? left.index - right.index : rankDelta;
    })
    .map(({ activity }) => activity);
}

function getSystemActivityDisplayRank(systemType: ActivitySystemType | null) {
  return systemType === "outcome_evidence" ? 0 : 1;
}
