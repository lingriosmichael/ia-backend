import type { ReportReadinessCheckResult } from "../analytics/analyticsContracts.js";

// The persisted snapshot is exactly ReportReadinessCheckResult (see
// analyticsContracts.ts) — stored as-is on the project document. No
// separate persistence shape: nothing downstream needs a shape different
// from what the API already returns.
export type ReportReadinessCheckSnapshotPersistenceRecord =
  ReportReadinessCheckResult;
