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
