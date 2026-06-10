import assert from "node:assert/strict";
import test from "node:test";
import { answerNaturalEditQuestion } from "../server/naturalEditQuestionService.js";

const droneItems = [
  {
    id: "drone-13",
    title: "고양행주문화제 드론불꽃쇼 관람",
    placeName: "행주산성 역사공원",
    address: "경기 고양시 덕양구 행주로15번길 89",
    startsAt: "2026-06-13T20:20:00+09:00",
    endsAt: "2026-06-13T21:10:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 20,
    category: "outdoor",
    memo: "고양행주문화제 야간 대표 프로그램, 20:35경 시작"
  },
  {
    id: "drone-14",
    title: "행주 드론불꽃쇼 관람",
    placeName: "행주산성역사공원",
    address: "경기 고양시 덕양구 행주로15번길 89",
    startsAt: "2026-06-14T20:20:00+09:00",
    endsAt: "2026-06-14T21:10:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 20,
    category: "outdoor",
    memo: "고양행주문화제 야간 대표 프로그램, 20:35경 시작"
  }
];

test("answerNaturalEditQuestion lists multiple matching event dates when the user asks without a date", () => {
  const reply = answerNaturalEditQuestion("드론 쇼는 몇시부터야?", droneItems);

  assert.equal(reply.type, "answer");
  assert.match(reply.text, /6월 13일 20:20부터 21:10까지/);
  assert.match(reply.text, /6월 14일 20:20부터 21:10까지/);
  assert.match(reply.text, /행주산성역사공원/);
});

test("answerNaturalEditQuestion keeps activeDate-specific answers when a date context exists", () => {
  const reply = answerNaturalEditQuestion("드론 쇼는 몇시부터야?", droneItems, { activeDate: "2026-06-14" });

  assert.match(reply.text, /6월 14일 20:20부터 21:10까지/);
  assert.doesNotMatch(reply.text, /6월 13일 20:20부터 21:10까지/);
});

test("answerNaturalEditQuestion prefers an explicit Korean month-day date over activeDate", () => {
  const reply = answerNaturalEditQuestion("6월 14일 드론 쇼는 몇시부터야?", droneItems, { activeDate: "2026-06-13" });

  assert.match(reply.text, /6월 14일 20:20부터 21:10까지/);
  assert.doesNotMatch(reply.text, /6월 13일 20:20부터 21:10까지/);
});
