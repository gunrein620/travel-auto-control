import assert from "node:assert/strict";
import test from "node:test";
import { draftNaturalLanguageEdit } from "../src/domain/naturalLanguageEdit.js";

const items = [
  {
    id: "morning",
    title: "경복궁 관람",
    placeName: "경복궁",
    address: "서울 종로구 사직로 161",
    lat: 37.5796,
    lng: 126.977,
    startsAt: "2026-05-30T10:00:00+09:00",
    endsAt: "2026-05-30T12:00:00+09:00",
    transportMode: "subway",
    travelMinutesBefore: 25,
    category: "outdoor",
    memo: "오전 일정",
    status: "keep"
  },
  {
    id: "dinner",
    title: "비빔밥 저녁",
    placeName: "전주비빔밥",
    address: "서울 중구",
    lat: 37.56,
    lng: 126.98,
    startsAt: "2026-05-30T19:00:00+09:00",
    endsAt: "2026-05-30T20:00:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 10,
    category: "meal",
    memo: "저녁 식사",
    status: "keep"
  }
];

test("draftNaturalLanguageEdit finds the dinner item and drafts a samgyeopsal replacement", () => {
  const draft = draftNaturalLanguageEdit(
    "아 지금 삼겹살이 더 먹고싶으니까 이따 저녁일정 바꾸고 플래너에 적용해줘",
    items
  );

  assert.equal(draft.needsConfirmation, true);
  assert.equal(draft.targetItemId, "dinner");
  assert.equal(draft.patch.title, "삼겹살 저녁");
  assert.match(draft.patch.placeName, /삼겹살/);
  assert.match(draft.confirmationMessage, /비빔밥 저녁/);
});
