export function createSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export async function ensureUniqueSlug(
  baseInput: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = createSlug(baseInput) || "item";

  if (!(await exists(base))) {
    return base;
  }

  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (await exists(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}
