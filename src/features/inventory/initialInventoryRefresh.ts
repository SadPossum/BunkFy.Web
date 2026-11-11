import { ApiError } from "../../api/client";

// The property directory can precede Inventory's integration-event projection.
// Only repeat initial reads for that exact owner error; never infer an empty
// inventory or keep polling an established snapshot after a refresh failure.
export function initialInventoryRefreshInterval(query: {
  state: { data: unknown; error: unknown; errorUpdateCount: number };
}): number | false {
  const { data, error, errorUpdateCount } = query.state;
  return data === undefined
    && error instanceof ApiError
    && error.status === 404
    && error.code === "Inventory.PropertyNotFound"
    && errorUpdateCount < 3
    ? 1000
    : false;
}
