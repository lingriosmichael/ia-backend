import type { BackendConfig } from "../config/env.js";

function parseOrigin(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeOrigin(origin: string): string {
  const parsed = parseOrigin(origin);
  if (!parsed) {
    return origin;
  }

  const isLocalAlias =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isLocalAlias) {
    parsed.hostname = "localhost";
  }

  return parsed.origin;
}

function configuredOrigins(config: BackendConfig): string[] {
  return Array.from(
    new Set(
      [config.CORS_ORIGIN, config.WEBAPP_URL]
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map(normalizeOrigin),
    ),
  );
}

export function isAllowedOrigin(
  origin: string | null | undefined,
  config: BackendConfig,
): boolean {
  if (!origin) {
    return false;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  return configuredOrigins(config).includes(normalizedOrigin);
}
