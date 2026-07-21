export function resolveRequestLanguage(
  acceptLanguageHeader: string | string[] | undefined,
): "de" | "en" {
  const value = Array.isArray(acceptLanguageHeader)
    ? acceptLanguageHeader.join(",")
    : (acceptLanguageHeader ?? "");
  return value.toLowerCase().includes("de") ? "de" : "en";
}
