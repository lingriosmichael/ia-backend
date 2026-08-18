import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { ActivitySystemType } from "../../shared/contracts.js";
import type { ActivityRepository } from "./activityRepository.js";
import type { ActivityPersistenceRecord } from "./activityPersistence.js";

export const SYSTEM_ACTIVITY_DEFINITIONS = [
  {
    systemType: "baseline",
    name: "Baseline",
  },
  {
    systemType: "impact_measurement",
    name: "Wirkungsmessung",
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
  if (systemType === "baseline") {
    return 0;
  }

  if (systemType === "impact_measurement") {
    return 2;
  }

  return 1;
}
