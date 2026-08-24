import mongoose from "mongoose";
import { runMigrationScript } from "./shared/migrationScriptRunner.js";

function getDatabase() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }
  return database;
}

const legacyRoleFilter = { role: { $in: ["owner", "member"] } };
const legacyOrganizationFieldFilter = {
  $or: [{ description: { $exists: true } }, { logoPath: { $exists: true } }],
};
const legacyProjectFieldFilter = { createdById: { $exists: true } };

runMigrationScript({
  scriptLabel: "Organization role model migration",
  preview: async () => {
    const database = getDatabase();
    const [membershipCount, organizationCount, projectCount] =
      await Promise.all([
        database.collection("memberships").countDocuments(legacyRoleFilter),
        database
          .collection("organizations")
          .countDocuments(legacyOrganizationFieldFilter),
        database
          .collection("projects")
          .countDocuments(legacyProjectFieldFilter),
      ]);
    console.log(
      `${membershipCount} membership(s) carry a legacy role; ` +
        `${organizationCount} organization(s) carry legacy description/logoPath fields; ` +
        `${projectCount} project(s) carry a legacy createdById field.`,
    );
  },
  apply: async () => {
    const database = getDatabase();

    await database.collection("memberships").updateMany({}, [
      {
        $set: {
          role: {
            $switch: {
              branches: [
                {
                  case: { $eq: ["$role", "owner"] },
                  then: "ORGANIZATION_ADMIN",
                },
                {
                  case: { $eq: ["$role", "member"] },
                  then: "PROJECT_MANAGER",
                },
              ],
              default: "$role",
            },
          },
        },
      },
    ]);

    await database.collection("organizations").updateMany({}, [
      {
        $set: {
          mission: { $ifNull: ["$mission", "$description"] },
          logoUrl: { $ifNull: ["$logoUrl", "$logoPath"] },
        },
      },
      {
        $unset: ["description", "logoPath"],
      },
    ]);

    await database.collection("projects").updateMany({}, [
      {
        $set: {
          ownerId: { $ifNull: ["$ownerId", "$createdById"] },
        },
      },
      {
        $unset: ["createdById"],
      },
    ]);

    console.log("Memberships, organizations, and projects migrated.");
  },
});
