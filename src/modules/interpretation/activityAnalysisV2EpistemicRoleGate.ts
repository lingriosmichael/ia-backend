import type { EpistemicRole } from "../../shared/contracts.js";

export const ACTIVITY_ANALYSIS_V2_EPISTEMIC_ROLE_GATE_PREFIX =
  "epistemic_role_gate_downgrade:";

export function buildEpistemicRoleGateDowngradeMessage(input: {
  toolName: string;
  role: EpistemicRole;
  columnName?: string | null;
}): string {
  const columnDetail = input.columnName
    ? ` column '${input.columnName}'`
    : " this evidence";
  return `${ACTIVITY_ANALYSIS_V2_EPISTEMIC_ROLE_GATE_PREFIX} Tool '${input.toolName}' cannot use${columnDetail} with epistemicRole '${input.role}' for an outcome-style claim, so this goal was downgraded to qualitative evidence only.`;
}

export function isEpistemicRoleGateDowngradeMessage(
  message: string | null | undefined,
): boolean {
  return (
    typeof message === "string" &&
    message.startsWith(ACTIVITY_ANALYSIS_V2_EPISTEMIC_ROLE_GATE_PREFIX)
  );
}
