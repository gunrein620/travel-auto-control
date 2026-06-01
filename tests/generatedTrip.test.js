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

test("createFallbackTrip keeps an evening meal target after day item limits", () => {
  const generation = createFallbackTrip({
    region: "수원시",
    startDate: "2026-06-27",
    endDate: "2026-06-29",
    travelers: "4인 가족",
    transportMode: "car"
  });

  assert.ok(
    generation.items.some((item) => item.category === "meal" && new Date(item.startsAt).getHours() >= 17),
    "fallback itinerary should keep one evening meal for natural-language dinner edits"
  );
});

test("normalizeTripRequest resolves broad Jeolla input to Jeonju with a warning", () => {
  const request = normalizeTripRequest({
    region: "전라도",
    startDate: "2026-06-27",
    endDate: "2026-06-27"
  });

  assert.equal(request.region, "전라도");
  assert.equal(request.resolvedRegion.queryRegion, "전라도");
  assert.equal(request.resolvedRegion.region, "전주");
  assert.equal(request.resolvedRegion.ambiguous, true);
  assert.deepEqual(request.resolvedRegion.center, { lat: 35.8242, lng: 127.148 });
  assert.match(request.resolvedRegion.warning, /넓은 지역 입력이라 전주 중심으로 구성/);
});

test("createFallbackTrip uses concrete regional templates for Busan Daegu and Jeonju", () => {
  const cases = [
    {
      region: "부산시",
      canonical: "부산",
      expectedPlaces: ["해운대해수욕장", "동백섬", "송정3대국밥"],
      addressPattern: /^부산 /,
      bounds: { minLat: 35.02, maxLat: 35.32, minLng: 128.78, maxLng: 129.31 }
    },
    {
      region: "대구시",
      canonical: "대구",
      expectedPlaces: ["김광석다시그리기길", "서문시장", "국립대구박물관"],
      addressPattern: /^대구 /,
      bounds: { minLat: 35.74, maxLat: 36.02, minLng: 128.43, maxLng: 128.77 }
    },
    {
      region: "전주",
      canonical: "전주",
      expectedPlaces: ["전주한옥마을", "경기전", "베테랑 칼국수"],
      addressPattern: /^전북 전주시 /,
      bounds: { minLat: 35.75, maxLat: 35.91, minLng: 127.03, maxLng: 127.25 }
    }
  ];

  for (const fixture of cases) {
    const generation = createFallbackTrip({
      region: fixture.region,
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "4인 가족",
      transportMode: "car"
    });

    assert.equal(generation.trip.region, fixture.region);
    assert.equal(generation.trip.request.resolvedRegion.region, fixture.canonical);
    assert.equal(generation.trip.source, "fallback");
    assert.ok(generation.items.length > 0);
    assert.ok(generation.items.length <= 4);
    assert.ok(
      fixture.expectedPlaces.every((placeName) => generation.items.some((item) => item.placeName === placeName)),
      `${fixture.canonical} fallback should include known real places`
    );
    assert.ok(generation.items.every((item) => fixture.addressPattern.test(item.address)));
    assert.ok(generation.items.every((item) => isInsideBounds(item, fixture.bounds)));
    assert.ok(generation.items.every((item) => !/[\\/]|맛집|근처|시내|일대|대표 관광지|가족 식당|문화시설/.test(item.placeName)));
  }
});

test("createFallbackTrip asks for a more specific region when no center is known", () => {
  const generation = createFallbackTrip({
    region: "강원도",
    startDate: "2026-06-27",
    endDate: "2026-06-27"
  });

  assert.equal(generation.trip.region, "강원도");
  assert.equal(generation.items.length, 0);
  assert.ok(generation.trip.request.resolvedRegion.ambiguous);
  assert.ok(generation.trip.warnings.some((warning) => /지역을 더 구체화/.test(warning)));
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

test("normalizeGeneratedTrip limits Ennoia items to four per day", () => {
  const generation = normalizeGeneratedTrip(
    {
      title: "부산 가족 여행",
      days: [
        {
          date: "2026-06-27",
          title: "1일차",
          items: [
            tripItem("10:00", "11:00", "해운대해수욕장", 35.1587, 129.1604),
            tripItem("11:20", "12:20", "동백섬", 35.1535, 129.1527),
            tripItem("12:40", "13:30", "송정3대국밥", 35.1628, 129.1635, "meal"),
            tripItem("14:00", "15:00", "부산시립미술관", 35.1667, 129.1389, "indoor"),
            tripItem("15:30", "16:30", "영화의전당", 35.171, 129.1271, "indoor")
          ]
        }
      ]
    },
    {
      region: "부산시",
      startDate: "2026-06-27",
      endDate: "2026-06-27"
    }
  );

  assert.equal(generation.trip.days[0].itemIds.length, 4);
  assert.equal(generation.items.length, 4);
  assert.equal(generation.items.some((item) => item.placeName === "영화의전당"), false);
});

test("normalizeGeneratedTrip warns about invalid quality signals without dropping items", () => {
  const generation = normalizeGeneratedTrip(
    {
      title: "부산 가족 여행",
      days: [
        {
          date: "2026-06-27",
          title: "1일차",
          items: [
            {
              title: "대표 관광지 방문",
              placeName: "부산 대표 관광지",
              address: "부산 중구",
              startsAt: "10:00",
              endsAt: "09:30",
              transportMode: "car",
              category: "outdoor"
            },
            {
              title: "서울 좌표 식사",
              placeName: "해운대암소갈비집",
              address: "부산 해운대구 중동2로10번길 32-10",
              lat: 37.5665,
              lng: 126.978,
              startsAt: "12:00",
              endsAt: "13:00",
              transportMode: "car",
              category: "meal"
            }
          ]
        }
      ],
      warnings: ["agent warning"],
      evidence: ["a", "b", "c", "d", "e", "f"],
      apiStatus: ["1", "2", "3", "4", "5", "6"]
    },
    {
      region: "부산시",
      startDate: "2026-06-27",
      endDate: "2026-06-27"
    }
  );

  assert.equal(generation.items.length, 2);
  assert.equal(generation.trip.evidence.length, 5);
  assert.equal(generation.trip.apiStatus.length, 5);
  assert.equal(generation.trip.warnings.length, 5);
  assert.ok(generation.trip.warnings.some((warning) => /범용 장소명/.test(warning)));
  assert.ok(generation.trip.warnings.some((warning) => /좌표 누락/.test(warning)));
  assert.ok(generation.trip.warnings.some((warning) => /지역 범위 밖/.test(warning)));
  assert.ok(generation.trip.warnings.some((warning) => /종료 시간이 시작 시간보다 빠르거나 같습니다/.test(warning)));
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

function tripItem(start, end, placeName, lat, lng, category = "outdoor") {
  return {
    title: placeName,
    placeName,
    address: "부산 해운대구",
    lat,
    lng,
    startsAt: start,
    endsAt: end,
    transportMode: "car",
    category
  };
}

function isInsideBounds(item, bounds) {
  return item.lat >= bounds.minLat && item.lat <= bounds.maxLat && item.lng >= bounds.minLng && item.lng <= bounds.maxLng;
}
