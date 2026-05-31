import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInitialState, loadState, saveState } from "../server/statePersistence.js";

test("state persistence saves and restores planner state without storing API payloads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "travel-ops-"));
  const filePath = join(dir, "state.json");
  const seedItems = [
    {
      id: "seed",
      title: "기본 일정",
      placeName: "서울숲",
      address: "서울",
      lat: 37.5,
      lng: 127,
      startsAt: "2026-05-30T17:00:00+09:00",
      endsAt: "2026-05-30T18:00:00+09:00",
      transportMode: "subway",
      travelMinutesBefore: 20,
      category: "outdoor",
      memo: "",
      status: "unchecked"
    }
  ];

  try {
    const state = createInitialState(seedItems);
    state.plan.items.push({
      ...seedItems[0],
      id: "custom",
      title: "사용자 일정",
      rawApiJson: { secret: "must-not-be-saved" }
    });
    state.notifications.push({
      id: "notice",
      itemId: "custom",
      severity: "watch",
      title: "확인 필요",
      rawApiJson: { token: "hidden" }
    });

    await saveState(filePath, state);

    const savedText = await readFile(filePath, "utf8");
    assert.equal(savedText.includes("rawApiJson"), false);
    assert.equal(savedText.includes("must-not-be-saved"), false);

    const restored = await loadState(filePath, seedItems);
    assert.equal(restored.plan.items.some((item) => item.id === "custom"), true);
    assert.equal(restored.notifications[0].id, "notice");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
