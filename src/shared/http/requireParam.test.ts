import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../errors/appError.js";
import { requireParam } from "./requireParam.js";

test("requireParam returns the value when present", () => {
  assert.equal(
    requireParam({ activityId: "activity-1" }, "activityId"),
    "activity-1",
  );
});

test("requireParam throws a clean 400 when the param is missing", () => {
  assert.throws(
    () => requireParam({ activityId: undefined }, "activityId"),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "route_param_missing");
      return true;
    },
  );
});

test("requireParam throws for an empty-string param", () => {
  assert.throws(() => requireParam({ activityId: "" }, "activityId"));
});
