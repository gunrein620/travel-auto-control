import assert from "node:assert/strict";
import test from "node:test";
import { getImpactedItemIds } from "../src/domain/impact.js";

const items = [
  { id: "a", startsAt: "2026-05-30T10:00:00+09:00" },
  { id: "b", startsAt: "2026-05-30T12:00:00+09:00" },
  { id: "c", startsAt: "2026-05-30T15:00:00+09:00" },
  { id: "d", startsAt: "2026-05-30T19:00:00+09:00" }
];

test("getImpactedItemIds returns the changed item and the next two items in timeline order", () => {
  assert.deepEqual(getImpactedItemIds(items, "b"), ["b", "c", "d"]);
});
