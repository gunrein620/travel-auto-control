import assert from "node:assert/strict";
import test from "node:test";
import { decideInspection } from "../src/domain/riskEngine.js";

const outdoorItem = {
  id: "forest",
  title: "서울숲 산책",
  placeName: "서울숲",
  address: "서울 성동구 뚝섬로 273",
  lat: 37.5446,
  lng: 127.0374,
  startsAt: "2026-05-30T17:00:00+09:00",
  endsAt: "2026-05-30T18:30:00+09:00",
  transportMode: "subway",
  travelMinutesBefore: 15,
  category: "outdoor",
  memo: "야외 산책",
  status: "unchecked"
};

test("decideInspection reroutes outdoor plans when rain risk is high and indoor alternatives exist", () => {
  const result = decideInspection({
    item: outdoorItem,
    kto: {
      matched: true,
      placeName: "서울숲",
      operationHours: "상시 개방",
      closedToday: false,
      apiStatus: "KTO 실시간 조회 정상"
    },
    weather: {
      condition: "소나기",
      precipitationProbability: 80,
      precipitationMm: 8,
      temperatureC: 23
    },
    local: {
      placeMatched: true,
      alternatives: [
        {
          title: "성수 아트센터",
          placeName: "성수 아트센터",
          address: "서울 성동구",
          lat: 37.546,
          lng: 127.044,
          category: "indoor",
          reason: "비를 피할 수 있는 실내 문화시설"
        }
      ],
      apiStatus: "Kakao Local 정상"
    }
  });

  assert.equal(result.status, "reroute");
  assert.match(result.reason, /강수확률/);
  assert.equal(result.alternatives[0].placeName, "성수 아트센터");
  assert.equal(result.suggestedPatch.placeName, "성수 아트센터");
});

test("decideInspection keeps plans when operation, weather, and local data are safe", () => {
  const result = decideInspection({
    item: { ...outdoorItem, category: "indoor", title: "DDP 전시", placeName: "동대문디자인플라자" },
    kto: {
      matched: true,
      placeName: "동대문디자인플라자",
      operationHours: "10:00~20:00",
      closedToday: false,
      apiStatus: "KTO 실시간 조회 정상"
    },
    weather: {
      condition: "맑음",
      precipitationProbability: 0,
      precipitationMm: 0,
      temperatureC: 27
    },
    local: {
      placeMatched: true,
      alternatives: [],
      apiStatus: "Kakao Local 정상"
    }
  });

  assert.equal(result.status, "keep");
  assert.equal(result.alternatives.length, 0);
  assert.equal(result.suggestedPatch, undefined);
});
