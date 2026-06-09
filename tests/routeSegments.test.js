import assert from "node:assert/strict";
import test from "node:test";
import { buildParkingRouteLinks, buildRouteSegments, estimateTravelMinutes } from "../src/domain/routeSegments.js";

const baseItems = [
  {
    id: "a",
    title: "수원화성 산책",
    placeName: "수원화성",
    lat: 37.2878,
    lng: 127.0112,
    startsAt: "2026-06-27T10:00:00+09:00",
    endsAt: "2026-06-27T11:00:00+09:00",
    transportMode: "walk"
  },
  {
    id: "b",
    title: "행궁동 점심",
    placeName: "행궁동 맛집",
    lat: 37.2828,
    lng: 127.0146,
    startsAt: "2026-06-27T11:30:00+09:00",
    endsAt: "2026-06-27T12:30:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 18
  }
];

test("buildRouteSegments creates a route between consecutive plan items", () => {
  const [segment] = buildRouteSegments(baseItems);

  assert.equal(segment.fromName, "수원화성");
  assert.equal(segment.toName, "행궁동 맛집");
  assert.equal(segment.mode, "walk");
  assert.equal(segment.modeLabel, "도보");
  // 이동시간은 모델이 준 travelMinutesBefore(18)가 아니라 거리·수단 기반으로 추정한다.
  assert.ok(segment.minutes >= 10 && segment.minutes <= 16, `walk ~0.8km estimate, got ${segment.minutes}`);
  assert.equal(segment.timeLabel, `${segment.minutes}분`);
  assert.match(segment.distanceLabel, /km|m/);
  assert.match(segment.kakaoUrl, /m\.map\.kakao\.com\/scheme\/route/);
  assert.match(segment.kakaoUrl, /by=foot/);
  assert.match(segment.naverUrl, /map\.naver\.com\/p\/directions/);
  assert.match(segment.mapEmbedUrl, /map\.kakao\.com\/link\/by\/walk/);
  assert.equal(segment.mapProvider, "kakao");
  assert.equal(segment.availableMinutes, 30);
  // 30분 간격에 13분 내외 도보 → 여유.
  assert.equal(segment.timingTone, "relaxed");
});

test("estimateTravelMinutes scales with distance, mode, and rush-hour congestion", () => {
  // 도보는 혼잡 미적용: 1km ≈ 접근 2분 + 13.3분 ≈ 15분.
  assert.equal(estimateTravelMinutes({ distanceKm: 1, mode: "walk", departAt: "2026-06-29T11:00:00+09:00" }), 15);

  // 같은 자가용 10km라도 평일 출퇴근이 심야보다 길다.
  const rush = estimateTravelMinutes({ distanceKm: 10, mode: "car", departAt: "2026-06-29T18:00:00+09:00" });
  const night = estimateTravelMinutes({ distanceKm: 10, mode: "car", departAt: "2026-06-29T02:00:00+09:00" });
  assert.equal(rush, 46);
  assert.equal(night, 29);
  assert.ok(rush > night);

  // 보행 670m는 더 이상 1분이 아니라 합리적인 시간이어야 한다.
  assert.ok(estimateTravelMinutes({ distanceKm: 0.67, mode: "walk", departAt: "2026-06-29T11:00:00+09:00" }) >= 8);
});

test("buildRouteSegments maps car, taxi, bus, and subway to route link modes", () => {
  const expected = {
    car: ["car", "car"],
    taxi: ["car", "car"],
    bus: ["publictransit", "transit"],
    subway: ["publictransit", "transit"]
  };

  for (const [mode, [kakaoMode, naverMode]] of Object.entries(expected)) {
    const [, target] = baseItems;
    const routeTarget = { ...target, lat: 37.2587, lng: 127.0321, placeName: "인계동 저녁 식당", transportMode: mode };
    const [segment] = buildRouteSegments([{ ...baseItems[0] }, routeTarget]);
    assert.match(segment.kakaoUrl, new RegExp(`by=${kakaoMode}`));
    assert.match(segment.naverUrl, new RegExp(`/${naverMode}(?:\\?|$)`));
  }
});

