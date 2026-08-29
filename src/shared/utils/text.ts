export function trimNullableText(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return value.trim() || null;
}

export function trimRequiredText(value: string) {
  return value.trim();
}

export function trimStringArray(values: string[] | undefined) {
  return values?.map((value) => value.trim()).filter(Boolean);
}

/**
 * Trims each line, drops empty lines, and joins the rest with "\n". Shared
 * by the activity-output request schema (character-count validation) and
 * the activity-output persistence normalizer, which must agree on what
 * counts as one line so validated length and persisted length never diverge.
 */
export function joinNonEmptyTrimmedLines(values: string[]): string {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join("\n");
}
