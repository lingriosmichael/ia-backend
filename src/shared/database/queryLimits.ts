/**
 * Defensive cap for list-style repository queries that don't yet support
 * cursor/offset pagination. This is not a product-facing page size — it
 * exists only to stop a single unbounded `.find()` from loading an
 * unreasonably large result set into memory as an organization/project
 * grows. Revisit once real pagination is added to the affected endpoints.
 */
export const UNPAGINATED_LIST_QUERY_MAX_RESULTS = 1000;
