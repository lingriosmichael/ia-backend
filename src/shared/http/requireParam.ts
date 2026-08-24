import { AppError } from "../errors/appError.js";

/**
 * Reads a required route param off a parsed idParamSchema object and throws
 * a clean 400 if it's missing, instead of the `params.xId!` pattern this
 * replaces. idParamSchema marks every field optional so it can be reused
 * across every route, which means the actual guarantee that a given field
 * is present lives in the route registration (a different file) — not
 * something a bare `!` assertion at the call site can see. A route that
 * reuses idParamSchema without the matching path segment now fails fast
 * with a clear error instead of silently coercing undefined to string and
 * passing it into a repository lookup.
 */
export function requireParam<T extends Record<string, string | undefined>>(
  params: T,
  key: keyof T & string,
): string {
  const value = params[key];
  if (!value) {
    throw new AppError(
      `Missing required route parameter: ${key}.`,
      400,
      "route_param_missing",
    );
  }
  return value;
}
