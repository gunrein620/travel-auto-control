import assert from "node:assert/strict";
import test from "node:test";
import { coercePlanItemInput } from "../src/domain/planItemInput.js";

test("coercePlanItemInput preserves editable schedule fields and resets inspection status", () => {
  const input = coercePlanItemInput({
    title: "경복궁 야간 관람",
    placeName: "경복궁",
    address: "서울 종로구 사직로 161",
    lat: "37.5796",
    lng: "126.977",
    startsAt: "2026-05-30T21:00",
    endsAt: "2026-05-30T22:00",
    transportMode: "subway",
    travelMinutesBefore: "30",
    category: "outdoor",
    memo: "운영시간 확인 필요"
  });

  assert.deepEqual(input, {
    title: "경복궁 야간 관람",
    placeName: "경복궁",
    address: "서울 종로구 사직로 161",
    lat: 37.5796,
    lng: 126.977,
    startsAt: "2026-05-30T21:00:00+09:00",
    endsAt: "2026-05-30T22:00:00+09:00",
    transportMode: "subway",
    travelMinutesBefore: 30,
    category: "outdoor",
    memo: "운영시간 확인 필요",
    status: "unchecked"
  });
});
