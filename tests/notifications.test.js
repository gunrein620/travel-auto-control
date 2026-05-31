import assert from "node:assert/strict";
import test from "node:test";
import { applySuggestedPatch, createNotificationForDecision } from "../src/domain/notifications.js";

const item = {
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
  status: "unchecked"
};

test("createNotificationForDecision creates an in-app notification only for watch or reroute decisions", () => {
  const notification = createNotificationForDecision(item, {
    status: "watch",
    checkedAt: "2026-05-30T18:20:00+09:00",
    summary: "저녁 장소 운영정보가 불확실합니다.",
    reason: "KTO 운영정보 누락",
    evidence: ["KTO 상세 운영시간 없음"],
    recommendedAction: "전화 또는 지도 상세를 확인하세요.",
    alternatives: [],
    apiStatus: ["KTO 응답 정상, 운영정보 없음"]
  });

  assert.equal(notification.itemId, "dinner");
  assert.equal(notification.severity, "watch");
  assert.equal(notification.title, "비빔밥 저녁 점검 필요");
  assert.equal(notification.actionLabel, "확인하기");
  assert.equal(notification.dismissed, false);
});

test("applySuggestedPatch applies a reroute patch to only the affected schedule item", () => {
  const patched = applySuggestedPatch(item, {
    title: "삼겹살 저녁",
    placeName: "성수 삼겹살",
    address: "서울 성동구",
    lat: 37.544,
    lng: 127.055,
    memo: "자연어 요청으로 변경"
  });

  assert.equal(patched.id, "dinner");
  assert.equal(patched.title, "삼겹살 저녁");
  assert.equal(patched.placeName, "성수 삼겹살");
  assert.equal(patched.status, "unchecked");
  assert.equal(patched.startsAt, item.startsAt);
});
