import assert from "node:assert/strict";
import test from "node:test";
import { calculateCheckpoints, getDueCheckpoints } from "../src/domain/checkpoints.js";

const baseItem = {
  id: "item-1",
  title: "서울숲 산책",
  placeName: "서울숲",
  address: "서울 성동구 뚝섬로 273",
  lat: 37.5446,
  lng: 127.0374,
  startsAt: "2026-05-30T17:00:00+09:00",
  endsAt: "2026-05-30T18:30:00+09:00",
  transportMode: "bus",
  travelMinutesBefore: 22,
  category: "outdoor",
  memo: "비 오면 실내 대안 필요",
  status: "unchecked"
};

test("calculateCheckpoints creates 60-minute, 30-minute, and departure checkpoints", () => {
  assert.deepEqual(calculateCheckpoints(baseItem), [
    {
      id: "item-1-60m",
      itemId: "item-1",
      kind: "sixtyMinutesBefore",
      runAt: "2026-05-30T16:00:00.000+09:00"
    },
    {
      id: "item-1-30m",
      itemId: "item-1",
      kind: "thirtyMinutesBefore",
      runAt: "2026-05-30T16:30:00.000+09:00"
    },
    {
      id: "item-1-departure",
      itemId: "item-1",
      kind: "departure",
      runAt: "2026-05-30T16:38:00.000+09:00"
    }
  ]);
});

test("getDueCheckpoints returns only checkpoints due within the lookback window", () => {
  const items = [
    baseItem,
    {
      ...baseItem,
      id: "item-2",
      startsAt: "2026-05-30T20:00:00+09:00",
      endsAt: "2026-05-30T21:00:00+09:00"
    }
  ];

  const due = getDueCheckpoints(items, "2026-05-30T16:31:00+09:00", 5);

  assert.deepEqual(
    due.map((checkpoint) => `${checkpoint.itemId}:${checkpoint.kind}`),
    ["item-1:thirtyMinutesBefore"]
  );
});
