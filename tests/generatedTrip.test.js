import assert from "node:assert/strict";
import test from "node:test";
import { createFallbackTrip, normalizeGeneratedTrip, normalizeTripRequest } from "../src/domain/generatedTrip.js";

test("normalizeTripRequest builds an inclusive date range", () => {
  const request = normalizeTripRequest({
    region: "수원시",
    startDate: "2026-06-27",
    endDate: "2026-06-29",
    travelers: "4인 가족"
  });

  assert.deepEqual(request.days, ["2026-06-27", "2026-06-28", "2026-06-29"]);
  assert.equal(request.region, "수원시");
  assert.equal(request.travelers, "4인 가족");
});

test("createFallbackTrip returns planner-safe multi-day Suwon items", () => {
  const generation = createFallbackTrip({
    region: "수원시",
    startDate: "2026-06-27",
    endDate: "2026-06-29",
    travelers: "4인 가족",
    transportMode: "car"
  });

  assert.equal(generation.trip.startDate, "2026-06-27");
  assert.equal(generation.trip.endDate, "2026-06-29");
  assert.equal(generation.trip.days.length, 3);
  assert.equal(generation.trip.source, "fallback");
  assert.ok(generation.items.length >= 12);
  assert.ok(generation.items.every((item) => item.startsAt.includes("+09:00")));
  assert.ok(generation.items.some((item) => item.placeName === "화성행궁"));
});

test("normalizeGeneratedTrip accepts Ennoia-style JSON and strips unusable fields", () => {
  const generation = normalizeGeneratedTrip(
    {
      title: "수원 가족 여행",
      days: [
        {
          date: "2026-06-27",
          title: "1일차",
          items: [
            {
              title: "수원화성 산책",
              placeName: "수원화성",
              startsAt: "10:00",
              endsAt: "11:30",
              category: "야외",
              transportMode: "자가용",
              rawApiJson: { hidden: true }
            }
          ]
        }
      ],
      apiStatus: ["KTO 확인"]
    },
    {
      region: "수원시",
      startDate: "2026-06-27",
      endDate: "2026-06-29",
      travelers: "4인 가족"
    },
    { source: "ennoia", modelStatus: "ok" }
  );

  assert.equal(generation.trip.source, "ennoia");
  assert.equal(generation.items[0].startsAt, "2026-06-27T10:00:00+09:00");
  assert.equal(generation.items[0].category, "outdoor");
  assert.equal(generation.items[0].transportMode, "car");
  assert.equal(JSON.stringify(generation).includes("rawApiJson"), false);
});

test("normalizeGeneratedTrip turns nearby self-driving hops into walkable parked-cluster moves", () => {
  const generation = normalizeGeneratedTrip(
    {
      title: "수원 가족 여행",
      days: [
        {
          date: "2026-06-27",
          title: "1일차",
          items: [
            {
              title: "수원화성박물관",
              placeName: "수원화성박물관",
              lat: 37.2821,
              lng: 127.0191,
              startsAt: "10:00",
              endsAt: "11:30",
              transportMode: "car",
              category: "indoor"
            },
            {
              title: "용성통닭 점심",
              placeName: "용성통닭 본점",
              lat: 37.2796,
              lng: 127.0176,
              startsAt: "12:00",
              endsAt: "13:00",
              transportMode: "car",
              category: "meal",
              memo: "Kakao 후보"
            }
          ]
        }
      ]
    },
    {
      region: "수원시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "4인 가족",
      transportMode: "car"
    }
  );

  assert.equal(generation.items[0].transportMode, "car");
  assert.equal(generation.items[1].transportMode, "walk");
  assert.match(generation.items[1].memo, /주차 후 도보/);
});

test("normalizeGeneratedTrip replaces vague Suwon place names with concrete candidates", () => {
  const generation = normalizeGeneratedTrip(
    {
      title: "수원 가족 여행",
      days: [
        {
          date: "2026-06-29",
          title: "3일차",
          items: [
            {
              title: "점심 인계동 가족 식사",
              placeName: "인계동 한식/분식/패밀리레스토랑",
              lat: 37.26,
              lng: 127.032,
              startsAt: "11:40",
              endsAt: "13:00",
              transportMode: "walk",
              category: "meal"
            },
            {
              title: "가벼운 쇼핑",
              placeName: "수원 시내 쇼핑몰/마트",
              lat: 37.26,
              lng: 127.01,
              startsAt: "13:30",
              endsAt: "15:00",
              transportMode: "car",
              category: "indoor"
            }
          ]
        }
      ]
    },
    {
      region: "수원시",
      startDate: "2026-06-29",
      endDate: "2026-06-29",
      travelers: "4인 가족"
    }
  );

  assert.equal(generation.items[0].placeName, "바르다김선생 인계나혜석거리점");
  assert.equal(generation.items[1].placeName, "AK플라자 수원");
  assert.ok(generation.items.every((item) => !/[\\/]|맛집|근처|시내|일대/.test(item.placeName)));
  assert.match(generation.items[0].memo, /장소명 보정/);
});
