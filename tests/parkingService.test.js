import assert from "node:assert/strict";
import test from "node:test";
import { fetchNearbyParking, normalizeParkingDocuments } from "../server/parkingService.js";

test("normalizeParkingDocuments keeps planner-safe parking details", () => {
  const result = normalizeParkingDocuments(
    [
      {
        id: "p1",
        place_name: "화성행궁 노상공영주차장",
        road_address_name: "경기 수원시 팔달구 정조로 825",
        address_name: "경기 수원시 팔달구 남창동",
        phone: "031-000-0000",
        x: "127.0142",
        y: "37.2819",
        distance: "180",
        place_url: "https://place.map.kakao.com/1",
        category_group_code: "PK6"
      }
    ],
    { lat: 37.2819, lng: 127.0142 }
  );

  assert.deepEqual(result[0], {
    id: "p1",
    name: "화성행궁 노상공영주차장",
    address: "경기 수원시 팔달구 정조로 825",
    phone: "031-000-0000",
    lat: 37.2819,
    lng: 127.0142,
    distanceMeters: 180,
    distanceLabel: "180m",
    placeUrl: "https://place.map.kakao.com/1",
    category: "parking"
  });
});

test("normalizeParkingDocuments labels zero-distance parking as adjacent instead of unknown", () => {
  const result = normalizeParkingDocuments(
    [
      {
        id: "p0",
        place_name: "화홍문공영주차장",
        x: "127.0162",
        y: "37.2896",
        distance: "0"
      }
    ],
    { lat: 37.2896, lng: 127.0162 }
  );

  assert.equal(result[0].distanceLabel, "도착지 인접");
});

test("fetchNearbyParking calls Kakao PK6 category search without exposing the key", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KAKAO_REST_API_KEY;
  process.env.KAKAO_REST_API_KEY = "secret-kakao-key";

  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(String(url));
    assert.equal(requestUrl.origin + requestUrl.pathname, "https://dapi.kakao.com/v2/local/search/category.json");
    assert.equal(requestUrl.searchParams.get("category_group_code"), "PK6");
    assert.equal(requestUrl.searchParams.get("x"), "127.0142");
    assert.equal(requestUrl.searchParams.get("y"), "37.2819");
    assert.equal(requestUrl.searchParams.get("sort"), "distance");
    assert.equal(options.headers.Authorization, "KakaoAK secret-kakao-key");

    return {
      ok: true,
      json: async () => ({
        documents: [
          {
            id: "p1",
            place_name: "화성행궁 공영주차장",
            road_address_name: "경기 수원시 팔달구 정조로",
            x: "127.0142",
            y: "37.2819",
            distance: "120",
            place_url: "https://place.map.kakao.com/1"
          }
        ]
      })
    };
  };

  try {
    const result = await fetchNearbyParking({ lat: 37.2819, lng: 127.0142, radius: 800 });
    assert.equal(result.source, "kakao");
    assert.equal(result.status, "ok");
    assert.equal(result.items[0].name, "화성행궁 공영주차장");
    assert.equal(JSON.stringify(result).includes("secret-kakao-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KAKAO_REST_API_KEY;
    else process.env.KAKAO_REST_API_KEY = originalKey;
  }
});
