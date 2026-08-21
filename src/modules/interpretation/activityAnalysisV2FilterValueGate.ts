export const ACTIVITY_ANALYSIS_V2_FILTER_VALUE_GATE_PREFIX =
  "filter_value_gate_rejection:";

export function buildFilterValueGateRejectionMessage(input: {
  toolName: string;
  columnName: string;
  value: string;
}): string {
  return (
    `${ACTIVITY_ANALYSIS_V2_FILTER_VALUE_GATE_PREFIX} Tool '${input.toolName}' ` +
    `filtered column '${input.columnName}' by the value '${input.value}', which ` +
    "was never observed in that column (and is not a confirmed positive value " +
    "for it). Rejected instead of silently returning a zero-row or otherwise " +
    "wrong result."
  );
}

export function isFilterValueGateRejectionMessage(
  message: string | null | undefined,
): boolean {
  return (
    typeof message === "string" &&
    message.startsWith(ACTIVITY_ANALYSIS_V2_FILTER_VALUE_GATE_PREFIX)
  );
}