test("buildRouteSegments embeds Kakao web routes for car and Naver web routes for transit", () => {
  const [, target] = baseItems;
  const [carSegment] = buildRouteSegments([
    { ...baseItems[0] },
    { ...target, lat: 37.2587, lng: 127.0321, placeName: "인계동 저녁 식당", transportMode: "car" }
  ]);
  const [busSegment] = buildRouteSegments([
    { ...baseItems[0] },
    { ...target, lat: 37.2587, lng: 127.0321, placeName: "인계동 저녁 식당", transportMode: "bus" }
  ]);

  assert.match(carSegment.mapEmbedUrl, /map\.kakao\.com\/link\/by\/car/);
  assert.equal(carSegment.mapProvider, "kakao");
  assert.match(busSegment.mapEmbedUrl, /map\.naver\.com\/p\/directions/);
  assert.equal(busSegment.mapProvider, "naver");
});

test("buildRouteSegments marks only self-driving routes for parking lookup", () => {
  const farTarget = {
    ...baseItems[1],
    placeName: "인계동 저녁 식당",
    lat: 37.2587,
    lng: 127.0321,
    transportMode: "car"
  };
  const [carSegment] = buildRouteSegments([{ ...baseItems[0] }, farTarget]);
  const [taxiSegment] = buildRouteSegments([{ ...baseItems[0] }, { ...baseItems[1], transportMode: "taxi" }]);

  assert.equal(carSegment.needsParking, true);
  assert.deepEqual(carSegment.parkingQuery, {
    lat: 37.2587,
    lng: 127.0321,
    placeName: "인계동 저녁 식당"
  });
  assert.equal(taxiSegment.needsParking, false);
});

test("buildRouteSegments changes short self-driving hops into walking connectors", () => {
  const [segment] = buildRouteSegments([{ ...baseItems[0] }, { ...baseItems[1], transportMode: "car" }]);

  assert.equal(segment.requestedMode, "car");
  assert.equal(segment.mode, "walk");
  assert.equal(segment.modeAdjusted, true);
  assert.equal(segment.modeReason, "가까운 구간은 주차 후 도보 이동이 자연스러움");
  assert.equal(segment.needsParking, false);
});

test("buildRouteSegments changes short transit hops into walking connectors", () => {
  for (const requestedMode of ["subway", "bus"]) {
    const [segment] = buildRouteSegments([{ ...baseItems[0] }, { ...baseItems[1], transportMode: requestedMode }]);

    assert.equal(segment.requestedMode, requestedMode);
    assert.equal(segment.mode, "walk");
    assert.equal(segment.modeAdjusted, true);
    assert.equal(segment.modeReason, "가까운 구간은 도보 이동이 자연스러움");
    assert.equal(segment.needsParking, false);
    assert.equal(segment.mapProvider, "kakao");
  }
});

test("buildParkingRouteLinks connects the car route to parking and then walking to the destination", () => {
  const [segment] = buildRouteSegments([
    { ...baseItems[0] },
    {
      ...baseItems[1],
      placeName: "인계동 저녁 식당",
      lat: 37.2587,
      lng: 127.0321,
      transportMode: "car"
    }
  ]);

  const linked = buildParkingRouteLinks(segment, {
    name: "인계동 공영주차장",
    address: "경기 수원시 팔달구 인계동",
    lat: 37.259,
    lng: 127.031,
    distanceLabel: "140m",
    placeUrl: "https://place.map.kakao.com/parking"
  });

  assert.equal(linked.parkingName, "인계동 공영주차장");
  assert.match(linked.carToParkingUrl, /map\.kakao\.com\/link\/by\/car/);
  assert.match(linked.carToParkingUrl, /37\.259,127\.031/);
  assert.match(linked.walkToDestinationUrl, /map\.kakao\.com\/link\/by\/walk/);
  assert.match(linked.walkToDestinationUrl, /37\.2587,127\.0321/);
  assert.equal(linked.destinationName, "인계동 저녁 식당");
});
